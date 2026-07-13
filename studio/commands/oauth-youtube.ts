import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  codeChallengeS256,
  createPkceVerifier,
  handoffRedirectUri,
  loopbackListenerConfig,
  parseAuthorizationResponse,
  validateOAuthHandoff,
  type OAuthAuthorizationResponse,
  type OAuthHandoff,
} from "@/studio/oauth-handoff";
import { loadVaultKeys, writeVaultKey } from "@/studio/vault";

const AUTHORIZE_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
// Nomad's existing desktop OAuth client uses Google's loopback-host redirect.
// The port is intentionally fixed so the browser handoff can be completed by
// the local setup command without adding another public callback endpoint.
const DEFAULT_REDIRECT_URI = "http://localhost:53682";
const HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;
const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
];

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

function requireEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing.`);
  return value;
}

function getRedirectUri() {
  return process.env.YOUTUBE_OAUTH_REDIRECT_URI?.trim() || DEFAULT_REDIRECT_URI;
}

function getHandoffPath() {
  return join(homedir(), ".config", "nomad", "youtube-oauth-handoff.json");
}

async function saveRefreshToken(refreshToken: string) {
  await writeVaultKey("YOUTUBE_REFRESH_TOKEN", refreshToken);
}

function authorizationHandoff(): OAuthHandoff {
  const clientId = requireEnv("YOUTUBE_OAUTH_CLIENT_ID");
  const state = randomBytes(24).toString("base64url");
  const codeVerifier = createPkceVerifier();
  const url = new URL(AUTHORIZE_ENDPOINT);
  url.search = new URLSearchParams({
    access_type: "offline",
    client_id: clientId,
    include_granted_scopes: "true",
    prompt: "consent",
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    state,
    code_challenge: codeChallengeS256(codeVerifier),
    code_challenge_method: "S256",
  }).toString();
  return {
    authorizationUrl: url.toString(),
    state,
    codeVerifier,
    createdAt: new Date().toISOString(),
  };
}

async function saveOAuthHandoff(handoff: OAuthHandoff) {
  const handoffPath = getHandoffPath();
  await mkdir(dirname(handoffPath), { recursive: true, mode: 0o700 });
  await chmod(dirname(handoffPath), 0o700);
  const temporaryPath = `${handoffPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(handoff, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, handoffPath);
    await chmod(handoffPath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return handoffPath;
}

async function readOAuthHandoff() {
  const handoffPath = getHandoffPath();
  const stats = await lstat(handoffPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("The OAuth handoff must be a regular file.");
  }
  if ((stats.mode & 0o077) !== 0) {
    throw new Error("The OAuth handoff must not be readable by group or other users.");
  }
  return JSON.parse(await readFile(handoffPath, "utf8")) as OAuthHandoff;
}

function openAuthorizationUrl(authorizationUrl: string) {
  if (process.platform !== "darwin") return false;
  const child = spawn("open", [authorizationUrl], { detached: true, stdio: "ignore" });
  child.unref();
  return true;
}

function sendLoopbackPage(response: import("node:http").ServerResponse, status: number, success: boolean) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  const message = success
    ? "Authorization received. Return to the terminal while setup finishes."
    : "Authorization could not be verified. Return to the terminal and try again.";
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>YouTube authorization</title><body><p>${message}</p></body></html>`);
}

async function startLoopbackListener(handoff: OAuthHandoff) {
  const config = loopbackListenerConfig(handoffRedirectUri(handoff));
  let settle: ((result: OAuthAuthorizationResponse) => void) | undefined;
  let fail: ((error: Error) => void) | undefined;
  let settled = false;
  const timerRef: { current?: NodeJS.Timeout } = {};
  const authorization = new Promise<OAuthAuthorizationResponse>((resolveAuthorization, rejectAuthorization) => {
    settle = resolveAuthorization;
    fail = rejectAuthorization;
  });
  const server = createServer((request, response) => {
    const remoteAddress = request.socket.remoteAddress || "";
    const isLoopback = remoteAddress === "127.0.0.1"
      || remoteAddress === "::1"
      || remoteAddress === "::ffff:127.0.0.1";
    const host = request.headers.host?.toLowerCase() || "";
    if (!isLoopback
      || request.method !== "GET"
      || host !== config.callbackHost.toLowerCase()) {
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }

    const callbackUrl = new URL(request.url || "/", `http://${config.callbackHost}`);
    if (callbackUrl.pathname !== config.callbackPath) {
      response.writeHead(404, { "cache-control": "no-store" });
      response.end();
      return;
    }

    try {
      validateOAuthHandoff(handoff, {
        code: "pending",
        state: callbackUrl.searchParams.get("state")?.trim() || "",
        redirectUrl: callbackUrl.toString(),
      });
    } catch (error) {
      sendLoopbackPage(response, 400, false);
      if (error instanceof Error && /expired/u.test(error.message)) {
        settled = true;
        if (timerRef.current) clearTimeout(timerRef.current);
        server.close();
        fail?.(error);
      }
      return;
    }

    try {
      const parsed = parseAuthorizationResponse(callbackUrl.toString());
      validateOAuthHandoff(handoff, parsed);
      sendLoopbackPage(response, 200, true);
      settled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      server.close();
      settle?.(parsed);
    } catch (error) {
      sendLoopbackPage(response, 400, false);
      settled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      server.close();
      fail?.(error instanceof Error ? error : new Error("OAuth callback failed."));
    }
  });

  await new Promise<void>((resolveListening, rejectListening) => {
    const onError = (error: Error) => rejectListening(error);
    server.once("error", onError);
    server.listen(config.port, config.bindHost, () => {
      server.removeListener("error", onError);
      resolveListening();
    });
  });
  server.on("error", (error) => {
    if (settled) return;
    settled = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    fail?.(error);
  });
  timerRef.current = setTimeout(() => {
    if (settled) return;
    settled = true;
    server.close();
    fail?.(new Error("OAuth loopback authorization timed out. The saved handoff can still be exchanged manually."));
  }, HANDOFF_MAX_AGE_MS);

  return {
    authorization,
    close: () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      server.close();
    },
  };
}

