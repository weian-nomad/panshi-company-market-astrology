import { createHmac, timingSafeEqual } from "node:crypto";

export const STUDIO_SESSION_COOKIE = "panshi_studio_session";
export const STUDIO_SESSION_MAX_AGE_SECONDS = 60 * 60 * 12;

function configuredToken() {
  return process.env.STUDIO_REVIEW_TOKEN?.trim() || null;
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyReviewToken(candidate: string) {
  const token = configuredToken();
  return Boolean(token && safeEqual(candidate, token));
}

function sessionSignature(token: string, expiresAt: string) {
  return createHmac("sha256", token)
    .update(`panshi-studio-session:v2:${expiresAt}`)
    .digest("hex");
}

export function sessionCookieValue(now = new Date()) {
  const token = configuredToken();
  if (!token) return null;
  const expiresAt = String(Math.floor(now.getTime() / 1000) + STUDIO_SESSION_MAX_AGE_SECONDS);
  return `${expiresAt}.${sessionSignature(token, expiresAt)}`;
}

export function verifySessionCookie(candidate: string | undefined, now = new Date()) {
  const token = configuredToken();
  if (!candidate || !token) return false;
  const match = /^(\d{10})\.([a-f0-9]{64})$/u.exec(candidate);
  if (!match) return false;
  const expiresAtSeconds = Number(match[1]);
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (!Number.isSafeInteger(expiresAtSeconds)
    || expiresAtSeconds <= nowSeconds
    || expiresAtSeconds > nowSeconds + STUDIO_SESSION_MAX_AGE_SECONDS + 60) {
    return false;
  }
  return safeEqual(match[2], sessionSignature(token, match[1]));
}
