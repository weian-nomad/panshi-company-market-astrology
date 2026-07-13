import {
  buildHistoricalTransitEpisodes,
  buildNatalChart,
  buildTransitSnapshot,
  type PriceBar,
} from "@/lib/astrology";
import { compactDate, INDUSTRIES } from "@/lib/company-data";
import { buildExactConfigurationStudy } from "@/lib/event-study";
import { getCachedPriceBars, getMarketDb, type Market } from "@/lib/market-db";
import type { DailyStockFacts } from "@/studio/types";

const HISTORY_MONTHS = 84;
const STUDY_HORIZON = 20 as const;
const ACTIVE_ORB = 3;
const EPISODE_PEAK_ORB = 1.25;
const RECENT_LOOKBACK_DAYS = 120;
const DEFAULT_SHORTLIST_SIZE = 60;
const MAX_SHORTLIST_SIZE = 200;
const DEFAULT_APP_URL = "https://panshi.nomadsustaintech.com/";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type RecentPriceRow = {
  symbol: string;
  market: Market;
  short_name: string;
  listing_date: string;
  industry_code: string;
  date: string;
  close: number;
  volume: number;
  session_rank: number;
};

type CheapCandidate = {
  symbol: string;
  market: Market;
  shortName: string;
  listingDate: string;
  industryCode: string;
  close: number;
  dailyChangePercent: number;
  volumeRatio20SessionMedian: number;
  cheapSalience: number;
};

export type BuildDailyCandidatesOptions = {
  /** Full symbolic studies are intentionally capped after the cheap market-data pass. */
  shortlistSize?: number;
  /** Public research view linked from the generated package. */
  appBaseUrl?: string;
};

function dateFromIso(value: string) {
  if (!ISO_DATE.test(value)) throw new Error("Daily candidate date must use YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error("Daily candidate date does not exist.");
  }
  return date;
}

function addDaysIso(value: string, days: number) {
  const date = dateFromIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Subtracts calendar months while clamping month-end dates (for example, Mar 31 -> Feb 28). */
function subtractMonthsIso(value: string, months: number) {
  const source = dateFromIso(value);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(year, month - months, 1));
  const targetMonthEnd = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0,
  ));
  targetMonthStart.setUTCDate(Math.min(day, targetMonthEnd.getUTCDate()));
  return targetMonthStart.toISOString().slice(0, 10);
}

function inclusiveCalendarDays(from: string, to: string) {
  const fromTime = dateFromIso(from).getTime();
  const toTime = dateFromIso(to).getTime();
  if (fromTime > toTime) return 0;
  return Math.floor((toTime - fromTime) / 86_400_000) + 1;
}

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function resolvedShortlistSize(value: number | undefined) {
  const size = value ?? DEFAULT_SHORTLIST_SIZE;
  if (!Number.isInteger(size) || size < 1 || size > MAX_SHORTLIST_SIZE) {
    throw new Error(`shortlistSize must be an integer from 1 to ${MAX_SHORTLIST_SIZE}.`);
  }
  return size;
}

function marketHasCompleteCache(market: Market, from: string, to: string) {
  const row = getMarketDb()
    .prepare(
      `SELECT
         COUNT(*) AS logged_days,
         SUM(CASE WHEN status NOT IN ('ok', 'no-trading') THEN 1 ELSE 0 END) AS invalid_days,
         SUM(CASE WHEN date = ? AND status = 'ok' THEN 1 ELSE 0 END) AS target_ok
       FROM ingest_log
       WHERE market = ? AND date >= ? AND date <= ?`,
    )
    .get(to, market, from, to) as {
      logged_days: number;
      invalid_days: number | null;
      target_ok: number | null;
    } | undefined;

  return Boolean(
    row
    && Number(row.logged_days) === inclusiveCalendarDays(from, to)
    && Number(row.invalid_days ?? 0) === 0
    && Number(row.target_ok ?? 0) === 1,
  );
}

