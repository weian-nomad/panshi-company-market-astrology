/**
 * Daily incremental update: advances each market's ingest cursor in bounded
 * batches and repairs recent ledger gaps (idempotent — completed days are
 * skipped). Meant to run on a daily systemd timer after the initial
 * backfill-market-history.ts has completed.
 */
import {
  getIngestCoverage,
  getIngestStatuses,
  isIngestDayDone,
  markIngestDay,
  upsertCompanies,
  upsertDailyPrices,
} from "../lib/market-db.ts";
import { fetchTwseDailyQuotes, fetchTwseCompanyRegistryLive } from "../lib/company-data.ts";
import { fetchTpexDailyQuotes, fetchTpexCompanyRegistry } from "../lib/tpex-data.ts";
import {
  assertRegistryQuoteCoverage,
  currentMarketDate,
  emptyIngestStatus,
  incrementalScanStart,
  planIncrementalMarketDates,
  withLimitedRetry,
} from "../lib/market-ingest-policy.ts";
import type { PriceBar } from "../lib/astrology.ts";
import type { Market } from "../lib/market-db.ts";

const MAX_RETRIES = 3;

function retryLog(label: string) {
  return (attempt: number, reason: unknown) => {
    const message = reason instanceof Error ? reason.message : "empty response";
    console.warn(`  retry ${attempt}/${MAX_RETRIES} for ${label}: ${message}`);
  };
}

function planMarketDates(market: Market, todayIso: string) {
  const coverage = getIngestCoverage(market, todayIso);
  const scanStart = incrementalScanStart(todayIso, coverage);
  const statuses = getIngestStatuses(market, scanStart, todayIso);
  return planIncrementalMarketDates({ todayIso, ...coverage, statuses });
}

async function ingestOneMarketDay(
  market: Market,
  date: string,
  todayIso: string,
  expectedCompanyCount: number,
) {
  const isCurrentDay = date === todayIso;
  if (isIngestDayDone(market, date, { retryNoTrading: isCurrentDay })) return;

  try {
    const rows = await withLimitedRetry(
      () => (market === "TWSE" ? fetchTwseDailyQuotes(date) : fetchTpexDailyQuotes(date)),
      {
        attempts: MAX_RETRIES,
        shouldRetryResult: isCurrentDay ? (result) => result.length === 0 : undefined,
        onRetry: retryLog(`${market} ${date}`),
      },
    );
    if (rows.length === 0) {
      const status = emptyIngestStatus(date, todayIso);
      if (status === "error") {
        throw new Error(`${market} ${date} daily quotes are not available yet`);
      }
      markIngestDay(market, date, status, 0);
      return;
    }
    assertRegistryQuoteCoverage(market, rows.length, expectedCompanyCount);
    const bySymbol = new Map<string, PriceBar[]>();
    for (const { symbol, bar } of rows) {
      if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
      bySymbol.get(symbol)!.push(bar);
    }
    for (const [symbol, bars] of bySymbol) upsertDailyPrices(symbol, bars);
    markIngestDay(market, date, "ok", rows.length);
    console.log(`  ${market} ${date}: ${rows.length} rows`);
  } catch (error) {
    markIngestDay(market, date, "error", 0);
    throw error;
  }
}

async function main() {
  const todayIso = currentMarketDate();
  const datesByMarket = {
    TWSE: planMarketDates("TWSE", todayIso),
    TPEx: planMarketDates("TPEx", todayIso),
  };
  const dates = [...new Set([...datesByMarket.TWSE, ...datesByMarket.TPEx])].sort();
  if (dates.length === 0) {
    console.log("update-latest-market-day: already current");
    return;
  }

  const [twseCompanies, tpexCompanies] = await Promise.all([
    withLimitedRetry(fetchTwseCompanyRegistryLive, {
      attempts: MAX_RETRIES,
      onRetry: retryLog("TWSE registry"),
    }),
    withLimitedRetry(fetchTpexCompanyRegistry, {
      attempts: MAX_RETRIES,
      onRetry: retryLog("TPEx registry"),
    }),
  ]);
  upsertCompanies(twseCompanies);
  upsertCompanies(tpexCompanies);
  const expectedCompanyCounts: Record<Market, number> = {
    TWSE: twseCompanies.length,
    TPEx: tpexCompanies.length,
  };
  const failures: Array<{ market: Market; date: string }> = [];

  for (const date of dates) {
    const tasks = (["TWSE", "TPEx"] as const)
      .filter((market) => datesByMarket[market].includes(date))
      .map((market) => ({
        market,
        promise: ingestOneMarketDay(market, date, todayIso, expectedCompanyCounts[market]),
      }));
    const outcomes = await Promise.allSettled(tasks.map((task) => task.promise));
    for (let index = 0; index < outcomes.length; index += 1) {
      const outcome = outcomes[index];
      if (outcome.status === "rejected") {
        failures.push({ market: tasks[index].market, date });
      }
    }
  }
  if (failures.length) {
    throw new Error(
      `update-latest-market-day: ${failures.length} market-date ingestion(s) remain incomplete`,
    );
  }
  console.log("update-latest-market-day: done");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
