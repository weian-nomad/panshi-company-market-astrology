import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getMarketDb } from "@/lib/market-db";

export const FREE_DAILY_SYMBOL_LIMIT = 3;

export type QueryKind = "company" | "inquiry";

export type QueryUsage = {
  tier: "free" | "pro";
  dailyLimit: 3;
  used: number;
  remaining: number | null;
  counted: boolean;
  isDailyFive: boolean;
  allowed: boolean;
  resetAt: string;
};

export type QueryRecord = {
  visitorId: string;
  source: "ios" | "web";
  kind: QueryKind;
  symbol: string;
  requestedDate?: string | null;
  anchor?: string | null;
  horizon?: number | null;
  isPro: boolean;
  dailyFiveSymbols: ReadonlySet<string>;
  now?: Date;
};

type StoredUsage = {
  usage: QueryUsage;
  visitorHash: string;
};

const RETENTION_DAYS = 180;
let schemaReady = new WeakSet<DatabaseSync>();

function taipeiDay(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function nextTaipeiMidnight(day: string) {
  return new Date(`${day}T16:00:00.000Z`).toISOString();
}

function visitorHash(visitorId: string) {
  return createHash("sha256")
    .update(`panshi-query-ledger-v1:${visitorId}`)
    .digest("hex");
}

function questionKey(record: QueryRecord) {
  return createHash("sha256")
    .update([
      record.kind,
      record.symbol,
      record.requestedDate || "",
      record.anchor || "",
      record.horizon ?? "",
    ].join("|"))
    .digest("hex");
}

function ensureSchema(conn: DatabaseSync) {
  if (schemaReady.has(conn)) return;
  conn.exec(`
    CREATE TABLE IF NOT EXISTS query_requests (
      id TEXT PRIMARY KEY,
      visitor_hash TEXT NOT NULL,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      symbol TEXT NOT NULL,
      requested_date TEXT,
      anchor TEXT,
      horizon INTEGER,
      query_day TEXT NOT NULL,
      quota_decision TEXT NOT NULL,
      counted INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_query_requests_day_visitor
      ON query_requests(query_day, visitor_hash);
    CREATE INDEX IF NOT EXISTS idx_query_requests_symbol_created
      ON query_requests(symbol, created_at);

    CREATE TABLE IF NOT EXISTS free_daily_symbols (
      visitor_hash TEXT NOT NULL,
      query_day TEXT NOT NULL,
      symbol TEXT NOT NULL,
      first_queried_at TEXT NOT NULL,
      PRIMARY KEY (visitor_hash, query_day, symbol)
    );

    CREATE TABLE IF NOT EXISTS question_catalog (
      question_key TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      symbol TEXT NOT NULL,
      requested_date TEXT,
      anchor TEXT,
      horizon INTEGER,
      first_asked_at TEXT NOT NULL,
      last_asked_at TEXT NOT NULL,
      ask_count INTEGER NOT NULL DEFAULT 1
    );
  `);
  conn.prepare(`DELETE FROM query_requests WHERE created_at < datetime('now', ?)`).run(`-${RETENTION_DAYS} days`);
  conn.prepare(`DELETE FROM free_daily_symbols WHERE query_day < date('now', '-14 days')`).run();
  schemaReady.add(conn);
}

export function recordQuery(record: QueryRecord, conn: DatabaseSync = getMarketDb()): StoredUsage {
  ensureSchema(conn);
  const now = record.now ?? new Date();
  const createdAt = now.toISOString();
  const queryDay = taipeiDay(now);
  const hash = visitorHash(record.visitorId);
  const isDailyFive = record.dailyFiveSymbols.has(record.symbol);
  let counted = false;
  let allowed = true;
  let used = 0;

  conn.exec("BEGIN IMMEDIATE");
  try {
    const existing = conn.prepare(
      `SELECT 1 FROM free_daily_symbols
       WHERE visitor_hash = ? AND query_day = ? AND symbol = ?`,
    ).get(hash, queryDay, record.symbol);

    const current = conn.prepare(
      `SELECT COUNT(*) AS count FROM free_daily_symbols
       WHERE visitor_hash = ? AND query_day = ?`,
    ).get(hash, queryDay) as { count: number };
    used = Number(current.count);

    if (!record.isPro && !isDailyFive && !existing) {
      if (used >= FREE_DAILY_SYMBOL_LIMIT) {
        allowed = false;
      } else {
        conn.prepare(
          `INSERT INTO free_daily_symbols (visitor_hash, query_day, symbol, first_queried_at)
           VALUES (?, ?, ?, ?)`,
        ).run(hash, queryDay, record.symbol, createdAt);
        counted = true;
        used += 1;
      }
    }

    conn.prepare(
      `INSERT INTO query_requests (
         id, visitor_hash, source, kind, symbol, requested_date, anchor, horizon,
         query_day, quota_decision, counted, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      hash,
      record.source,
      record.kind,
      record.symbol,
      record.requestedDate ?? null,
      record.anchor ?? null,
      record.horizon ?? null,
      queryDay,
      allowed ? (isDailyFive ? "daily-five" : record.isPro ? "pro" : "free") : "limit-reached",
      counted ? 1 : 0,
      createdAt,
    );

    conn.prepare(
      `INSERT INTO question_catalog (
         question_key, kind, symbol, requested_date, anchor, horizon,
         first_asked_at, last_asked_at, ask_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(question_key) DO UPDATE SET
         last_asked_at = excluded.last_asked_at,
         ask_count = question_catalog.ask_count + 1`,
    ).run(
      questionKey(record),
      record.kind,
      record.symbol,
      record.requestedDate ?? null,
      record.anchor ?? null,
      record.horizon ?? null,
      createdAt,
      createdAt,
    );

    conn.exec("COMMIT");
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }

  return {
    visitorHash: hash,
    usage: {
      tier: record.isPro ? "pro" : "free",
      dailyLimit: FREE_DAILY_SYMBOL_LIMIT,
      used,
      remaining: record.isPro ? null : Math.max(0, FREE_DAILY_SYMBOL_LIMIT - used),
      counted,
      isDailyFive,
      allowed,
      resetAt: nextTaipeiMidnight(queryDay),
    },
  };
}

export function resetQueryLedgerForTests() {
  schemaReady = new WeakSet<DatabaseSync>();
}