function getRecentRows(date: string): RecentPriceRow[] {
  const from = addDaysIso(date, -RECENT_LOOKBACK_DAYS);
  const rows = getMarketDb()
    .prepare(
      `WITH recent AS (
         SELECT
           p.symbol,
           c.market,
           c.short_name,
           c.listing_date,
           c.industry_code,
           p.date,
           p.close,
           p.volume,
           ROW_NUMBER() OVER (PARTITION BY p.symbol ORDER BY p.date DESC) AS session_rank
         FROM daily_prices p
         INNER JOIN companies c ON c.symbol = p.symbol
         WHERE p.date >= ? AND p.date <= ?
           AND c.market IN ('TWSE', 'TPEx')
       )
       SELECT
         symbol, market, short_name, listing_date, industry_code,
         date, close, volume, session_rank
       FROM recent
       WHERE session_rank <= 21
       ORDER BY symbol ASC, session_rank ASC`,
    )
    .all(from, date) as Array<Record<string, string | number>>;

  return rows.map((row) => ({
    symbol: String(row.symbol),
    market: String(row.market) as Market,
    short_name: String(row.short_name),
    listing_date: String(row.listing_date),
    industry_code: String(row.industry_code),
    date: String(row.date),
    close: Number(row.close),
    volume: Number(row.volume),
    session_rank: Number(row.session_rank),
  }));
}

function buildCheapCandidates(
  date: string,
  completeMarkets: ReadonlySet<Market>,
): CheapCandidate[] {
  const bySymbol = new Map<string, RecentPriceRow[]>();
  for (const row of getRecentRows(date)) {
    if (!completeMarkets.has(row.market)) continue;
    bySymbol.set(row.symbol, [...(bySymbol.get(row.symbol) ?? []), row]);
  }

  const candidates: CheapCandidate[] = [];
  for (const rows of bySymbol.values()) {
    const ordered = [...rows].sort((a, b) => a.session_rank - b.session_rank);
    const current = ordered[0];
    const previous = ordered[1];
    const previousTwenty = ordered.slice(1, 21);
    if (
      !current
      || !previous
      || current.date !== date
      || previousTwenty.length !== 20
      || !Number.isFinite(current.close)
      || !Number.isFinite(previous.close)
      || !Number.isFinite(current.volume)
      || current.close <= 0
      || previous.close <= 0
      || current.volume <= 0
    ) continue;

    const medianPreviousVolume = median(previousTwenty.map((row) => row.volume));
    if (medianPreviousVolume === null || medianPreviousVolume <= 0) continue;

    const dailyChangePercent = round(((current.close / previous.close) - 1) * 100);
    const volumeRatio20SessionMedian = round(current.volume / medianPreviousVolume);
    if (!Number.isFinite(dailyChangePercent) || !Number.isFinite(volumeRatio20SessionMedian)) continue;

    // The first pass only ranks observable market movement. Cross-domain symbolic
    // calculations happen later and only for the bounded shortlist.
    const cheapSalience = Math.abs(dailyChangePercent)
      + Math.abs(Math.log(Math.max(volumeRatio20SessionMedian, 0.0001))) * 4;
    candidates.push({
      symbol: current.symbol,
      market: current.market,
      shortName: current.short_name.trim(),
      listingDate: current.listing_date,
      industryCode: current.industry_code.trim(),
      close: round(current.close, 4),
      dailyChangePercent,
      volumeRatio20SessionMedian,
      cheapSalience,
    });
  }

  return candidates.sort((a, b) => (
    b.cheapSalience - a.cheapSalience
    || Math.abs(b.dailyChangePercent) - Math.abs(a.dailyChangePercent)
    || Math.abs(Math.log(Math.max(b.volumeRatio20SessionMedian, 0.0001)))
      - Math.abs(Math.log(Math.max(a.volumeRatio20SessionMedian, 0.0001)))
    || a.symbol.localeCompare(b.symbol)
  ));
}

function appUrl(base: string, symbol: string, date: string) {
  const url = new URL(base);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("date", date);
  url.searchParams.set("anchor", "listing");
  url.searchParams.set("horizon", String(STUDY_HORIZON));
  return url.toString();
}

function barsEndOnDate(bars: PriceBar[], date: string) {
  return bars.length > 0 && bars.at(-1)?.date === date;
}

