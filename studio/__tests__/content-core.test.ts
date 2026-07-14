import assert from "node:assert/strict";
import test from "node:test";

import type { TransitConfiguration } from "@/lib/astrology";
import type { InquiryStudy } from "@/lib/inquiry-types";
import { summarizeInquiryCases } from "@/lib/event-study";
import { buildDailyContentPackage } from "@/studio/script";
import { buildRenderScenes } from "@/studio/render";
import { mapDailyContentPackageToRemotionProps } from "@/studio/remotion/map-content";
import type { RemotionMediaBundle } from "@/studio/remotion/types";
import { createTimedCaptionTokens } from "@/studio/remotion/utils";
import { selectDailyFive } from "@/studio/selection";
import type { DailyStockFacts } from "@/studio/types";
import { EDITORIAL_CATEGORIES } from "@/studio/types";
import { taipeiCalendarDate, validateDailyPackage } from "@/studio/validation";

const DATE = "2026-07-13";

function transit(
  signature: string,
  index = 0,
  date = DATE,
): TransitConfiguration {
  const aspects = [
    { aspect: "square", aspectZh: "四分相", glyph: "□", tone: "tension" },
    { aspect: "trine", aspectZh: "三分相", glyph: "△", tone: "flow" },
    { aspect: "opposition", aspectZh: "對分相", glyph: "☍", tone: "tension" },
  ] as const;
  const chosen = aspects[index % aspects.length];
  return {
    id: `${date}-${signature}-${index}`,
    signature,
    date,
    transitBody: index % 2 ? "Jupiter" : "Mars",
    transitBodyZh: index % 2 ? "木星" : "火星",
    transitGlyph: index % 2 ? "♃" : "♂",
    natalBody: index % 2 ? "Venus" : "Sun",
    natalBodyZh: index % 2 ? "金星" : "太陽",
    natalGlyph: index % 2 ? "♀" : "☉",
    aspect: chosen.aspect,
    aspectZh: chosen.aspectZh,
    aspectGlyph: chosen.glyph,
    tone: chosen.tone,
    orb: Number((0.35 + index * 0.22).toFixed(2)),
    transitLongitude: 90 + index,
    natalLongitude: 180 + index,
  };
}

function study(
  signature: string,
  sampleSize: number,
  returnSeries?: number[],
): InquiryStudy {
  const returns = (returnSeries ?? [-8, -4, -4, 0, 1, 6, 6, 9, 11, 12]).slice(0, sampleSize);
  const cases = returns.map((returnPercent, index) => {
    const month = String(index + 1).padStart(2, "0");
    return {
      date: `2024-${month}-02`,
      endDate: `2024-${month}-28`,
      startClose: 100 + index,
      endClose: Number(((100 + index) * (1 + returnPercent / 100)).toFixed(2)),
      returnPercent,
      maxAdverseMove: -1 - index,
      orb: 0.4,
    };
  });
  const status = sampleSize === 0
    ? "no-sample"
    : sampleSize < 5
      ? "insufficient-sample"
      : "descriptive-only";
  const statistics = summarizeInquiryCases(cases);
  return {
    matchMode: "exact",
    signature,
    configurationLabel: `行運火星四分相本命太陽 ${signature}`,
    horizon: 20,
    status,
    statusLabel: sampleSize < 5 ? "樣本不足" : "僅供描述",
    minimumDescriptiveSample: 5,
    statistics,
    cases,
  };
}

