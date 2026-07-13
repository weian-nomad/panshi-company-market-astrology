import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  sessionCookieValue,
  verifySessionCookie,
} from "@/studio/auth";
import {
  codeChallengeS256,
  loopbackListenerConfig,
  parseAuthorizationResponse,
  validateOAuthHandoff,
} from "@/studio/oauth-handoff";
import {
  isTrustedStudioPost,
  studioLocation,
} from "@/studio/http-security";
import { POST as logoutPost } from "@/app/api/studio/logout/route";
import { POST as sessionPost } from "@/app/api/studio/session/route";

const RFC_PKCE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_PKCE_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function oauthHandoff() {
  const authorizationUrl = new URL("https://accounts.example.test/authorize");
  authorizationUrl.search = new URLSearchParams({
    client_id: "client-id",
    redirect_uri: "http://localhost:53682",
    state: "state-value",
    code_challenge: RFC_PKCE_CHALLENGE,
    code_challenge_method: "S256",
  }).toString();
  return {
    authorizationUrl: authorizationUrl.toString(),
    state: "state-value",
    codeVerifier: RFC_PKCE_VERIFIER,
    createdAt: "2026-07-13T00:00:00Z",
  };
}

test("Studio session cookie expires and cannot be extended by replay", () => {
  process.env.STUDIO_REVIEW_TOKEN = "test-only-review-token";
  const issuedAt = new Date("2026-07-13T00:00:00Z");
  const cookie = sessionCookieValue(issuedAt);
  assert.ok(cookie);
  assert.equal(verifySessionCookie(cookie, new Date("2026-07-13T11:59:59Z")), true);
  assert.equal(verifySessionCookie(cookie, new Date("2026-07-13T12:00:01Z")), false);
  assert.equal(verifySessionCookie(`${cookie}0`, issuedAt), false);
  delete process.env.STUDIO_REVIEW_TOKEN;
});

test("OAuth exchange requires matching, fresh state", () => {
  const returned = parseAuthorizationResponse("http://localhost:53682/?code=code-value&state=state-value");
  const handoff = oauthHandoff();
  assert.doesNotThrow(() => validateOAuthHandoff(handoff, returned, new Date("2026-07-13T00:10:00Z")));
  assert.throws(
    () => validateOAuthHandoff(handoff, { ...returned, state: "wrong" }, new Date("2026-07-13T00:10:00Z")),
    /state did not match/,
  );
  assert.throws(
    () => validateOAuthHandoff(handoff, returned, new Date("2026-07-13T00:31:00Z")),
    /expired/,
  );
  assert.throws(() => parseAuthorizationResponse("raw-code"), /YOUTUBE_AUTHORIZATION_STATE/);
});

test("OAuth handoff binds a PKCE S256 verifier and a local-only callback", () => {
  assert.equal(codeChallengeS256(RFC_PKCE_VERIFIER), RFC_PKCE_CHALLENGE);
  assert.deepEqual(loopbackListenerConfig("http://localhost:53682"), {
    bindHost: "127.0.0.1",
    callbackHost: "localhost:53682",
    callbackPath: "/",
    port: 53682,
  });
  assert.throws(() => loopbackListenerConfig("https://localhost:53682"), /HTTP loopback/);
  assert.throws(() => loopbackListenerConfig("http://example.test:53682"), /must use localhost/);

  const handoff = oauthHandoff();
  assert.throws(
    () => validateOAuthHandoff(
      { ...handoff, codeVerifier: `${handoff.codeVerifier}x` },
      parseAuthorizationResponse("http://localhost:53682/?code=code-value&state=state-value"),
      new Date("2026-07-13T00:10:00Z"),
    ),
    /does not match its PKCE parameters/,
  );
  assert.throws(
    () => validateOAuthHandoff(
      handoff,
      parseAuthorizationResponse("http://127.0.0.1:53682/?code=code-value&state=state-value"),
      new Date("2026-07-13T00:10:00Z"),
    ),
    /saved loopback redirect URI/,
  );
});