async function presentAuthorizationUrl() {
  const handoff = authorizationHandoff();
  const handoffPath = await saveOAuthHandoff(handoff);
  let listener: Awaited<ReturnType<typeof startLoopbackListener>> | null = null;
  try {
    listener = await startLoopbackListener(handoff);
  } catch {
    openAuthorizationUrl(handoff.authorizationUrl);
    console.log(`Authorization handoff saved with mode 600 at ${handoffPath}. The loopback listener was unavailable; paste the full returned URL into the exchange command.`);
    return;
  }

  const opened = openAuthorizationUrl(handoff.authorizationUrl);
  if (opened) {
    console.log(`Authorization opened in the browser. Waiting on 127.0.0.1; the PKCE handoff is saved with mode 600 at ${handoffPath}.`);
  } else {
    listener.close();
    console.log(`Authorization URL and PKCE handoff saved with mode 600 at ${handoffPath}. Open the saved URL, then run the exchange command with the full returned URL.`);
    return;
  }
  const authorization = await listener.authorization;
  await exchangeAuthorization(handoff, authorization);
}

async function readHiddenLine() {
  const fromEnvironment = process.env.YOUTUBE_AUTHORIZATION_CODE;
  if (fromEnvironment?.trim()) return fromEnvironment;
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error(
      "Run this command in an interactive terminal or set YOUTUBE_AUTHORIZATION_CODE for this process.",
    );
  }

  process.stdout.write("Paste the full returned URL (input is hidden): ");
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<string>((resolveLine, reject) => {
    let input = "";
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      process.stdout.write("\n");
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Authorization was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          cleanup();
          resolveLine(input);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          input = input.slice(0, -1);
          continue;
        }
        input += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function exchangeAuthorization(
  handoff: OAuthHandoff,
  authorization: OAuthAuthorizationResponse,
) {
  const clientId = requireEnv("YOUTUBE_OAUTH_CLIENT_ID");
  const clientSecret = requireEnv("YOUTUBE_OAUTH_CLIENT_SECRET");
  validateOAuthHandoff(handoff, authorization);
  const savedAuthorizationUrl = new URL(handoff.authorizationUrl);
  if (savedAuthorizationUrl.searchParams.get("client_id") !== clientId) {
    throw new Error("The configured OAuth client does not match the saved handoff.");
  }
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code: authorization.code,
      code_verifier: handoff.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: handoffRedirectUri(handoff),
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as TokenResponse;

  if (!response.ok) {
    const reason = payload.error || `HTTP ${response.status}`;
    throw new Error(`OAuth exchange failed: ${reason}`);
  }
  if (!payload.refresh_token) {
    throw new Error(
      "No refresh token was returned. Revoke the previous grant, then run the consent flow again.",
    );
  }

  await saveRefreshToken(payload.refresh_token);
  await unlink(getHandoffPath()).catch(() => undefined);
  console.log("YOUTUBE_REFRESH_TOKEN saved to the key vault (value hidden).");
}

async function exchangeCode() {
  const handoff = await readOAuthHandoff();
  const authorization = parseAuthorizationResponse(
    await readHiddenLine(),
    process.env.YOUTUBE_AUTHORIZATION_STATE,
  );
  await exchangeAuthorization(handoff, authorization);
}

async function revokeAuthorization() {
  const refreshToken = requireEnv("YOUTUBE_REFRESH_TOKEN");
  const response = await fetch(REVOKE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
  });
  await response.text().catch(() => "");
  // A 400 response means the stored grant is already invalid. In that case
  // local deletion is still the correct completion of the user's request.
  if (!response.ok && response.status !== 400) {
    throw new Error(`OAuth revocation failed (HTTP ${response.status}).`);
  }
  await writeVaultKey("YOUTUBE_REFRESH_TOKEN", null);
  delete process.env.YOUTUBE_REFRESH_TOKEN;
  await unlink(getHandoffPath()).catch(() => undefined);
  console.log("YouTube authorization revoked; the saved refresh token was removed (value hidden).");
}

function printStatus() {
  const status = {
    YOUTUBE_OAUTH_CLIENT_ID: Boolean(process.env.YOUTUBE_OAUTH_CLIENT_ID?.trim()),
    YOUTUBE_OAUTH_CLIENT_SECRET: Boolean(process.env.YOUTUBE_OAUTH_CLIENT_SECRET?.trim()),
    YOUTUBE_REFRESH_TOKEN: Boolean(process.env.YOUTUBE_REFRESH_TOKEN?.trim()),
  };
  console.log(JSON.stringify({ presence: status }));
}

async function main() {
  loadVaultKeys([
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
  ]);
  const [command, ...extra] = process.argv.slice(2);
  if (extra.length) {
    throw new Error("Do not pass authorization codes as command-line arguments.");
  }
  if (command === "url") {
    await presentAuthorizationUrl();
    return;
  }
  if (command === "exchange") {
    await exchangeCode();
    return;
  }
  if (command === "status") {
    printStatus();
    return;
  }
  if (command === "revoke") {
    await revokeAuthorization();
    return;
  }
  throw new Error("Usage: oauth-youtube.ts <url|exchange|status|revoke>");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "OAuth setup failed.");
  process.exitCode = 1;
});
