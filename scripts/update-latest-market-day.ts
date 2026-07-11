/**
 * Daily incremental update: ingests the last few calendar days for both
 * markets (idempotent — already-ingested days are skipped) and refreshes
 * the company registries. Meant to run on a daily systemd timer after the
 * initial backfill-market-history.ts has completed.
 */
import { upsertCompanies, upsertDailyPrices, isIngestDayDone, markIngestDay } from "../lib/market-db.ts";
import { fetchTwseDailyQuotes, fetchTwseCompanyRegistryLive } from "../lib/company-data.ts";
import { fetchTpexDailyQuotes, fetchTpexCompanyRegistry } from "../lib/tpex-data.ts";
import type { PriceBar } from "../lib/astrology.ts";
import type { Market } from "../lib/market-db.ts";

const LOOKBACK_DAYS = 5;

function recentDates(count: number) {
  const dates: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < count; i += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return dates.reverse();
}

async function ingestOneMarketDay(market: Market, date: string) {
  if (isIngestDayDone(market, date)) return;
  const rows = market === "TWSE" ? await fetchTwseDailyQuotes(date) : await fetchTpexDailyQuotes(date);
  if (rows.length === 0) {
    markIngestDay(market, date, "no-trading", 0);
    return;
  }
  const bySymbol = new Map<string, PriceBar[]>();
  for (const { symbol, bar } of rows) {
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol)!.push(bar);
  }
  for (const [symbol, bars] of bySymbol) upsertDailyPrices(symbol, bars);
  markIngestDay(market, date, "ok", rows.length);
  console.log(`  ${market} ${date}: ${rows.length} rows`);
}

async function main() {
  const [twseCompanies, tpexCompanies] = await Promise.all([
    fetchTwseCompanyRegistryLive(),
    fetchTpexCompanyRegistry(),
  ]);
  upsertCompanies(twseCompanies);
  upsertCompanies(tpexCompanies);

  for (const date of recentDates(LOOKBACK_DAYS)) {
    await Promise.all([ingestOneMarketDay("TWSE", date), ingestOneMarketDay("TPEx", date)]);
  }
  console.log("update-latest-market-day: done");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
