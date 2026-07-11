import assert from "node:assert/strict";
import test from "node:test";
import type { HistoricalTransitEpisode, PriceBar } from "../lib/astrology";
import { buildMonthKeys, parseHolidaySchedule } from "../lib/company-data";
import { buildExactConfigurationStudy } from "../lib/event-study";
import { isInquiryAnchor } from "../lib/inquiry-types";
import { startsNewTransitEpisode } from "../lib/transit-episodes";

function bar(date: string, close = 100): PriceBar {
  return { date, open: close, high: close + 1, low: close - 1, close, volume: 1 };
}

test("price history months stop at the known listing month", () => {
  const now = new Date(Date.UTC(2026, 6, 11));
  assert.deepEqual(
    buildMonthKeys(12, "2026-05-20", now),
    ["20260501", "20260601", "20260701"],
  );
});

test("holiday schedules from the wrong year are rejected", () => {
  const wrongYear = parseHolidaySchedule({
    stat: "ok",
    data: [["2026-01-01", "中華民國開國紀念日", "依規定放假1日。"]],
  }, 2027);
  assert.equal(wrongYear, null);

  const correctYear = parseHolidaySchedule({
    stat: "ok",
    data: [
      ["2026-01-01", "中華民國開國紀念日", "依規定放假1日。"],
      ["2026-01-02", "國曆新年開始交易日", "國曆新年開始交易。"],
    ],
  }, 2026);
  assert.equal(correctYear?.get("2026-01-01")?.disposition, "closed");
  assert.equal(correctYear?.get("2026-01-02")?.disposition, "open");
});

test("large calendar gaps split otherwise adjacent transit episodes", () => {
  assert.equal(
    startsNewTransitEpisode(
      { date: "2026-06-02", barIndex: 4 },
      { date: "2026-07-01", barIndex: 5 },
    ),
    true,
  );
  assert.equal(
    startsNewTransitEpisode(
      { date: "2026-07-10", barIndex: 4 },
      { date: "2026-07-13", barIndex: 5 },
    ),
    false,
  );
});

test("event study uses literal descriptive status and interpolated quartiles", () => {
  const bars = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    return bar(date);
  });
  const starts = [0, 6, 12, 18, 24];
  const endings = [101, 102, 200, 201, 202];
  starts.forEach((start, index) => {
    bars[start + 5].close = endings[index];
  });
  const episodes = starts.map((barIndex): HistoricalTransitEpisode => ({
    id: `case-${barIndex}`,
    signature: "Mars-square-Sun",
    date: bars[barIndex].date,
    transitBody: "Mars",
    transitBodyZh: "火星",
    transitGlyph: "♂",
    natalBody: "Sun",
    natalBodyZh: "太陽",
    natalGlyph: "☉",
    aspect: "square",
    aspectZh: "四分相",
    aspectGlyph: "□",
    tone: "tension",
    orb: 0.2,
    transitLongitude: 0,
    natalLongitude: 90,
    barIndex,
    close: 100,
  }));

  const study = buildExactConfigurationStudy({
    bars,
    episodes,
    signature: "Mars-square-Sun",
    configurationLabel: "火星四分相本命太陽",
    horizon: 5,
  });
  assert.equal(study.statusLabel, "僅供描述");
  assert.equal(study.statistics.sampleSize, 5);
  assert.equal(study.statistics.q1Return, 2);
  assert.equal(study.statistics.q3Return, 101);
});

test("event outcomes crossing a failed month are excluded", () => {
  const bars = [
    bar("2026-01-30"),
    bar("2026-03-02"),
    bar("2026-03-03"),
    bar("2026-03-04"),
    bar("2026-03-05"),
    bar("2026-03-06", 104),
  ];
  const episode: HistoricalTransitEpisode = {
    id: "case-gap",
    signature: "Mars-square-Sun",
    date: bars[0].date,
    transitBody: "Mars",
    transitBodyZh: "火星",
    transitGlyph: "♂",
    natalBody: "Sun",
    natalBodyZh: "太陽",
    natalGlyph: "☉",
    aspect: "square",
    aspectZh: "四分相",
    aspectGlyph: "□",
    tone: "tension",
    orb: 0.2,
    transitLongitude: 0,
    natalLongitude: 90,
    barIndex: 0,
    close: 100,
  };
  const study = buildExactConfigurationStudy({
    bars,
    episodes: [episode],
    signature: episode.signature,
    configurationLabel: "火星四分相本命太陽",
    horizon: 5,
    missingMonths: ["20260201"],
  });
  assert.equal(study.statistics.sampleSize, 0);
});

test("unknown chart anchors are rejected by the inquiry validator", () => {
  assert.equal(isInquiryAnchor("listing"), true);
  assert.equal(isInquiryAnchor("established"), true);
  assert.equal(isInquiryAnchor("unknown"), false);
});
