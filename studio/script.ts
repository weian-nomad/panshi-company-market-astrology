import type { InquiryStudy } from "@/lib/inquiry-types";
import { studyDirectionCounts } from "@/studio/study-quality";
import {
  type DailyContentPackage,
  type DailyFiveSelection,
  type DailyScriptOptions,
  type DailyScriptSegment,
  type DailySelectionItem,
  type DailyVideoScript,
  type FiveItems,
} from "@/studio/types";

const DEFAULT_HOST_NAME = "墨衡";
const DEFAULT_APP_NAME = "盤勢";
const DEFAULT_APP_URL = "https://panshi.nomadsustaintech.com/";

function assertIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`日期格式錯誤：${value}`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`日期不存在：${value}`);
  }
}

export function formatDateZh(value: string) {
  assertIsoDate(value);
  const [year, month, day] = value.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

export function formatPlainNumber(value: number, maximumDigits = 2) {
  if (!Number.isFinite(value)) throw new Error("數值必須是有限數。");
  const fixed = value.toFixed(maximumDigits);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function formatSignedPercent(value: number) {
  if (!Number.isFinite(value)) throw new Error("百分比必須是有限數。");
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function primaryTransit(item: DailySelectionItem) {
  const studySignature = item.facts.study?.signature;
  const matching = studySignature
    ? item.facts.transits.find((transit) => transit.signature === studySignature)
    : null;
  return matching ?? [...item.facts.transits].sort((a, b) => (
    a.orb - b.orb || a.signature.localeCompare(b.signature)
  ))[0] ?? null;
}

function interquartileSpread(study: InquiryStudy | null) {
  const q1 = study?.statistics.q1Return;
  const q3 = study?.statistics.q3Return;
  if (q1 === null || q1 === undefined || q3 === null || q3 === undefined) return null;
  return Number((q3 - q1).toFixed(1));
}

function descriptiveStudy(item: DailySelectionItem) {
  const study = item.facts.study;
  if (!study || study.status !== "descriptive-only") {
    throw new Error(`${item.facts.symbol} 沒有可發布的描述性研究。`);
  }
  return study;
}

function signedDailyMovement(item: DailySelectionItem) {
  return formatSignedPercent(item.facts.session.dailyChangePercent);
}

export function buildMarketLine(item: DailySelectionItem) {
  const { facts, category } = item;
  const prefix = `${facts.symbol} ${facts.shortName}，收盤 ${formatPlainNumber(facts.session.close)} 元，單日變動 ${formatSignedPercent(facts.session.dailyChangePercent)}`;

  switch (category) {
    case "market-move":
      return `${prefix}；今天從市場異動角度觀察。`;
    case "volume-anomaly":
      return `${prefix}；成交量是近 20 個交易日中位量的 ${(facts.session.volumeRatio20SessionMedian ?? 0).toFixed(1)} 倍，列入量能異常。`;
    case "dense-aspects":
      return `${prefix}；3° 容許度內有 ${facts.transits.length} 組主要相位，列入相位密集。`;
    case "historical-divergence": {
      const spread = interquartileSpread(facts.study);
      return `${prefix}；同組態四分位跨度 ${spread?.toFixed(1) ?? "無法計算"} 個百分點，列入歷史分歧。`;
    }
    case "today-history-contrast":
      return `${prefix}；同組態 D+${facts.study?.horizon ?? 20} 中位 ${formatSignedPercent(facts.study?.statistics.medianReturn ?? 0)}，列入今昔反差。`;
  }
}

export function buildConfigurationLine(item: DailySelectionItem) {
  const transit = primaryTransit(item);
  if (!transit) return `現在的盤：3° 容許度內沒有可讀取的主要相位。`;
  const count = item.facts.transits.length;
  const density = count > 1 ? `3° 內共 ${count} 組主要相位。` : `3° 內共 1 組主要相位。`;
  return `現在的盤：行運${transit.transitBodyZh}與本命${transit.natalBodyZh}形成${transit.aspectZh}，容許度 ${transit.orb.toFixed(2)}°；${density}`;
}

function completeDescriptiveStatistics(study: InquiryStudy) {
  const stats = study.statistics;
  return stats.medianReturn !== null
    && stats.q1Return !== null
    && stats.q3Return !== null
    && stats.medianAdverseMove !== null
    && stats.worstAdverseMove !== null;
}

export function buildHistoryLine(study: InquiryStudy | null) {
  if (!study) return `找不到可與當日主要相位對齊的事件研究；樣本不足，這段不做歷史推論。`;
  const stats = study.statistics;

  if (study.status === "no-sample" || stats.sampleSize === 0) {
    return `過去同組態沒有可完成 D+${study.horizon} 觀察的樣本；樣本數 0 筆，不做分布解讀。`;
  }

  if (study.status !== "descriptive-only" || stats.sampleSize < study.minimumDescriptiveSample) {
    return `過去同組態只找到 ${stats.sampleSize} 筆可完成 D+${study.horizon} 的樣本，未達 ${study.minimumDescriptiveSample} 筆；樣本不足，不做分布解讀。`;
  }

  if (!completeDescriptiveStatistics(study)) {
    return `過去同組態有 ${stats.sampleSize} 筆樣本，但統計欄位不完整；這段不做分布解讀。`;
  }

  const directions = studyDirectionCounts(study);
  return `過去同組態有 ${stats.sampleSize} 筆完整樣本。往後 ${study.horizon} 個交易日的未還原收盤價變動，中位數 ${formatSignedPercent(stats.medianReturn as number)}，四分位區間 ${formatSignedPercent(stats.q1Return as number)} 至 ${formatSignedPercent(stats.q3Return as number)}，上行 ${directions.positive} 筆、下行 ${directions.negative} 筆、持平 ${directions.zero} 筆；期間最不利變動中位數 ${formatSignedPercent(stats.medianAdverseMove as number)}，最差 ${formatSignedPercent(stats.worstAdverseMove as number)}。`;
}

export function buildCoverageLine(item: DailySelectionItem) {
  const coverage = item.facts.coverage;
  if (!coverage.from || !coverage.to) return `歷史價格涵蓋日期不完整，這段不能發布。`;
  const range = `歷史價格涵蓋 ${formatDateZh(coverage.from)}至 ${formatDateZh(coverage.to)}，共 ${coverage.sessions} 個交易日；收到 ${coverage.receivedMonths}/${coverage.requestedMonths} 個月`;
  if (coverage.complete && coverage.missingMonths.length === 0) return `${range}，沒有缺月。`;
  return `${range}，缺 ${coverage.missingMonths.length} 個月；事件研究已排除跨越缺月的案例。`;
}

function compactConfigurationLine(item: DailySelectionItem) {
  const transit = primaryTransit(item);
  if (!transit) return `沒有可讀取的主要相位`;
  return `${transit.transitBodyZh}${transit.aspectZh}本命${transit.natalBodyZh}`;
}

function compactHistoryLedger(study: InquiryStudy, focus: "median" | "quartiles" = "median") {
  const stats = study.statistics;
  const directions = studyDirectionCounts(study);
  const counts = [
    `${directions.positive} 漲`,
    `${directions.negative} 跌`,
    ...(directions.zero > 0 ? [`${directions.zero} 平`] : []),
  ].join(" ");
  const result = `D+${study.horizon} 共 ${stats.sampleSize} 次，${counts}`;
  if (focus === "quartiles") {
    return `${result}，中間一半 ${formatSignedPercent(stats.q1Return as number)} 到 ${formatSignedPercent(stats.q3Return as number)}。`;
  }
  return `${result}，中位 ${formatSignedPercent(stats.medianReturn as number)}。`;
}

function spokenDailyMovement(value: number) {
  if (value > 0) return `漲 ${Math.abs(value).toFixed(1)}%`;
  if (value < 0) return `跌 ${Math.abs(value).toFixed(1)}%`;
  return "持平";
}

function spokenSmallCount(value: number) {
  const numerals = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  return numerals[value] ?? String(value);
}

/** Concise voice-over; the detailed fields remain available for cards and review. */
export function buildNarrationLine(item: DailySelectionItem) {
  const facts = item.facts;
  const study = descriptiveStudy(item);
  const market = `${facts.shortName}今天${spokenDailyMovement(facts.session.dailyChangePercent)}`;
  const configuration = compactConfigurationLine(item);
  switch (item.category) {
    case "market-move":
      return `價格先動：${market}，${configuration}；${compactHistoryLedger(study)}`;
    case "volume-anomaly": {
      const ratio = facts.session.volumeRatio20SessionMedian ?? 1;
      return `量能異動：${market}，量是二十日中位的 ${ratio.toFixed(1)} 倍，${configuration}；${compactHistoryLedger(study)}`;
    }
    case "dense-aspects":
      return `${spokenSmallCount(facts.transits.length)}組相位交會：${market}，主盤${configuration}；${compactHistoryLedger(study)}`;
    case "historical-divergence":
      return `歷史分岔：${market}，${configuration}；${compactHistoryLedger(study, "quartiles")}`;
    case "today-history-contrast": {
      const median = study.statistics.medianReturn as number;
      const directionProduct = facts.session.dailyChangePercent * median;
      const comparison = directionProduct === 0
        ? "一邊持平"
        : directionProduct < 0
          ? "今昔反向"
          : "今昔同向";
      return `${comparison}：${market}，${configuration}；${compactHistoryLedger(study)}`;
    }
  }
}

function hookGap(item: DailySelectionItem) {
  return Math.abs(
    item.facts.session.dailyChangePercent
      - (item.facts.study?.statistics.medianReturn ?? item.facts.session.dailyChangePercent),
  );
}

function hookTieBreak(a: DailySelectionItem, b: DailySelectionItem) {
  return hookGap(b) - hookGap(a) || a.facts.symbol.localeCompare(b.facts.symbol);
}

/** Selects the strongest fact-led opening without inventing a forecast. */
export function buildHook(selection: DailyFiveSelection) {
  const opposite = selection.items
    .filter((item) => (
      item.facts.study !== null
      && item.facts.session.dailyChangePercent * (item.facts.study.statistics.medianReturn ?? 0) < 0
    ))
    .sort(hookTieBreak)[0];
  if (opposite) {
    const study = descriptiveStudy(opposite);
    return `${opposite.facts.shortName}今天${spokenDailyMovement(opposite.facts.session.dailyChangePercent)}，同盤 D+${study.horizon} 中位卻${spokenDailyMovement(study.statistics.medianReturn as number)}。一正一負，盤在說什麼？`;
  }

  const volume = selection.items
    .filter((item) => (
      item.category === "volume-anomaly"
      && (item.facts.session.volumeRatio20SessionMedian ?? 0) >= 1.5
      && Math.abs(item.facts.session.dailyChangePercent) <= 2
    ))
    .sort((a, b) => (
      (b.facts.session.volumeRatio20SessionMedian ?? 0)
        - (a.facts.session.volumeRatio20SessionMedian ?? 0)
      || a.facts.symbol.localeCompare(b.facts.symbol)
    ))[0];
  if (volume) {
    return `${volume.facts.shortName}量是二十日中位的 ${(volume.facts.session.volumeRatio20SessionMedian as number).toFixed(1)} 倍，日線只動 ${signedDailyMovement(volume)}。量醒了，價格呢？`;
  }

  const divergence = [...selection.items].sort((a, b) => {
    const aSpread = interquartileSpread(a.facts.study) ?? 0;
    const bSpread = interquartileSpread(b.facts.study) ?? 0;
    return bSpread - aSpread || a.facts.symbol.localeCompare(b.facts.symbol);
  })[0];
  const divergenceStudy = descriptiveStudy(divergence);
  if ((interquartileSpread(divergenceStudy) ?? 0) > 0) {
    return `${divergence.facts.shortName}同盤，中間一半從 ${formatSignedPercent(divergenceStudy.statistics.q1Return as number)} 裂到 ${formatSignedPercent(divergenceStudy.statistics.q3Return as number)}。歷史為何分岔？`;
  }

  const dense = selection.items.find((item) => item.category === "dense-aspects");
  if (dense) {
    return `${dense.facts.transits.length} 組主要相位，同時擠進 3°。${dense.facts.shortName} 日線 ${signedDailyMovement(dense)}。`;
  }

  const market = selection.items[0];
  const study = descriptiveStudy(market);
  const directions = studyDirectionCounts(study);
  return `今天動得最大的是 ${market.facts.shortName}，日線 ${signedDailyMovement(market)}；同盤漲 ${directions.positive} 次、跌 ${directions.negative} 次。`;
}

function buildSegment(item: DailySelectionItem): DailyScriptSegment {
  const marketLine = buildMarketLine(item);
  const configurationLine = buildConfigurationLine(item);
  const historyLine = buildHistoryLine(item.facts.study);
  const coverageLine = buildCoverageLine(item);
  return {
    symbol: item.facts.symbol,
    shortName: item.facts.shortName,
    category: item.category,
    categoryLabel: item.categoryLabel,
    marketLine,
    configurationLine,
    historyLine,
    coverageLine,
    narration: buildNarrationLine(item),
  };
}

export function buildDailyScript(
  selection: DailyFiveSelection,
  options: DailyScriptOptions = {},
): DailyVideoScript {
  const hostName = options.hostName?.trim() || DEFAULT_HOST_NAME;
  const appName = options.appName?.trim() || DEFAULT_APP_NAME;
  const appUrl = options.appUrl?.trim() || DEFAULT_APP_URL;
  const dateLabel = formatDateZh(selection.date);
  const hostDisclosure = `我是 AI 虛擬觀測員${hostName}，內容由當日行情與盤勢問盤資料生成。`;
  const hook = buildHook(selection);
  const priceBasisLine = `資料截至 ${dateLabel}；價格皆為未還原收盤價，不含股息與除權息調整。`;
  const segments = selection.items.map(buildSegment) as FiveItems<DailyScriptSegment>;
  const boundaryLine = `這是財經文化研究，不是投資建議，也不提供買賣訊號。`;
  const ctaLine = `想看是哪幾次？到${appName}搜尋畫面上的股票代號：${appUrl}`;
  const title = `${dateLabel}｜今日五盤｜${selection.items.map((item) => `${item.facts.symbol} ${item.facts.shortName}`).join("・")}`;
  const fullNarration = [hook, hostDisclosure, priceBasisLine, ...segments.map((segment) => segment.narration), ctaLine, boundaryLine].join("\n");
  const categoryIndex = selection.items.map((item) => `${item.categoryLabel}｜${item.facts.symbol} ${item.facts.shortName}`).join("\n");
  const coverageIndex = segments.map((segment) => `${segment.symbol}｜${segment.coverageLine}`).join("\n");
  const researchLinks = selection.items
    .map((item) => `${item.facts.symbol} ${item.facts.shortName}｜${item.facts.appUrl}`)
    .join("\n");
  const caption = `${dateLabel}｜今日五盤\n${categoryIndex}\n\n完整研究\n${researchLinks}\n\n資料涵蓋\n${coverageIndex}\n\n${hostDisclosure}\n${priceBasisLine}\n${boundaryLine}\n${ctaLine}`;

  return {
    date: selection.date,
    series: "今日五盤",
    title,
    contentClassification: "財經文化研究",
    host: { name: hostName, isAi: true },
    hostDisclosure,
    hook,
    priceBasisLine,
    segments,
    boundaryLine,
    ctaLine,
    fullNarration,
    caption,
    hashtags: ["#今日五盤", "#盤勢", "#臺股資料"],
  };
}

export function buildDailyContentPackage(
  selection: DailyFiveSelection,
  options: DailyScriptOptions = {},
): DailyContentPackage {
  return { selection, script: buildDailyScript(selection, options) };
}
