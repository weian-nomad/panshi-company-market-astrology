import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const TARGET_DATE = "2026-07-13";
const HISTORY_FROM = "2019-07-13";
const tempDirectory = mkdtempSync(join(tmpdir(), "panshi-facts-"));
const databasePath = join(tempDirectory, "market.db");
process.env.MARKET_DB_PATH = databasePath;

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addMonths(value: string, months: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function createFixtureDatabase() {
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE companies (
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
    CREATE TABLE daily_prices (
      symbol TEXT NOT NULL,
      date TEXT NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL,
      PRIMARY KEY (symbol, date)
    );
    CREATE INDEX idx_daily_prices_symbol_date ON daily_prices(symbol, date);
    CREATE TABLE ingest_log (
      market TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0,
      ingested_at TEXT NOT NULL,
      PRIMARY KEY (market, date)
    );
  `);

  const insertCompany = db.prepare(`
    INSERT INTO companies (
      symbol, market, short_name, full_name, established_date,
      listing_date, industry_code, report_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertCompany.run("1101", "TWSE", "測試水泥", "測試水泥股份有限公司", "1950-01-01", "1962-02-09", "01", TARGET_DATE);
  insertCompany.run("1102", "TWSE", "測試食品", "測試食品股份有限公司", "1950-01-01", "1962-02-09", "02", TARGET_DATE);
  insertCompany.run("3101", "TPEx", "缺口公司", "缺口公司股份有限公司", "1950-01-01", "1962-02-09", "24", TARGET_DATE);

  const insertLog = db.prepare(`
    INSERT INTO ingest_log (market, date, status, row_count, ingested_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  for (let cursor = HISTORY_FROM; cursor <= TARGET_DATE; cursor = addDays(cursor, 1)) {
    const day = new Date(`${cursor}T00:00:00Z`).getUTCDay();
    const status = day === 0 || day === 6 ? "no-trading" : "ok";
    insertLog.run("TWSE", cursor, status, status === "ok" ? 2 : 0, `${cursor}T09:00:00.000Z`);
    insertLog.run("TPEx", cursor, status, status === "ok" ? 1 : 0, `${cursor}T09:00:00.000Z`);
  }
  db.exec("COMMIT");

  const insertPrice = db.prepare(`
    INSERT OR REPLACE INTO daily_prices
      (symbol, date, open, high, low, close, volume)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const seedBars = (
    symbol: string,
    currentClose: number,
    currentVolume: number,
    previousVolumeMultiplier = 100,
  ) => {
    for (let month = 0; month <= 84; month += 1) {
      const date = addMonths(HISTORY_FROM, month);
      const close = 80 + month * 0.1;
      insertPrice.run(symbol, date, close, close + 1, close - 1, close, 1_000);
    }
    for (let offset = 20; offset >= 1; offset -= 1) {
      const date = addDays(TARGET_DATE, -offset);
      const volume = (21 - offset) * previousVolumeMultiplier;
      insertPrice.run(symbol, date, 100, 101, 99, 100, volume);
    }
    insertPrice.run(symbol, TARGET_DATE, 100, currentClose + 1, 99, currentClose, currentVolume);
  };

  db.exec("BEGIN");
  seedBars("1101", 110, 4_200);
  seedBars("1102", 101, 1_050);
  seedBars("3101", 102, 1_100);
  db.exec("COMMIT");
  db.close();
}

createFixtureDatabase();
const {
  buildDailyCandidates,
  createDailyCandidatePool,
  getLatestMarketTradeDate,
} = await import("@/studio/facts");

test("latest market date requires a matching successful ingestion record", () => {
  assert.equal(getLatestMarketTradeDate(), TARGET_DATE);
});

test("daily facts use the requested close, prior-session change and prior-20-session median volume", () => {
  const candidates = buildDailyCandidates(TARGET_DATE, {
    shortlistSize: 1,
    appBaseUrl: "https://panshi.example/",
  });

  assert.equal(candidates.length, 1);
  const facts = candidates[0];
  assert.equal(facts.symbol, "1101");
  assert.equal(facts.market, "TWSE");
  assert.equal(facts.industry, "水泥工業");
  assert.deepEqual(facts.session, {
    date: TARGET_DATE,
    close: 110,
    dailyChangePercent: 10,
    volumeRatio20SessionMedian: 4,
  });
  assert.equal(facts.date, TARGET_DATE);
  assert.equal(facts.coverage.requestedMonths, 84);
  assert.equal(facts.coverage.receivedMonths, 84);
  assert.equal(facts.coverage.complete, true);
  assert.deepEqual(facts.coverage.missingMonths, []);
  assert.equal(facts.coverage.from, HISTORY_FROM);
  assert.equal(facts.coverage.to, TARGET_DATE);
  assert.equal(facts.coverage.basis, "raw-unadjusted-close");
  assert.ok(facts.transits.length > 0);
  assert.equal(facts.study?.horizon, 20);
  assert.equal(facts.study?.signature, facts.transits[0].signature);
  assert.equal(
    facts.appUrl,
    "https://panshi.example/?symbol=1101&date=2026-07-13&anchor=listing&horizon=20",
  );
});

test("default date uses the latest date proven complete across both markets", () => {
  const candidates = buildDailyCandidates(undefined, { shortlistSize: 3 });
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((candidate) => candidate.date === TARGET_DATE));
  assert.deepEqual(new Set(candidates.map((candidate) => candidate.market)), new Set(["TWSE", "TPEx"]));
  assert.ok(candidates.every((candidate) => candidate.coverage.to === TARGET_DATE));
});

test("adaptive shortlist tiers reuse facts already computed by the same pool", () => {
  const pool = createDailyCandidatePool(TARGET_DATE, { appBaseUrl: "https://panshi.example/" });
  const firstTier = pool.build(1);
  const expandedTier = pool.build(3);

  assert.equal(firstTier.length, 1);
  assert.strictEqual(
    expandedTier.find((candidate) => candidate.symbol === firstTier[0].symbol),
    firstTier[0],
  );
});

test("daily facts stop when either market has an incomplete 84-month ledger", () => {
  const db = new DatabaseSync(databasePath);
  const missingDate = addDays(HISTORY_FROM, 10);
  db.prepare("DELETE FROM ingest_log WHERE market = 'TPEx' AND date = ?").run(missingDate);
  try {
    assert.deepEqual(buildDailyCandidates(TARGET_DATE, { shortlistSize: 3 }), []);
  } finally {
    const day = new Date(`${missingDate}T00:00:00Z`).getUTCDay();
    const status = day === 0 || day === 6 ? "no-trading" : "ok";
    db.prepare(
      `INSERT INTO ingest_log (market, date, status, row_count, ingested_at)
       VALUES ('TPEx', ?, ?, ?, ?)`,
    ).run(missingDate, status, status === "ok" ? 1 : 0, `${missingDate}T09:00:00.000Z`);
    db.close();
  }
});

test("invalid dates and unbounded shortlists stop before factual generation", () => {
  assert.throws(() => buildDailyCandidates("2026-02-30"), /does not exist/);
  assert.throws(
    () => buildDailyCandidates(TARGET_DATE, { shortlistSize: 201 }),
    /shortlistSize must be an integer/,
  );
});
