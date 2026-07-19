import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { isActiveProTransaction } from "@/lib/app-store-entitlement";
import { recordQuery } from "@/lib/query-ledger";

const NOW = new Date("2026-07-19T04:00:00.000Z");
const VISITOR = "64ad7e62-4f2f-4cab-8bed-f8073084c981";

function query(
  conn: DatabaseSync,
  symbol: string,
  options: { isPro?: boolean; dailyFive?: string[]; kind?: "company" | "inquiry" } = {},
) {
  return recordQuery({
    visitorId: VISITOR,
    source: "ios",
    kind: options.kind ?? "company",
    symbol,
    requestedDate: options.kind === "inquiry" ? "2026-07-20" : null,
    anchor: options.kind === "inquiry" ? "listing" : null,
    horizon: options.kind === "inquiry" ? 20 : null,
    isPro: options.isPro ?? false,
    dailyFiveSymbols: new Set(options.dailyFive ?? []),
    now: NOW,
  }, conn).usage;
}

test("free tier allows three distinct non-daily symbols and blocks the fourth", () => {
  const conn = new DatabaseSync(":memory:");
  assert.equal(query(conn, "2330").remaining, 2);
  assert.equal(query(conn, "2317").remaining, 1);
  assert.equal(query(conn, "2454").remaining, 0);

  const blocked = query(conn, "2881");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.used, 3);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.resetAt, "2026-07-19T16:00:00.000Z");
  const catalogCount = conn.prepare(`SELECT COUNT(*) AS count FROM question_catalog`).get() as { count: number };
  assert.equal(catalogCount.count, 4);
});

test("repeating a symbol and opening a Daily Five symbol do not consume another slot", () => {
  const conn = new DatabaseSync(":memory:");
  const first = query(conn, "2330");
  const repeated = query(conn, "2330", { kind: "inquiry" });
  const daily = query(conn, "2317", { dailyFive: ["2317"] });

  assert.equal(first.counted, true);
  assert.equal(repeated.counted, false);
  assert.equal(repeated.used, 1);
  assert.equal(daily.isDailyFive, true);
  assert.equal(daily.used, 1);
  assert.equal(daily.remaining, 2);
});

test("Pro queries are recorded without consuming or enforcing the free quota", () => {
  const conn = new DatabaseSync(":memory:");
  for (const symbol of ["2330", "2317", "2454", "2881", "2303"]) {
    const usage = query(conn, symbol, { isPro: true });
    assert.equal(usage.allowed, true);
    assert.equal(usage.tier, "pro");
    assert.equal(usage.remaining, null);
  }
  const count = conn.prepare(`SELECT COUNT(*) AS count FROM query_requests`).get() as { count: number };
  assert.equal(count.count, 5);
});

test("question catalog aggregates repeat questions without storing the installation identifier", () => {
  const conn = new DatabaseSync(":memory:");
  query(conn, "2330", { kind: "inquiry" });
  query(conn, "2330", { kind: "inquiry" });

  const catalog = conn.prepare(`SELECT ask_count FROM question_catalog`).get() as { ask_count: number };
  const request = conn.prepare(`SELECT visitor_hash FROM query_requests LIMIT 1`).get() as { visitor_hash: string };
  assert.equal(catalog.ask_count, 2);
  assert.notEqual(request.visitor_hash, VISITOR);
  assert.match(request.visitor_hash, /^[0-9a-f]{64}$/);
});

test("server entitlement check requires the matching installation and an active Pro transaction", () => {
  const transaction = {
    bundleId: "com.nomadsustaintech.panshi",
    productId: "com.nomadsustaintech.panshi.pro.monthly",
    appAccountToken: VISITOR,
    expiresDate: NOW.getTime() + 60_000,
  };
  assert.equal(isActiveProTransaction(transaction, VISITOR, NOW.getTime()), true);
  assert.equal(
    isActiveProTransaction(transaction, "78b7e892-27e1-44a5-a6cc-a27681487f08", NOW.getTime()),
    false,
  );
  assert.equal(
    isActiveProTransaction({ ...transaction, expiresDate: NOW.getTime() - 1 }, VISITOR, NOW.getTime()),
    false,
  );
});
