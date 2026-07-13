import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseTwseDailyQuotesPayload } from "@/lib/company-data";
import {
  assertRegistryQuoteCoverage,
  currentMarketDate,
  emptyIngestStatus,
  enumerateIsoDates,
  planIncrementalMarketDates,
  withLimitedRetry,
} from "@/lib/market-ingest-policy";
import { parseTpexDailyQuotesPayload } from "@/lib/tpex-data";
import type { IngestStatus } from "@/lib/market-db";

const databaseRoot = mkdtempSync(join(tmpdir(), "panshi-ingest-policy-"));
process.env.MARKET_DB_PATH = join(databaseRoot, "market.db");

const TWSE_FIELDS = [
  "證券代號", "證券名稱", "成交股數", "成交筆數", "成交金額", "開盤價", "最高價", "最低價", "收盤價",
];
const TPEX_FIELDS = ["代號", "名稱", "收盤 ", "漲跌", "開盤 ", "最高 ", "最低", "成交股數  "];

function statusMap(from: string, through: string, omitted: string[] = []) {
  return new Map<string, IngestStatus>(
    enumerateIsoDates(from, through)
      .filter((date) => !omitted.includes(date))
      .map((date) => [date, "ok"]),
  );
}

function twseRows(count: number) {
  return Array.from({ length: count }, (_, index) => [
    String(1000 + index),
    `Company ${index}`,
    "1,000",
    "10",
    "100,000",
    "10",
    "11",
    "9",
    "10",
  ]);
}

function tpexRows(count: number) {
  return Array.from({ length: count }, (_, index) => [
    String(1000 + index),
    `Company ${index}`,
    "10",
    "0",
    "10",
    "11",
    "9",
    "1,000",
  ]);
}

test("market date follows Asia/Taipei instead of the host timezone", () => {
  assert.equal(currentMarketDate(new Date("2026-07-13T15:59:59Z")), "2026-07-13");
  assert.equal(currentMarketDate(new Date("2026-07-13T16:00:00Z")), "2026-07-14");
});

test("only historical empty days become permanently no-trading", () => {
  assert.equal(emptyIngestStatus("2026-07-12", "2026-07-13"), "no-trading");
  assert.equal(emptyIngestStatus("2026-07-13", "2026-07-13"), "error");
  assert.equal(emptyIngestStatus("2026-07-14", "2026-07-13"), "error");
});

test("incremental cursor catches up after more than five days and repairs isolated gaps", () => {
  const caughtUp = planIncrementalMarketDates({
    todayIso: "2026-07-13",
    firstLoggedDate: "2026-06-01",
    latestCompletedDate: "2026-06-30",
    statuses: statusMap("2026-06-01", "2026-06-30"),
  });
  assert.deepEqual(caughtUp, enumerateIsoDates("2026-07-01", "2026-07-13"));

  const repaired = planIncrementalMarketDates({
    todayIso: "2026-07-13",
    firstLoggedDate: "2026-07-01",
    latestCompletedDate: "2026-07-13",
    statuses: statusMap("2026-07-01", "2026-07-13", ["2026-07-03"]),
  });
  assert.deepEqual(repaired, ["2026-07-03"]);
});

test("incremental planning is bounded, idempotent when current, and preserves short bootstrap", () => {
  const current = statusMap("2026-07-01", "2026-07-13");
  assert.deepEqual(
    planIncrementalMarketDates({
      todayIso: "2026-07-13",
      firstLoggedDate: "2026-07-01",
      latestCompletedDate: "2026-07-13",
      statuses: current,
    }),
    [],
  );

  const bounded = planIncrementalMarketDates({
    todayIso: "2026-07-13",
    firstLoggedDate: "2026-05-01",
    latestCompletedDate: "2026-05-01",
    statuses: new Map([["2026-05-01", "ok"]]),
  });
  assert.equal(bounded.length, 45);
  assert.equal(bounded[0], "2026-05-02");
  assert.equal(bounded.at(-1), "2026-07-13");

  const backlogWithErrors = planIncrementalMarketDates({
    todayIso: "2026-07-13",
    firstLoggedDate: "2026-05-01",
    latestCompletedDate: "2026-05-01",
    statuses: new Map(
      enumerateIsoDates("2026-05-01", "2026-06-20")
        .map((date) => [date, date === "2026-05-01" ? "ok" : "error"] as const),
    ),
  });
  assert.equal(backlogWithErrors.length, 45);
  assert.equal(backlogWithErrors.at(-1), "2026-07-13");

  const bootstrap = planIncrementalMarketDates({
    todayIso: "2026-07-13",
    firstLoggedDate: null,
    latestCompletedDate: null,
    statuses: new Map(),
  });
  assert.deepEqual(bootstrap, enumerateIsoDates("2026-07-07", "2026-07-13"));
});