/**
 * Latest trading date proven by both a successful market ingestion record and
 * at least one cached company price row. A database with only partial/raw rows
 * is deliberately not considered ready for daily content.
 */
export function getLatestMarketTradeDate(): string | null {
  const row = getMarketDb()
    .prepare(
      `SELECT MAX(date) AS latest
       FROM (
         SELECT p.date
         FROM daily_prices p
         INNER JOIN companies c ON c.symbol = p.symbol
         INNER JOIN ingest_log i ON i.market = c.market AND i.date = p.date
         WHERE i.status = 'ok'
         GROUP BY p.date
         HAVING COUNT(DISTINCT i.market) = 2
       ) complete_market_dates`,
    )
    .get() as { latest: string | null } | undefined;
  return row?.latest ?? null;
}

/**
 * Builds factual inputs for neutral editorial selection. This function is
 * cache-only: it never invokes a market endpoint and never publishes content.
 *
 * The inexpensive OHLCV pass ranks the whole cached universe first. Natal,
 * transit and exact-configuration D+20 work is then limited to the shortlist.
 */
export function buildDailyCandidates(
  requestedDate?: string,
  options: BuildDailyCandidatesOptions = {},
): DailyStockFacts[] {
  const date = requestedDate ?? getLatestMarketTradeDate();
  if (!date) throw new Error("No fully ingested market trading date is available.");
  dateFromIso(date);

  const historyFrom = subtractMonthsIso(date, HISTORY_MONTHS);
  const completeMarkets = new Set<Market>(
    (["TWSE", "TPEx"] as const).filter((market) => (
      marketHasCompleteCache(market, historyFrom, date)
    )),
  );
  // Daily editorial selection is defined over the complete listed + OTC
  // universe. Silently dropping an exchange would invalidate the five-stock
  // comparison and its completeness language.
  if (completeMarkets.size !== 2) return [];

  const shortlist = buildCheapCandidates(date, completeMarkets)
    .slice(0, resolvedShortlistSize(options.shortlistSize));
  const baseUrl = options.appBaseUrl
    ?? process.env.PANSHI_PUBLIC_URL
    ?? DEFAULT_APP_URL;
  const candidates: DailyStockFacts[] = [];

  for (const candidate of shortlist) {
    let listingDate: string;
    try {
      listingDate = compactDate(candidate.listingDate);
      dateFromIso(listingDate);
    } catch {
      continue;
    }

    // A company younger than the requested window cannot support an 84-month
    // study, even if every price row since listing is cached.
    if (listingDate > historyFrom) continue;

    const bars = getCachedPriceBars(candidate.symbol, historyFrom, date);
    if (!barsEndOnDate(bars, date)) continue;

    const natal = buildNatalChart(listingDate, 9);
    const transits = buildTransitSnapshot(natal, date, ACTIVE_ORB);
    const primary = transits[0];
    if (!primary) continue;

    const episodes = buildHistoricalTransitEpisodes(natal, bars, EPISODE_PEAK_ORB);
    const study = buildExactConfigurationStudy({
      bars,
      episodes,
      signature: primary.signature,
      configurationLabel: `${primary.transitBodyZh}${primary.aspectZh}本命${primary.natalBodyZh}`,
      horizon: STUDY_HORIZON,
      missingMonths: [],
    });

    candidates.push({
      date,
      symbol: candidate.symbol,
      shortName: candidate.shortName,
      industry: INDUSTRIES[candidate.industryCode] ?? "未分類",
      market: candidate.market,
      session: {
        date,
        close: candidate.close,
        dailyChangePercent: candidate.dailyChangePercent,
        volumeRatio20SessionMedian: candidate.volumeRatio20SessionMedian,
      },
      transits,
      study,
      coverage: {
        requestedMonths: HISTORY_MONTHS,
        receivedMonths: HISTORY_MONTHS,
        missingMonths: [],
        from: bars[0]?.date ?? null,
        to: date,
        sessions: bars.length,
        complete: true,
        basis: "raw-unadjusted-close",
      },
      appUrl: appUrl(baseUrl, candidate.symbol, date),
    });
  }

  return candidates;
}
