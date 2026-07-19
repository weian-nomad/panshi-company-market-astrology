import { randomUUID } from "node:crypto";
import type { NextResponse } from "next/server";
import { verifyProEntitlement } from "@/lib/app-store-entitlement";
import { buildPublicDailyResearch } from "@/lib/daily-research";
import { recordQuery, type QueryKind, type QueryUsage } from "@/lib/query-ledger";
import { listEditions } from "@/studio/store";

const INSTALLATION_HEADER = "x-panshi-installation-id";
const ENTITLEMENT_HEADER = "x-panshi-entitlement-jws";
const PRODUCTION_COOKIE = "__Host-panshi_visitor";
const DEVELOPMENT_COOKIE = "panshi_visitor";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueryDetails = {
  kind: QueryKind;
  symbol: string;
  requestedDate?: string | null;
  anchor?: string | null;
  horizon?: number | null;
};

export type QueryAccess = {
  usage: QueryUsage;
  visitorId: string;
  source: "ios" | "web";
  setCookie: boolean;
  secureCookie: boolean;
};

function cookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    const value = decodeURIComponent(rest.join("="));
    return UUID_PATTERN.test(value) ? value.toLowerCase() : null;
  }
  return null;
}

function queryIdentity(request: Request) {
  const explicit = request.headers.get(INSTALLATION_HEADER)?.trim() || "";
  if (UUID_PATTERN.test(explicit)) {
    return {
      visitorId: explicit.toLowerCase(),
      source: "ios" as const,
      setCookie: false,
      secureCookie: true,
    };
  }

  const cookie = request.headers.get("cookie");
  const existing = cookieValue(cookie, PRODUCTION_COOKIE)
    || cookieValue(cookie, DEVELOPMENT_COOKIE);
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secureCookie = forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
  return {
    visitorId: existing || randomUUID(),
    source: "web" as const,
    setCookie: !existing,
    secureCookie,
  };
}

function dailyFiveSymbols() {
  try {
    const edition = buildPublicDailyResearch(listEditions(20));
    return new Set(edition?.items.map((item) => item.symbol) || []);
  } catch {
    return new Set<string>();
  }
}

export async function assessQueryAccess(request: Request, details: QueryDetails): Promise<QueryAccess> {
  const identity = queryIdentity(request);
  const isPro = identity.source === "ios"
    ? await verifyProEntitlement(request.headers.get(ENTITLEMENT_HEADER), identity.visitorId)
    : false;
  const { usage } = recordQuery({
    ...identity,
    ...details,
    isPro,
    dailyFiveSymbols: dailyFiveSymbols(),
  });
  return { ...identity, usage };
}

export function attachQueryCookie(response: NextResponse, access: QueryAccess) {
  if (!access.setCookie) return response;
  response.cookies.set({
    name: access.secureCookie ? PRODUCTION_COOKIE : DEVELOPMENT_COOKIE,
    value: access.visitorId,
    httpOnly: true,
    secure: access.secureCookie,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