function candidate({
  symbol,
  industry,
  signature,
  shortName = `公司${symbol}`,
  sampleSize = 8,
  dailyChangePercent = 0.2,
  volumeRatio = 1,
  transitCount = 1,
  returns,
}: {
  symbol: string;
  industry: string;
  signature: string;
  shortName?: string;
  sampleSize?: number;
  dailyChangePercent?: number;
  volumeRatio?: number | null;
  transitCount?: number;
  returns?: number[];
}): DailyStockFacts {
  return {
    date: DATE,
    symbol,
    shortName,
    industry,
    market: "TWSE",
    session: {
      date: DATE,
      close: Number(symbol.slice(0, 3)) + 0.5,
      dailyChangePercent,
      volumeRatio20SessionMedian: volumeRatio,
    },
    transits: Array.from({ length: transitCount }, (_, index) => (
      transit(index === 0 ? signature : `${signature}-extra-${index}`, index)
    )),
    study: study(signature, sampleSize, returns),
    coverage: {
      requestedMonths: 84,
      receivedMonths: 84,
      missingMonths: [],
      from: "2020-01-02",
      to: DATE,
      sessions: 1600,
      complete: true,
      basis: "raw-unadjusted-close",
    },
    appUrl: `https://panshi.nomadsustaintech.com/?symbol=${symbol}`,
  };
}

function candidatePool() {
  return [
    candidate({
      symbol: "1101",
      shortName: "水泥甲",
      industry: "水泥工業",
      signature: "Mars|square|Sun-a",
      dailyChangePercent: 9,
    }),
    candidate({
      symbol: "2201",
      shortName: "汽車乙",
      industry: "汽車工業",
      signature: "Mars|square|Sun-b",
      dailyChangePercent: -8,
    }),
    candidate({
      symbol: "2301",
      shortName: "電子丙",
      industry: "電子零組件",
      signature: "Jupiter|trine|Venus-c",
      volumeRatio: 4,
    }),
    candidate({
      symbol: "2401",
      shortName: "半導體丁",
      industry: "半導體業",
      signature: "Saturn|opposition|Sun-d",
      transitCount: 3,
    }),
    candidate({
      symbol: "2501",
      shortName: "營造戊",
      industry: "建材營造",
      signature: "Mars|trine|Venus-e",
      returns: [-20, -14, -14, -5, 5, 15, 15, 20],
    }),
    candidate({
      symbol: "2601",
      shortName: "航運己",
      industry: "航運業",
      signature: "Jupiter|square|Sun-f",
      sampleSize: 2,
    }),
  ];
}

function validPackage() {
  const selection = selectDailyFive({
    date: DATE,
    candidates: candidatePool(),
    recentSymbols: ["1101"],
  });
  return buildDailyContentPackage(selection);
}

test("選片每日固定五分類、五檔不重複，並優先避開近期出現標的", () => {
  const selection = selectDailyFive({
    date: DATE,
    candidates: candidatePool(),
    recentSymbols: ["1101"],
  });

  assert.deepEqual(selection.items.map((item) => item.category), EDITORIAL_CATEGORIES);
  assert.equal(new Set(selection.items.map((item) => item.facts.symbol)).size, 5);
  assert.equal(selection.items[0].facts.symbol, "2201");
  assert.deepEqual(selection.items.map((item) => item.facts.symbol), ["2201", "2301", "2401", "2501", "1101"]);
  assert.ok(selection.items.every((item) => (
    item.facts.study?.status === "descriptive-only"
    && item.facts.study.statistics.sampleSize >= item.facts.study.minimumDescriptiveSample
  )));
  assert.equal(selection.policy, "neutral-editorial-salience");
});

test("選片不受候選輸入順序影響，且不讓不足樣本進片", () => {
  const forward = selectDailyFive({ date: DATE, candidates: candidatePool(), recentSymbols: ["1101"] });
  const reverse = selectDailyFive({ date: DATE, candidates: candidatePool().reverse(), recentSymbols: ["1101"] });
  assert.deepEqual(
    reverse.items.map((item) => [item.category, item.facts.symbol]),
    forward.items.map((item) => [item.category, item.facts.symbol]),
  );
  assert.ok(forward.items.every((item) => (item.facts.study?.statistics.sampleSize ?? 0) >= 5));
  assert.ok(!forward.items.some((item) => item.facts.symbol === "2601"));
});

