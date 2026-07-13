import type { IngestStatus } from "@/lib/market-db";

const MARKET_TIME_ZONE = "Asia/Taipei";

/**
 * Gap repair looks behind the high-water mark for isolated missing/error
 * ledger rows, while the cursor itself can continue from an older date in
 * bounded batches. This keeps routine runs cheap without making a long
 * outage silently permanent.
 */
export const INGEST_GAP_REPAIR_DAYS = 400;
export const INGEST_BOOTSTRAP_DAYS = 7;
export const MAX_INCREMENTAL_DATES_PER_RUN = 45;

type IngestCoverage = {
  firstLoggedDate: string | null;
  latestCompletedDate: string | null;
};

type IncrementalPlanOptions = IngestCoverage & {
  todayIso: string;
  statuses: ReadonlyMap<string, IngestStatus>;
  gapRepairDays?: number;
  bootstrapDays?: number;
  maxDates?: number;
};

type RetryOptions<T> = {
  attempts?: number;
  delayMs?: number;
  onRetry?: (attempt: number, reason: unknown) => void;
  shouldRetryResult?: (result: T) => boolean;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** ISO calendar date in the market's timezone, independent of host timezone. */
export function currentMarketDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: MARKET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

/**
 * An empty historical response can be finalized as a market closure. An empty
 * response for today (or an impossible future date) remains retryable because
 * the daily dataset may simply not have been published yet.
 */
export function emptyIngestStatus(date: string, todayIso: string): IngestStatus {
  return date < todayIso ? "no-trading" : "error";
}

function assertIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid ISO market date: ${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid ISO market date: ${value}`);
  }
  return date;
}

export function shiftIsoDate(value: string, days: number) {
  const date = assertIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function enumerateIsoDates(startIso: string, endIso: string) {
  const start = assertIsoDate(startIso);
  const end = assertIsoDate(endIso);
  if (start > end) return [];
  const dates: string[] = [];
  for (const cursor = start; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

/**
 * The cursor starts immediately after the latest completed ledger row. A
 * separate bounded repair window looks for holes behind that high-water mark.
 * With no ledger yet, the daily updater deliberately bootstraps only a short
 * window; the seven-year history remains the backfill command's job.
 */
export function incrementalScanStart(
  todayIso: string,
  coverage: IngestCoverage,
  options: { gapRepairDays?: number; bootstrapDays?: number } = {},
) {
  assertIsoDate(todayIso);
  const gapRepairDays = Math.max(1, Math.floor(options.gapRepairDays ?? INGEST_GAP_REPAIR_DAYS));
  const bootstrapDays = Math.max(1, Math.floor(options.bootstrapDays ?? INGEST_BOOTSTRAP_DAYS));
  const bootstrapStart = shiftIsoDate(todayIso, -(bootstrapDays - 1));

  if (!coverage.firstLoggedDate && !coverage.latestCompletedDate) return bootstrapStart;

  const repairFloor = shiftIsoDate(todayIso, -(gapRepairDays - 1));
  const repairStart = coverage.firstLoggedDate
    ? [coverage.firstLoggedDate, repairFloor].sort().at(-1)!
    : bootstrapStart;
  const cursorStart = coverage.latestCompletedDate
    ? shiftIsoDate(coverage.latestCompletedDate, 1)
    : bootstrapStart;

  // The cursor may be older than the repair window after a long outage. It is
  // intentionally retained; maxDates bounds the number of network requests.
  return [repairStart, cursorStart, todayIso].sort()[0];
}

function isCompletedStatus(status: IngestStatus | undefined, date: string, todayIso: string) {
  if (status === undefined || status === "error") return false;
  // A same-day empty result may only mean the official file is not published
  // yet, so it remains retryable until the date becomes historical.
  if (status === "no-trading" && date === todayIso) return false;
  return true;
}

/** Build the next bounded batch of missing/error calendar dates. */
export function planIncrementalMarketDates(options: IncrementalPlanOptions) {
  const scanStart = incrementalScanStart(options.todayIso, options, options);
  const maxDates = Math.max(1, Math.floor(options.maxDates ?? MAX_INCREMENTAL_DATES_PER_RUN));
  const pending = enumerateIsoDates(scanStart, options.todayIso)
    .filter((date) => !isCompletedStatus(options.statuses.get(date), date, options.todayIso));
  const batch = pending.slice(0, maxDates);

  // Reserve the final slot for today's official file when a large repair
  // backlog would otherwise keep it outside the bounded batch. Older gaps
  // continue advancing in the remaining slots on every timer run.
  if (pending.includes(options.todayIso) && !batch.includes(options.todayIso)) {
    batch[batch.length - 1] = options.todayIso;
  }
  return batch;
}

/**
 * A second, registry-relative floor catches a syntactically valid but
 * implausibly truncated whole-market response before it can advance the
 * ingest ledger.
 */
export function assertRegistryQuoteCoverage(
  market: "TWSE" | "TPEx",
  quoteCount: number,
  companyCount: number,
  minimumRatio = 0.7,
) {
  if (!Number.isInteger(quoteCount) || quoteCount < 0) {
    throw new Error(`${market} daily quote count is invalid`);
  }
  if (!Number.isInteger(companyCount) || companyCount <= 0) {
    throw new Error(`${market} company registry is empty or invalid`);
  }
  const minimum = Math.ceil(companyCount * minimumRatio);
  if (quoteCount < minimum) {
    throw new Error(
      `${market} daily quotes are incomplete: ${quoteCount} rows; expected at least ${minimum}`,
    );
  }
}

/** Retry thrown errors and, optionally, suspicious successful results. */
export async function withLimitedRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions<T> = {},
): Promise<T> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 3));
  const delayMs = Math.max(0, options.delayMs ?? 300);
  const sleep = options.sleep ?? defaultSleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await operation();
      if (attempt === attempts || !options.shouldRetryResult?.(result)) return result;
      options.onRetry?.(attempt, "retryable-result");
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      options.onRetry?.(attempt, error);
    }
    await sleep(delayMs * attempt);
  }

  throw lastError ?? new Error("Retry attempts exhausted");
}
