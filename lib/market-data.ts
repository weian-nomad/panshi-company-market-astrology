import type { PriceBar } from "@/lib/astrology";
import type { PriceHistory } from "@/lib/company-data";
import { fetchTwseDailyQuotes, findCompany as findTwseCompanyStatic } from "@/lib/company-data";
import { fetchTpexDailyQuotes } from "@/lib/tpex-data";
import {
  findCompanyInDb,
  getCachedPriceBars,
  getLatestCachedDate,
  upsertDailyPrices,
  type CompanyRow,
  type Market,
} from "@/lib/market-db";

/** How many most-recent calendar days we're willing to live-fetch at request
 * time to fill a cache gap. Beyond this, missing history just stays missing
 * until the backfill/cron job catches up — never attempt a full historical
 * range live, that would time the request out. */
const MAX_LIVE_GAPFILL_DAYS = 7;
/** Hard wall-clock cap on the whole gap-fill loop, independent of how many
 * days that is — a handful of 8s-timeout bulk fetches could otherwise still
 * add up to a request that never returns. */
const GAPFILL_DEADLINE_MS = 15_000;

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function enumerateCalendarDates(fromExclusive: string, toInclusive: string) {
  const dates: string[] = [];
  let cursor = addDaysIso(fromExclusive, 1);
  while (cursor <= toInclusive) {
    dates.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return dates;
}

export function findCompanyUnified(symbol: string): CompanyRow | null {
  const fromDb = findCompanyInDb(symbol);
  if (fromDb) return fromDb;
  const fromStatic = findTwseCompanyStatic(symbol);
  if (!fromStatic) return null;
  return {
    symbol: fromStatic.symbol,
    market: "TWSE",
    shortName: fromStatic.shortName,
    fullName: fromStatic.fullName,
    englishName: fromStatic.englishName,
    establishedDate: fromStatic.establishedDate,
    listingDate: fromStatic.listingDate,
    industryCode: fromStatic.industryCode,
    website: fromStatic.website,
    reportDate: fromStatic.reportDate,
  };
}

function monthsAgoIso(months: number, notBefore?: string) {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  const iso = from.toISOString().slice(0, 10);
  return notBefore && notBefore > iso ? notBefore : iso;
}

/** Fetches one trading day's bulk quotes and opportunistically caches every
 * symbol in the response, not just the one the caller asked for — the bulk
 * endpoint returns the whole market for the same request cost either way. */
async function fetchAndCacheDay(market: Market, date: string): Promise<void> {
  const rows = market === "TWSE" ? await fetchTwseDailyQuotes(date) : await fetchTpexDailyQuotes(date);
  const bySymbol = new Map<string, PriceBar[]>();
  for (const { symbol, bar } of rows) {
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    bySymbol.get(symbol)!.push(bar);
  }
  for (const [symbol, bars] of bySymbol) upsertDailyPrices(symbol, bars);
}

/**
 * Cache-first price history: reads whatever's already backfilled in SQLite,
 * then live-fetches only the last few uncached days (the window the daily
 * cron hasn't reached yet). Never live-fetches a deep historical gap.
 */
export async function getPriceHistoryUnified(
  symbol: string,
  market: Market,
  months: number,
  options?: { notBefore?: string },
): Promise<PriceHistory> {
  const fromDate = monthsAgoIso(months, options?.notBefore);
  const today = taipeiToday();
  let cached = getCachedPriceBars(symbol, fromDate);
  const latestCached = getLatestCachedDate(symbol);

  const gapStart = latestCached && latestCached >= fromDate ? latestCached : fromDate;
  const allGapDates = enumerateCalendarDates(gapStart, today);
  const gapDates = allGapDates.slice(-MAX_LIVE_GAPFILL_DAYS);

  // Hard wall-clock cap on the whole gap-fill window: a handful of slow (but
  // not literally timed-out) bulk fetches could otherwise still add up past
  // any reasonable request latency. A race means a stuck fetch never blocks
  // the response — it just finishes caching in the background for next time.
  let liveFetchFailed = false;
  const gapFillWork = (async () => {
    for (const date of gapDates) {
      try {
        await fetchAndCacheDay(market, date);
      } catch {
        liveFetchFailed = true;
      }
    }
  })();
  const timedOut = await Promise.race([
    gapFillWork.then(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(true), GAPFILL_DEADLINE_MS)),
  ]);
  if (timedOut) liveFetchFailed = true;
  if (gapDates.length > 0) cached = getCachedPriceBars(symbol, fromDate);

  const bars = cached;
  const deepGapUncovered = allGapDates.length > gapDates.length && !latestCached;

  return {
    bars,
    coverage: {
      requestedMonths: months,
      receivedMonths: months,
      missingMonths: deepGapUncovered || liveFetchFailed ? ["cache-not-yet-backfilled"] : [],
      from: bars[0]?.date || null,
      to: bars.at(-1)?.date || null,
      sessions: bars.length,
      complete: !deepGapUncovered && !liveFetchFailed,
      basis: "raw-unadjusted-close",
    },
  };
}

export async function getPriceBarsUnified(
  symbol: string,
  market: Market,
  months: number,
  options?: { notBefore?: string },
): Promise<PriceBar[]> {
  return (await getPriceHistoryUnified(symbol, market, months, options)).bars;
}
