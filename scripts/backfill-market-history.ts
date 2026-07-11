/**
 * One-time (re-runnable) backfill of 7 years of daily OHLCV for every
 * TWSE + TPEx listed company into the local SQLite cache. Resumable: each
 * (market, date) pair is checked against ingest_log before fetching, so a
 * killed/restarted run just skips what's already done.
 *
 * Run on the host with the persistent DB volume, e.g.:
 *   MARKET_DB_PATH=/app/data/panshi-market.db node scripts/backfill-market-history.ts
 */
import {
  upsertCompanies,
  upsertDailyPrices,
  isIngestDayDone,
  markIngestDay,
  getIngestStats,
} from "../lib/market-db.ts";
import { fetchTwseDailyQuotes, fetchTwseCompanyRegistryLive } from "../lib/company-data.ts";
import { fetchTpexDailyQuotes, fetchTpexCompanyRegistry } from "../lib/tpex-data.ts";
import type { PriceBar } from "../lib/astrology.ts";
import type { Market } from "../lib/market-db.ts";

const YEARS_BACK = 7;
const MAX_RETRIES = 3;
// Concurrent dates in flight, not just concurrent TWSE+TPEx for the same
// date. Tuned DOWN from an initial 8: at 8-wide, nearly every request
// started timing out — TWSE/TPEx almost certainly cap concurrent
// connections per source IP, so past some small number more parallelism
// makes things worse, not better.
const DATE_CONCURRENCY = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enumerateDates(startIso: string, endIso: string) {
  const dates: string[] = [];
  const cursor = new Date(`${startIso}T00:00:00Z`);
  const end = new Date(`${endIso}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function isWeekend(iso: string) {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  retry ${attempt + 1}/${MAX_RETRIES} for ${label}: ${message}`);
      // A failure here is almost always a bad pick among TWSE/TPEx's several
      // round-robin backend IPs, not congestion — a near-immediate retry
      // "rerolls" onto a different backend rather than waiting out a problem
      // that a longer backoff wouldn't actually help with.
      await sleep(300 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function ingestOneMarketDay(market: Market, date: string) {
  if (isIngestDayDone(market, date)) return { status: "skipped" as const, rows: 0 };
  try {
    const rows = await withRetry(
      () => (market === "TWSE" ? fetchTwseDailyQuotes(date) : fetchTpexDailyQuotes(date)),
      `${market} ${date}`,
    );
    if (rows.length === 0) {
      markIngestDay(market, date, "no-trading", 0);
      return { status: "no-trading" as const, rows: 0 };
    }
    const bySymbol = new Map<string, PriceBar[]>();
    for (const { symbol, bar } of rows) {
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
      bySymbol.get(symbol)!.push(bar);
    }
    for (const [symbol, bars] of bySymbol) upsertDailyPrices(symbol, bars);
    markIngestDay(market, date, "ok", rows.length);
    return { status: "ok" as const, rows: rows.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  FAILED ${market} ${date}: ${message}`);
    markIngestDay(market, date, "error", 0);
    return { status: "error" as const, rows: 0 };
  }
}

async function main() {
  console.log("=== Refreshing company registries ===");
  const [twseCompanies, tpexCompanies] = await Promise.all([
    withRetry(() => fetchTwseCompanyRegistryLive(), "TWSE registry"),
    withRetry(() => fetchTpexCompanyRegistry(), "TPEx registry"),
  ]);
  upsertCompanies(twseCompanies);
  upsertCompanies(tpexCompanies);
  console.log(`  TWSE: ${twseCompanies.length} companies, TPEx: ${tpexCompanies.length} companies`);

  const today = new Date();
  const endIso = today.toISOString().slice(0, 10);
  const startDate = new Date(today);
  startDate.setUTCFullYear(startDate.getUTCFullYear() - YEARS_BACK);
  const startIso = startDate.toISOString().slice(0, 10);

  const allDates = enumerateDates(startIso, endIso);
  const weekdayDates = allDates.filter((date) => !isWeekend(date));
  const weekendCount = allDates.length - weekdayDates.length;
  for (const date of allDates) {
    if (!isWeekend(date)) continue;
    if (!isIngestDayDone("TWSE", date)) markIngestDay("TWSE", date, "no-trading", 0);
    if (!isIngestDayDone("TPEx", date)) markIngestDay("TPEx", date, "no-trading", 0);
  }
  console.log(
    `=== Backfilling ${weekdayDates.length} weekdays (${startIso} .. ${endIso}); ${weekendCount} weekend days pre-marked non-trading ===`,
  );

  let processed = 0;
  let tradingDays = 0;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < weekdayDates.length) {
      const index = nextIndex;
      nextIndex += 1;
      const date = weekdayDates[index];
      const [twse, tpex] = await Promise.all([
        ingestOneMarketDay("TWSE", date),
        ingestOneMarketDay("TPEx", date),
      ]);
      if (twse.status === "ok" || tpex.status === "ok") tradingDays += 1;
      processed += 1;
      if (processed % 100 === 0 || processed === weekdayDates.length) {
        const stats = getIngestStats();
        console.log(
          `  [${processed}/${weekdayDates.length}] through ${date} | trading-days-so-far=${tradingDays} | cached price rows=${stats.priceRows.n}`,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DATE_CONCURRENCY, weekdayDates.length) }, () => worker()),
  );

  console.log("=== Backfill complete ===");
  console.log(JSON.stringify(getIngestStats(), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
