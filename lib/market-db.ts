import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { PriceBar } from "@/lib/astrology";

export type Market = "TWSE" | "TPEx";

export type CompanyRow = {
  symbol: string;
  market: Market;
  shortName: string;
  fullName: string;
  englishName: string;
  establishedDate: string;
  listingDate: string;
  industryCode: string;
  website: string;
  reportDate: string;
};

export type IngestStatus = "ok" | "no-trading" | "error";

const DEFAULT_DB_PATH = "data/panshi-market.db";

let db: DatabaseSync | null = null;

export function getMarketDb(): DatabaseSync {
  if (db) return db;
  const path = process.env.MARKET_DB_PATH || DEFAULT_DB_PATH;
  const dir = dirname(path);
  if (dir && dir !== "." && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS companies (
      symbol TEXT PRIMARY KEY,
      market TEXT NOT NULL,
      short_name TEXT NOT NULL,
      full_name TEXT NOT NULL,
      english_name TEXT NOT NULL DEFAULT '',
      established_date TEXT NOT NULL,
      listing_date TEXT NOT NULL,
      industry_code TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '',
      report_date TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_prices (
      symbol TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL,
      PRIMARY KEY (symbol, date)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_prices_symbol_date ON daily_prices(symbol, date);
    CREATE TABLE IF NOT EXISTS ingest_log (
      market TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      ingested_at TEXT NOT NULL,
      PRIMARY KEY (market, date)
    );
  `);
  return db;
}

export function upsertCompanies(rows: CompanyRow[]) {
  const conn = getMarketDb();
  const stmt = conn.prepare(`
    INSERT INTO companies (symbol, market, short_name, full_name, english_name, established_date, listing_date, industry_code, website, report_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol) DO UPDATE SET
      market = excluded.market,
      short_name = excluded.short_name,
      full_name = excluded.full_name,
      english_name = excluded.english_name,
      established_date = excluded.established_date,
      listing_date = excluded.listing_date,
      industry_code = excluded.industry_code,
      website = excluded.website,
      report_date = excluded.report_date
  `);
  for (const row of rows) {
    stmt.run(
      row.symbol,
      row.market,
      row.shortName,
      row.fullName,
      row.englishName,
      row.establishedDate,
      row.listingDate,
      row.industryCode,
      row.website,
      row.reportDate,
    );
  }
  return rows.length;
}

export function findCompanyInDb(symbol: string): CompanyRow | null {
  const conn = getMarketDb();
  const row = conn
    .prepare(
      `SELECT symbol, market, short_name, full_name, english_name, established_date, listing_date, industry_code, website, report_date
       FROM companies WHERE symbol = ?`,
    )
    .get(symbol) as Record<string, string> | undefined;
  if (!row) return null;
  return {
    symbol: row.symbol,
    market: row.market as Market,
    shortName: row.short_name,
    fullName: row.full_name,
    englishName: row.english_name,
    establishedDate: row.established_date,
    listingDate: row.listing_date,
    industryCode: row.industry_code,
    website: row.website,
    reportDate: row.report_date,
  };
}

export function upsertDailyPrices(symbol: string, bars: PriceBar[]) {
  if (bars.length === 0) return 0;
  const conn = getMarketDb();
  const stmt = conn.prepare(`
    INSERT INTO daily_prices (symbol, date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(symbol, date) DO UPDATE SET
      open = excluded.open, high = excluded.high, low = excluded.low,
      close = excluded.close, volume = excluded.volume
  `);
  for (const bar of bars) {
    stmt.run(symbol, bar.date, bar.open, bar.high, bar.low, bar.close, bar.volume);
  }
  return bars.length;
}

export function getCachedPriceBars(symbol: string, fromDate: string, toDate?: string): PriceBar[] {
  const conn = getMarketDb();
  const rows = toDate
    ? conn
        .prepare(
          `SELECT date, open, high, low, close, volume FROM daily_prices
           WHERE symbol = ? AND date >= ? AND date <= ? ORDER BY date ASC`,
        )
        .all(symbol, fromDate, toDate)
    : conn
        .prepare(
          `SELECT date, open, high, low, close, volume FROM daily_prices
           WHERE symbol = ? AND date >= ? ORDER BY date ASC`,
        )
        .all(symbol, fromDate);
  return (rows as Array<Record<string, number | string>>).map((row) => ({
    date: String(row.date),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  }));
}

export function getLatestCachedDate(symbol: string): string | null {
  const conn = getMarketDb();
  const row = conn
    .prepare(`SELECT MAX(date) as latest FROM daily_prices WHERE symbol = ?`)
    .get(symbol) as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

export function markIngestDay(market: Market, date: string, status: IngestStatus, rowCount: number) {
  const conn = getMarketDb();
  conn
    .prepare(
      `INSERT INTO ingest_log (market, date, status, row_count, ingested_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(market, date) DO UPDATE SET status = excluded.status, row_count = excluded.row_count, ingested_at = excluded.ingested_at`,
    )
    .run(market, date, status, rowCount, new Date().toISOString());
}

/** "error" is deliberately NOT considered done — a failed day should be
 * retried on the next run, not silently skipped forever. */
export function isIngestDayDone(market: Market, date: string): boolean {
  const conn = getMarketDb();
  const row = conn
    .prepare(`SELECT status FROM ingest_log WHERE market = ? AND date = ?`)
    .get(market, date) as { status: string } | undefined;
  return row !== undefined && row.status !== "error";
}

export function getIngestStats() {
  const conn = getMarketDb();
  const companies = conn.prepare(`SELECT market, COUNT(*) as n FROM companies GROUP BY market`).all() as Array<{
    market: string;
    n: number;
  }>;
  const priceDays = conn
    .prepare(`SELECT COUNT(DISTINCT date) as n, MIN(date) as from_date, MAX(date) as to_date FROM daily_prices`)
    .get() as { n: number; from_date: string | null; to_date: string | null };
  const priceRows = conn.prepare(`SELECT COUNT(*) as n FROM daily_prices`).get() as { n: number };
  return { companies, priceDays, priceRows };
}
