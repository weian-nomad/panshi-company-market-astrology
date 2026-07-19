import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  Environment,
  SignedDataVerifier,
  type JWSTransactionDecodedPayload,
} from "@apple/app-store-server-library";

const BUNDLE_ID = "com.nomadsustaintech.panshi";
const PRO_PRODUCT_ID = "com.nomadsustaintech.panshi.pro.monthly";
const MAX_JWS_LENGTH = 20_000;

let roots: Buffer[] | null = null;
let sandboxVerifier: SignedDataVerifier | null = null;
let productionVerifier: SignedDataVerifier | null = null;
const verificationCache = new Map<string, { active: boolean; expiresAt: number }>();

function rootCertificates() {
  if (roots) return roots;
  roots = [
    "AppleIncRootCertificate.cer",
    "AppleRootCA-G2.cer",
    "AppleRootCA-G3.cer",
  ].map((name) => readFileSync(join(process.cwd(), "assets", "apple-pki", name)));
  return roots;
}

function onlineChecksEnabled() {
  return process.env.APPLE_ENTITLEMENT_ONLINE_CHECKS !== "false";
}

function verifier(environment: Environment) {
  if (environment === Environment.SANDBOX) {
    sandboxVerifier ??= new SignedDataVerifier(
      rootCertificates(),
      onlineChecksEnabled(),
      Environment.SANDBOX,
      BUNDLE_ID,
    );
    return sandboxVerifier;
  }

  const appAppleId = Number(process.env.APPLE_APP_ID);
  if (!Number.isInteger(appAppleId) || appAppleId <= 0) return null;
  productionVerifier ??= new SignedDataVerifier(
    rootCertificates(),
    onlineChecksEnabled(),
    Environment.PRODUCTION,
    BUNDLE_ID,
    appAppleId,
  );
  return productionVerifier;
}

function declaredEnvironment(jws: string) {
  try {
    const payload = JSON.parse(Buffer.from(jws.split(".")[1] || "", "base64url").toString("utf8")) as {
      environment?: string;
    };
    return payload.environment === Environment.PRODUCTION
      ? Environment.PRODUCTION
      : payload.environment === Environment.SANDBOX
        ? Environment.SANDBOX
        : null;
  } catch {
    return null;
  }
}

export function isActiveProTransaction(
  transaction: JWSTransactionDecodedPayload,
  installationId: string,
  now = Date.now(),
) {
  return transaction.bundleId === BUNDLE_ID
    && transaction.productId === PRO_PRODUCT_ID
    && transaction.appAccountToken?.toLowerCase() === installationId.toLowerCase()
    && typeof transaction.expiresDate === "number"
    && transaction.expiresDate > now
    && transaction.revocationDate === undefined
    && transaction.isUpgraded !== true;
}

export async function verifyProEntitlement(jws: string | null, installationId: string) {
  if (!jws || jws.length > MAX_JWS_LENGTH || jws.split(".").length !== 3) return false;
  const now = Date.now();
  const cacheKey = createHash("sha256").update(`${installationId}:${jws}`).digest("hex");
  const cached = verificationCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.active;
  const environment = declaredEnvironment(jws);
  if (!environment) return false;
  const signedDataVerifier = verifier(environment);
  if (!signedDataVerifier) return false;

  try {
    const transaction = await signedDataVerifier.verifyAndDecodeTransaction(jws);
    const active = isActiveProTransaction(transaction, installationId, now);
    const expiresAt = active
      ? Math.min(transaction.expiresDate ?? now, now + 5 * 60_000)
      : now + 30_000;
    if (verificationCache.size >= 256) {
      verificationCache.delete(verificationCache.keys().next().value as string);
    }
    verificationCache.set(cacheKey, { active, expiresAt });
    return active;
  } catch {
    verificationCache.set(cacheKey, { active: false, expiresAt: now + 30_000 });
    return false;
  }
}

export function resetEntitlementVerifierForTests() {
  roots = null;
  sandboxVerifier = null;
  productionVerifier = null;
  verificationCache.clear();
}