test("無法組成五檔唯一分類時停止生成", () => {
  assert.throws(
    () => selectDailyFive({ date: DATE, candidates: candidatePool().slice(0, 4) }),
    /無法組成五檔不重複/,
  );
});

test("腳本用反差開場，明說現在組態、雙向歷史、價格基準與邊界", () => {
  const content = validPackage();
  const narration = content.script.fullNarration;

  assert.match(narration, /AI 虛擬觀測員墨衡/);
  assert.match(narration, /一正一負/);
  assert.match(narration, /火星四分相本命太陽/);
  assert.match(narration, /D\+20 共 8 次，4 漲 3 跌 1 平/);
  assert.doesNotMatch(narration, /樣本不足/);
  assert.match(narration, /未還原收盤價/);
  assert.match(narration, /不是投資建議，也不提供買賣訊號/);
  assert.match(narration, /到盤勢搜尋畫面上的股票代號：https:\/\//);
  assert.match(narration, /https:\/\/panshi\.nomadsustaintech\.com\//);
  assert.match(content.script.caption, /完整研究\n[\s\S]*symbol=2201/);
  assert.match(content.script.segments[0].historyLine, /上行 4 筆、下行 3 筆、持平 1 筆；期間最不利變動中位數 -4\.5%，最差 -8\.0%/);
  assert.ok(narration.length < 900, `精簡口播過長：${narration.length} 字元`);
  assert.deepEqual(content.script.segments.map((segment) => segment.categoryLabel), [
    "市場異動",
    "量能異常",
    "相位密集",
    "歷史分歧",
    "今昔反差",
  ]);
});

test("選片遇到單邊歷史或不足樣本時寧可停產，也不硬湊五檔", () => {
  const pool = candidatePool();
  const oneSided = pool.find((item) => item.symbol === "1101");
  assert.ok(oneSided?.study);
  oneSided.study.cases.forEach((sample, index) => {
    sample.returnPercent = index + 1;
    sample.endClose = Number((sample.startClose * (1 + sample.returnPercent / 100)).toFixed(2));
  });
  oneSided.study.statistics = summarizeInquiryCases(oneSided.study.cases);

  assert.throws(
    () => selectDailyFive({ date: DATE, candidates: pool }),
    /無法組成五檔不重複/,
  );
});

test("完整內容通過當日、涵蓋、差異化與事實驗證", () => {
  const content = validPackage();
  const result = validateDailyPackage(content, { expectedDate: DATE });
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test("開場鉤子逐字鎖定選片與期間，不能借用別檔的合法數字", () => {
  const content = validPackage();
  const originalHook = content.script.hook;
  content.script.hook = "科技甲，兩個期間一正一負：今日日線 +2.4%；同盤 D+20 中位 -0.5%。";
  content.script.fullNarration = content.script.fullNarration.replace(originalHook, content.script.hook);

  const result = validateDailyPackage(content, { expectedDate: DATE });
  assert.ok(result.errors.some((error) => error.code === "hook-fact-mismatch"));
});

test("完整旁白不能在合法段落後追加相反方向敘述", () => {
  const content = validPackage();
  content.script.fullNarration += "\n汽車乙上漲 8.0%。";

  const result = validateDailyPackage(content, { expectedDate: DATE });
  assert.ok(result.errors.some((error) => error.code === "full-narration-mismatch"));
});

test("今昔對照遇到零變動時明說持平，不誤寫成同向", () => {
  const selection = structuredClone(validPackage().selection);
  const contrast = selection.items.find((item) => item.category === "today-history-contrast");
  assert.ok(contrast);
  contrast.facts.session.dailyChangePercent = 0;

  const content = buildDailyContentPackage(selection);
  const segment = content.script.segments.find((item) => item.category === "today-history-contrast");
  assert.match(segment?.narration ?? "", /一邊持平/);
  assert.doesNotMatch(segment?.narration ?? "", /同向不同幅/);
  assert.deepEqual(validateDailyPackage(content, { expectedDate: DATE }).errors, []);
});

test("驗證器接受各欄位實際呈現精度，仍拒絕沒有事實來源的近似值", () => {
  const selection = structuredClone(validPackage().selection);
  const dailyChanges = [-16.11, 2.63, 9.25, 9.92, 9.85];
  selection.items.forEach((item, index) => {
    item.facts.session.dailyChangePercent = dailyChanges[index];
  });

  const first = selection.items[0];
  first.facts.shortName = "M31科技";
  first.facts.session.close = 123.4567;
  first.facts.transits[0].orb = 0.364;
  const volumeItem = selection.items.find((item) => item.category === "volume-anomaly");
  assert.ok(volumeItem);
  volumeItem.facts.session.volumeRatio20SessionMedian = 4.26;

  const content = buildDailyContentPackage(selection);
  const visibleCopy = content.script.segments
    .map((segment) => [segment.marketLine, segment.configurationLine, segment.historyLine].join("\n"))
    .join("\n");
  assert.match(visibleCopy, /-16\.1%/);
  assert.match(visibleCopy, /\+2\.6%/);
  assert.match(visibleCopy, /\+9\.3%/);
  assert.match(visibleCopy, /\+9\.9%/);
  assert.match(visibleCopy, /\+9\.8%/);
  assert.match(visibleCopy, /M31科技/);
  assert.match(visibleCopy, /收盤 123\.46 元/);
  assert.match(visibleCopy, /成交量是近 20 個交易日中位量的 4\.3 倍/);
  assert.match(visibleCopy, /容許度 0\.36°/);
  assert.match(visibleCopy, /中位數 \+0\.5%，四分位區間 -4\.0% 至 \+6\.0%/);

  const valid = validateDailyPackage(content, { expectedDate: DATE });
  assert.deepEqual(valid.errors, []);

  const unsupported = structuredClone(content);
  unsupported.script.hook += " 未經資料支持的近似值 +2.7%。";
  const rejected = validateDailyPackage(unsupported, { expectedDate: DATE });
  assert.ok(rejected.errors.some((error) => (
    error.code === "unsupported-number" && error.message.includes("2.7")
  )));
});

test("Remotion 七場口播、音軌與字幕使用同一份時間軸", () => {
  const content = validPackage();
  const scenes = buildRenderScenes(content);
  const mediaFor = (index: number) => ({
    audioSrc: `studio/audio/${scenes[index].id}.wav`,
    durationFrames: 150 + index * 10,
  });
  const media: RemotionMediaBundle = {
    intro: mediaFor(0),
    stocks: [mediaFor(1), mediaFor(2), mediaFor(3), mediaFor(4), mediaFor(5)],
    outro: mediaFor(6),
  };
  const narrations = scenes.map((scene) => scene.narration) as [
    string,
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const props = mapDailyContentPackageToRemotionProps(content, media, { sceneNarrations: narrations });

  assert.equal(props.scenes.length, 7);
  assert.deepEqual(props.scenes.map((scene) => scene.narration), narrations);
  assert.deepEqual(props.scenes.map((scene) => scene.audioSrc), [
    "studio/audio/00-intro.wav",
    "studio/audio/01-2201.wav",
    "studio/audio/02-2301.wav",
    "studio/audio/03-2401.wav",
    "studio/audio/04-2501.wav",
    "studio/audio/05-1101.wav",
    "studio/audio/06-outro.wav",
  ]);
  assert.match(props.scenes[0].narration, /AI 墨衡/);
  assert.match(props.scenes[0].narration, /7 月 13 日，未還原收盤價/);
  assert.equal(props.scenes[6].narration, "完整案例在盤勢。非投資建議，無買賣訊號。");
  content.selection.items.forEach((item, index) => {
    const narration = props.scenes[index + 1].narration;
    const study = item.facts.study;
    assert.ok(study);
    const directions = {
      positive: study.cases.filter((sample) => sample.returnPercent > 0).length,
      negative: study.cases.filter((sample) => sample.returnPercent < 0).length,
    };
    const transit = item.facts.transits.find((entry) => entry.signature === study.signature);
    assert.ok(transit);
    assert.match(narration, new RegExp(item.facts.shortName));
    assert.match(narration, new RegExp(`D\\+${study.horizon} 共 ${study.statistics.sampleSize} 次`));
    assert.match(narration, new RegExp(`${directions.positive} 漲 ${directions.negative} 跌`));
    assert.match(narration, new RegExp(`${transit.transitBodyZh}${transit.aspectZh}本命${transit.natalBodyZh}`));
    assert.match(narration, item.category === "historical-divergence" ? /中間一半/ : /中位/);
  });
  for (const scene of props.scenes) {
    const durationMs = scene.durationFrames / 30 * 1_000;
    assert.ok(scene.captionTokens.length > 0);
    assert.ok(scene.captionTokens.every((token) => token.endMs <= durationMs + 34));
  }
});

test("Remotion 字幕不會把價格與百分比的小數拆成兩頁", () => {
  const tokens = createTimedCaptionTokens(
    "量是二十日中位的 4.2 倍；D 加 20 中位 +1.5%，四分位 -4.0% 到 +6.0%。",
    390,
  );

  assert.deepEqual(tokens.map((token) => token.text.trim()), [
    "量是二十日中位的 4.2 倍；",
    "D 加 20 中位 +1.5%，",
    "四分位 -4.0% 到 +6.0%。",
  ]);
});

test("驗證器使用臺北日界，並擋下過期內容", () => {
  assert.equal(taipeiCalendarDate(new Date("2026-07-12T16:30:00Z")), DATE);
  const current = validateDailyPackage(validPackage(), { now: new Date("2026-07-12T16:30:00Z") });
  assert.equal(current.valid, true);

  const stale = validateDailyPackage(validPackage(), { expectedDate: "2026-07-14" });
  assert.equal(stale.valid, false);
  assert.ok(stale.errors.some((error) => error.code === "not-current-date"));
  assert.ok(stale.errors.some((error) => error.code === "stale-stock-facts"));
});

test("驗證器擋下方向用語與事實不支持的數字", () => {
  const actionable = structuredClone(validPackage());
  actionable.script.hook += "現在買進，目標價 999.9 元。";
  const result = validateDailyPackage(actionable, { expectedDate: DATE });
  assert.ok(result.errors.some((error) => error.code === "actionable-language"));
  assert.ok(result.errors.some((error) => error.code === "unsupported-number"));
});

test("驗證器擋下重複股票、錯誤涵蓋與不足的實質差異", () => {
  const duplicate = structuredClone(validPackage());
  duplicate.selection.items[1].facts.symbol = duplicate.selection.items[0].facts.symbol;
  let result = validateDailyPackage(duplicate, { expectedDate: DATE });
  assert.ok(result.errors.some((error) => error.code === "duplicate-symbol"));

  const badCoverage = structuredClone(validPackage());
  badCoverage.selection.items[0].facts.coverage.missingMonths = ["cache-not-yet-backfilled"];
  result = validateDailyPackage(badCoverage, { expectedDate: DATE });
  assert.ok(result.errors.some((error) => error.code === "false-complete-coverage"));

  const sameIndustry = structuredClone(validPackage());
  sameIndustry.selection.items.forEach((item) => { item.facts.industry = "電子工業"; });
  result = validateDailyPackage(sameIndustry, { expectedDate: DATE });
  assert.ok(result.errors.some((error) => error.code === "insufficient-industry-variation"));
});

test("驗證器防止審稿用完整資料膨脹成過長口播", () => {
  const content = structuredClone(validPackage());
  content.script.fullNarration += "資料對照。".repeat(200);
  const result = validateDailyPackage(content, { expectedDate: DATE });
  assert.ok(result.errors.some((error) => error.code === "voiceover-too-long"));
});
