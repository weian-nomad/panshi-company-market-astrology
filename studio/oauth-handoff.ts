import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/u;

export type OAuthHandoff = {
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
  createdAt: string;
};

export type OAuthAuthorizationResponse = {
  code: string;
  state: string;
  redirectUrl?: string;
};

export type LoopbackListenerConfig = {
  bindHost: "127.0.0.1" | "::1";
  callbackHost: string;
  callbackPath: string;
  port: number;
};

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createPkceVerifier() {
  return randomBytes(64).toString("base64url");
}

export function codeChallengeS256(codeVerifier: string) {
  if (!PKCE_VERIFIER_PATTERN.test(codeVerifier)) {
    throw new Error("The saved OAuth PKCE verifier is invalid.");
  }
  return createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
}

export function loopbackListenerConfig(redirectUri: string): LoopbackListenerConfig {
  const url = new URL(redirectUri);
  if (url.protocol !== "http:" || url.username || url.password) {
    throw new Error("YOUTUBE_OAUTH_REDIRECT_URI must be an HTTP loopback URL.");
  }
  const hostname = url.hostname.toLowerCase();
  if (!(hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")) {
    throw new Error("YOUTUBE_OAUTH_REDIRECT_URI must use localhost, 127.0.0.1, or ::1.");
  }
  if (!url.port) {
    throw new Error("YOUTUBE_OAUTH_REDIRECT_URI must include an explicit loopback port.");
  }
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("YOUTUBE_OAUTH_REDIRECT_URI has an invalid port.");
  }
  if (url.search || url.hash) {
    throw new Error("YOUTUBE_OAUTH_REDIRECT_URI cannot contain a query or fragment.");
  }
  return {
    bindHost: hostname === "[::1]" ? "::1" : "127.0.0.1",
    callbackHost: url.host,
    callbackPath: url.pathname || "/",
    port,
  };
}

export function handoffRedirectUri(handoff: OAuthHandoff) {
  const authorizationUrl = new URL(handoff.authorizationUrl);
  const redirectUri = authorizationUrl.searchParams.get("redirect_uri")?.trim() || "";
  if (!redirectUri) throw new Error("The saved OAuth handoff has no redirect URI.");
  loopbackListenerConfig(redirectUri);
  return redirectUri;
}

export function parseAuthorizationResponse(
  input: string,
  explicitState = "",
): OAuthAuthorizationResponse {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Authorization response is empty.");
  if (!/^https?:\/\//i.test(trimmed)) {
    const state = explicitState.trim();
    if (!state) {
      throw new Error("A raw authorization code also requires YOUTUBE_AUTHORIZATION_STATE.");
    }
    return { code: trimmed, state };
  }

  const url = new URL(trimmed);
  const error = url.searchParams.get("error");
  if (error) throw new Error(`OAuth authorization failed: ${error}`);
  const code = url.searchParams.get("code")?.trim() || "";
  const state = url.searchParams.get("state")?.trim() || "";
  if (!code) throw new Error("The returned URL does not contain an authorization code.");
  if (!state) throw new Error("The returned URL does not contain OAuth state.");
  return { code, state, redirectUrl: url.toString() };
}

export function validateOAuthHandoff(
  handoff: OAuthHandoff,
  response: OAuthAuthorizationResponse,
  now = new Date(),
  maximumAgeMs = 30 * 60 * 1000,
) {
  if (!PKCE_VERIFIER_PATTERN.test(handoff.codeVerifier || "")) {
    throw new Error("The saved OAuth handoff has no valid PKCE verifier.");
  }
  const authorizationUrl = new URL(handoff.authorizationUrl);
  const savedState = authorizationUrl.searchParams.get("state")?.trim() || "";
  const savedChallenge = authorizationUrl.searchParams.get("code_challenge")?.trim() || "";
  if (!safeEqual(savedState, handoff.state)
    || authorizationUrl.searchParams.get("code_challenge_method") !== "S256"
    || !safeEqual(savedChallenge, codeChallengeS256(handoff.codeVerifier))) {
    throw new Error("The saved OAuth handoff does not match its PKCE parameters.");
  }
  if (!handoff.state || !safeEqual(handoff.state, response.state)) {
    throw new Error("OAuth state did not match the saved handoff.");
  }
  const createdAt = new Date(handoff.createdAt).getTime();
  const age = now.getTime() - createdAt;
  if (!Number.isFinite(createdAt) || age < -60_000 || age > maximumAgeMs) {
    throw new Error("The saved OAuth handoff has expired. Generate a new authorization URL.");
  }
  if (response.redirectUrl) {
    const expected = new URL(handoffRedirectUri(handoff));
    const returned = new URL(response.redirectUrl);
    if (returned.origin !== expected.origin || returned.pathname !== expected.pathname) {
      throw new Error("The OAuth response did not use the saved loopback redirect URI.");
    }
  }
}
