import type { InquiryStudy } from "@/lib/inquiry-types";
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
    case "rare-sample":
      return `${prefix}；同組態只有 ${facts.study?.statistics.sampleSize ?? 0} 筆完整樣本，列入稀有組態。`;
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

  return `過去同組態有 ${stats.sampleSize} 筆完整樣本。往後 ${study.horizon} 個交易日的未還原收盤價變動，中位數 ${formatSignedPercent(stats.medianReturn as number)}，四分位區間 ${formatSignedPercent(stats.q1Return as number)} 至 ${formatSignedPercent(stats.q3Return as number)}，正變動 ${stats.positiveCount} 筆、零變動 ${stats.zeroCount} 筆；期間最不利變動中位數 ${formatSignedPercent(stats.medianAdverseMove as number)}，最差 ${formatSignedPercent(stats.worstAdverseMove as number)}。`;
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
  if (!transit) return `3° 內沒有可讀取的主要相位。`;
  return `現在是行運${transit.transitBodyZh}${transit.aspectZh}本命${transit.natalBodyZh}，容許度 ${transit.orb.toFixed(2)}°。`;
}

function compactHistoryLine(study: InquiryStudy | null) {
  if (!study) return `同盤資料不足，不解讀分布。`;
  const stats = study.statistics;
  if (study.status === "no-sample" || stats.sampleSize === 0) {
    return `同盤 0 筆，樣本不足，不解讀分布。`;
  }
  if (study.status !== "descriptive-only" || stats.sampleSize < study.minimumDescriptiveSample) {
    return `同盤 ${stats.sampleSize} 筆，未達 ${study.minimumDescriptiveSample} 筆，樣本不足。`;
  }
  if (!completeDescriptiveStatistics(study)) {
    return `同盤 ${stats.sampleSize} 筆，但統計欄位不完整，本期不發布。`;
  }
  return `同盤 ${stats.sampleSize} 筆；D+${study.horizon} 中位 ${formatSignedPercent(stats.medianReturn as number)}，四分位 ${formatSignedPercent(stats.q1Return as number)} 至 ${formatSignedPercent(stats.q3Return as number)}，正變動 ${stats.positiveCount} 筆。`;
}

function compactCategoryCue(item: DailySelectionItem) {
  switch (item.category) {
    case "market-move":
      return "";
    case "volume-anomaly":
      return `量能為近 20 個交易日中位量的 ${(item.facts.session.volumeRatio20SessionMedian ?? 0).toFixed(1)} 倍。`;
    case "dense-aspects":
      return `3° 內共 ${item.facts.transits.length} 組主要相位。`;
    case "historical-divergence": {
      const spread = interquartileSpread(item.facts.study);
      return `同盤四分位跨度 ${spread?.toFixed(1) ?? "無法計算"} 個百分點。`;
    }
    case "rare-sample":
      return "";
  }
}

/** Concise voice-over; the detailed fields remain available for cards and review. */
export function buildNarrationLine(item: DailySelectionItem) {
  const facts = item.facts;
  const market = `收盤 ${formatPlainNumber(facts.session.close)} 元，日變動 ${formatSignedPercent(facts.session.dailyChangePercent)}。`;
  return `${item.categoryLabel}，${facts.symbol} ${facts.shortName}。${market}${compactCategoryCue(item)}${compactConfigurationLine(item)}${compactHistoryLine(facts.study)}`;
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
  const hostDisclosure = `我是 AI 虛擬觀測員${hostName}。以下由當日行情與盤勢問盤資料生成。`;
  const hook = `五檔股票，五種入選理由。把今天的盤，放回歷史裡看。`;
  const priceBasisLine = `資料截至 ${dateLabel}；價格皆為未還原收盤價，不含股息與除權息調整。`;
  const segments = selection.items.map(buildSegment) as FiveItems<DailyScriptSegment>;
  const boundaryLine = `這是財經文化研究，不是投資建議，不提供買賣訊號。`;
  const ctaLine = `完整案例、反例與資料缺口，到${appName}搜尋股票代號：${appUrl}`;
  const title = `${dateLabel}｜今日五盤｜${selection.items.map((item) => `${item.facts.symbol} ${item.facts.shortName}`).join("・")}`;
  const fullNarration = [hostDisclosure, hook, priceBasisLine, ...segments.map((segment) => segment.narration), boundaryLine, ctaLine].join("\n");
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