test("official bulk parsers reject date mismatch and partial payloads", () => {
  assert.throws(
    () => parseTwseDailyQuotesPayload("2026-07-13", {
      stat: "OK",
      date: "20260712",
      tables: [{ title: "每日收盤行情", fields: TWSE_FIELDS, data: twseRows(500) }],
    }),
    /date mismatch/,
  );
  assert.throws(
    () => parseTwseDailyQuotesPayload("2026-07-13", {
      stat: "OK",
      date: "20260713",
      tables: [{ title: "每日收盤行情", fields: TWSE_FIELDS, data: twseRows(20) }],
    }),
    /incomplete/,
  );
  assert.throws(
    () => parseTpexDailyQuotesPayload("2026-07-13", {
      stat: "ok",
      date: "20260712",
      tables: [{ date: "115/07/12", totalCount: 400, fields: TPEX_FIELDS, data: tpexRows(400) }],
    }),
    /date mismatch/,
  );
  assert.throws(
    () => parseTpexDailyQuotesPayload("2026-07-13", {
      stat: "ok",
      date: "20260713",
      tables: [{ date: "115/07/13", totalCount: 400, fields: TPEX_FIELDS, data: tpexRows(20) }],
    }),
    /incomplete/,
  );
});

test("official no-data responses stay distinct from malformed or incomplete data", () => {
  assert.deepEqual(
    parseTwseDailyQuotesPayload("2026-07-12", {
      stat: "很抱歉，沒有符合條件的資料!",
    }),
    [],
  );
  assert.deepEqual(
    parseTpexDailyQuotesPayload("2026-07-12", {
      stat: "ok",
      date: "20260712",
      tables: [{ date: "115/07/12", totalCount: 0, fields: TPEX_FIELDS, data: [] }],
    }),
    [],
  );
  assert.throws(
    () => parseTwseDailyQuotesPayload("2026-07-12", { stat: "OK", date: "20260712" }),
    /tables are missing/,
  );
});

test("same-day official empty response is retried while historical empty finalizes as no-trading", async () => {
  let attempts = 0;
  const rows = await withLimitedRetry(
    async () => {
      attempts += 1;
      return parseTpexDailyQuotesPayload("2026-07-13", {
        stat: "ok",
        date: "20260713",
        tables: [{ date: "115/07/13", totalCount: 0, fields: TPEX_FIELDS, data: [] }],
      });
    },
    {
      attempts: 3,
      shouldRetryResult: (result) => result.length === 0,
      sleep: async () => undefined,
    },
  );
  assert.deepEqual(rows, []);
  assert.equal(attempts, 3);
  assert.equal(emptyIngestStatus("2026-07-13", "2026-07-13"), "error");
  assert.equal(emptyIngestStatus("2026-07-12", "2026-07-13"), "no-trading");
});

test("registry-relative coverage rejects a plausible-looking truncated universe", () => {
  assert.doesNotThrow(() => assertRegistryQuoteCoverage("TWSE", 700, 1000));
  assert.throws(
    () => assertRegistryQuoteCoverage("TPEx", 699, 1000),
    /incomplete/,
  );
});

test("limited retry handles transient errors and suspicious empty results", async () => {
  let errorAttempts = 0;
  const recovered = await withLimitedRetry(
    async () => {
      errorAttempts += 1;
      if (errorAttempts < 3) throw new Error("temporary");
      return ["quote"];
    },
    { attempts: 3, sleep: async () => undefined },
  );
  assert.deepEqual(recovered, ["quote"]);
  assert.equal(errorAttempts, 3);

  let emptyAttempts = 0;
  const stillEmpty = await withLimitedRetry(
    async () => {
      emptyAttempts += 1;
      return [] as string[];
    },
    {
      attempts: 3,
      shouldRetryResult: (rows) => rows.length === 0,
      sleep: async () => undefined,
    },
  );
  assert.deepEqual(stillEmpty, []);
  assert.equal(emptyAttempts, 3);
});

test("same-day no-trading markers can be retried without changing backfill semantics", async () => {
  const { isIngestDayDone, markIngestDay } = await import("@/lib/market-db");
  const date = "2026-07-13";

  markIngestDay("TWSE", date, "no-trading", 0);
  assert.equal(isIngestDayDone("TWSE", date), true);
  assert.equal(isIngestDayDone("TWSE", date, { retryNoTrading: true }), false);

  markIngestDay("TWSE", date, "error", 0);
  assert.equal(isIngestDayDone("TWSE", date), false);

  markIngestDay("TWSE", date, "ok", 1);
  assert.equal(isIngestDayDone("TWSE", date, { retryNoTrading: true }), true);
});