test("Studio POSTs require positive same-origin browser evidence", () => {
  const canonicalUrl = "https://panshi.nomadsustaintech.com";
  const internalUrl = "http://127.0.0.1:3000/api/studio/logout";
  assert.equal(isTrustedStudioPost(new Request(internalUrl, {
    method: "POST",
    headers: {
      origin: canonicalUrl,
      "sec-fetch-site": "same-origin",
    },
  }), canonicalUrl), true);
  assert.equal(isTrustedStudioPost(new Request(internalUrl, {
    method: "POST",
    headers: {
      origin: "https://cross-site.example",
      "sec-fetch-site": "cross-site",
    },
  }), canonicalUrl), false);
  assert.equal(isTrustedStudioPost(new Request(internalUrl, { method: "POST" }), canonicalUrl), false);
  assert.equal(isTrustedStudioPost(new Request(internalUrl, {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin" },
  }), "not a URL"), false);
  assert.equal(studioLocation("quarantined", "2026-07-13"), "/studio?notice=quarantined&date=2026-07-13");
});

test("Studio redirects stay relative behind a reverse proxy", async () => {
  const originalSiteUrl = process.env.SITE_URL;
  const originalReviewToken = process.env.STUDIO_REVIEW_TOKEN;
  process.env.SITE_URL = "https://panshi.nomadsustaintech.com";
  process.env.STUDIO_REVIEW_TOKEN = "test-only-review-token";
  try {
    const login = await sessionPost(new Request("http://127.0.0.1:3000/api/studio/session", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: process.env.SITE_URL,
        "sec-fetch-site": "same-origin",
      },
      body: new URLSearchParams({ token: process.env.STUDIO_REVIEW_TOKEN }),
    }));
    assert.equal(login.status, 303);
    assert.equal(login.headers.get("location"), "/studio");
    assert.doesNotMatch(login.headers.get("location") || "", /localhost|127\.0\.0\.1/u);

    const logout = await logoutPost(new Request("http://127.0.0.1:3000/api/studio/logout", {
      method: "POST",
      headers: {
        origin: process.env.SITE_URL,
        "sec-fetch-site": "same-origin",
      },
    }));
    assert.equal(logout.status, 303);
    assert.equal(logout.headers.get("location"), "/studio");

    const blocked = await logoutPost(new Request("http://127.0.0.1:3000/api/studio/logout", {
      method: "POST",
      headers: {
        origin: "https://cross-site.example",
        "sec-fetch-site": "cross-site",
      },
    }));
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("location"), null);
  } finally {
    if (originalSiteUrl === undefined) delete process.env.SITE_URL;
    else process.env.SITE_URL = originalSiteUrl;
    if (originalReviewToken === undefined) delete process.env.STUDIO_REVIEW_TOKEN;
    else process.env.STUDIO_REVIEW_TOKEN = originalReviewToken;
  }
});

test("systemd credentials preserve worker least privilege", () => {
  const generateUnit = readFileSync(
    new URL("../../deploy/systemd/panshi-studio-generate.service", import.meta.url),
    "utf8",
  );
  const publishUnit = readFileSync(
    new URL("../../deploy/systemd/panshi-studio-publish.service", import.meta.url),
    "utf8",
  );

  assert.match(generateUnit, /LoadCredential=studio-generate\.env:/u);
  assert.match(generateUnit, /--env-file %d\/studio-generate\.env/u);
  assert.doesNotMatch(generateUnit, /studio-publish|YOUTUBE_OAUTH|YOUTUBE_REFRESH_TOKEN/u);

  assert.match(publishUnit, /LoadCredential=studio-publish\.env:/u);
  assert.match(publishUnit, /--env-file %d\/studio-publish\.env/u);
  assert.doesNotMatch(publishUnit, /studio-generate|OPENAI_API_KEY/u);

  assert.doesNotMatch(`${generateUnit}\n${publishUnit}`, /EnvironmentFile=.*secret/iu);
});
