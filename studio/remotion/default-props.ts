import type { RemotionVideoProps, StockScene } from "./types";
import { createTimedCaptionTokens } from "./utils";

const DATE = "2026-07-13";
const STOCK_FRAMES = 276;

const samples = [
  ["2330", "台積電", "半導體業", "market-move", "市場異動", 1715, 2.4, 12, 7, 1.8, -1.1, 4.6, [1.2, -0.8, 3.4, 2.1, -1.6, 5.2, 0.4, 1.9, -2.1, 4.8, 0.1, 2.7]],
  ["2454", "聯發科", "半導體業", "volume-anomaly", "量能異常", 1390, -1.1, 9, 5, -0.6, -3.2, 2.4, [-4.1, 1.2, -0.7, 3.1, -2.4, 0.2, 2.8, -1.1, -3.5]],
  ["2317", "鴻海", "其他電子業", "dense-aspects", "相位密集", 226, 1.7, 14, 8, 1.1, -1.8, 3.7, [1.3, -1.4, 2.6, 4.1, -0.4, 0.8, 3.2, -2.7, 1.9, 0.2, 5.1, -1.8, 2.4, 1.2]],
  ["2308", "台達電", "電子零組件業", "historical-divergence", "歷史分歧", 688, 0.5, 11, 6, 0.4, -5.8, 6.3, [-8.2, 6.1, -4.8, 7.4, 0.2, -2.6, 5.5, 1.8, -6.4, 8.1, 0.6]],
  ["2382", "廣達", "電腦及週邊設備業", "today-history-contrast", "今昔反差", 298.5, -0.3, 8, 4, 2.1, -2.8, 5.4, [2.1, -1.4, 0.7, 3.2, -2.8, 4.1, -0.9, 5.4]],
] as const;

function makeStock(index: number): StockScene {
  const sample = samples[index];
  const [symbol, shortName, industry, category, categoryLabel, close, dailyChange, sampleSize, positiveCount, median, q1, q3, cases] = sample;
  const narration = `${categoryLabel}，${shortName} ${symbol}。今天的市場與現在相位，回看同組態 ${sampleSize} 筆。這是歷史描述，不讀方向。`;
  return {
    kind: "stock",
    id: `${String(index + 1).padStart(2, "0")}-${symbol}`,
    audioSrc: "",
    durationFrames: STOCK_FRAMES,
    captionTokens: createTimedCaptionTokens(narration, STOCK_FRAMES),
    narration,
    ordinal: index + 1,
    symbol,
    shortName,
    industry,
    market: "TWSE",
    category,
    categoryLabel,
    close,
    dailyChangePercent: dailyChange,
    volumeRatio20SessionMedian: category === "volume-anomaly" ? 2.8 : 1.1,
    salienceSummary: categoryLabel,
    configuration: {
      transitBodyZh: index % 2 === 0 ? "土星" : "木星",
      transitGlyph: index % 2 === 0 ? "♄" : "♃",
      natalBodyZh: index % 3 === 0 ? "太陽" : "金星",
      natalGlyph: index % 3 === 0 ? "☉" : "♀",
      aspectZh: index % 2 === 0 ? "三分相" : "四分相",
      aspectGlyph: index % 2 === 0 ? "△" : "□",
      orb: 0.74 + index * 0.31,
      transitLongitude: 32 + index * 57,
      natalLongitude: 196 + index * 29,
      activeAspectCount: index === 2 ? 4 : 1 + (index % 2),
    },
    history: {
      horizon: 20,
      status: sampleSize >= 5 ? "descriptive-only" : "insufficient-sample",
      minimumDescriptiveSample: 5,
      sampleSize,
      positiveCount,
      negativeCount: cases.filter((value) => value < 0).length,
      zeroCount: 0,
      medianReturn: median,
      q1Return: q1,
      q3Return: q3,
      medianAdverseMove: -3.4,
      worstAdverseMove: -9.2,
      caseReturns: [...cases],
    },
    coverage: {
      from: "2019-07-15",
      to: DATE,
      sessions: 1712,
      complete: true,
    },
  };
}

const stockScenes = [makeStock(0), makeStock(1), makeStock(2), makeStock(3), makeStock(4)] as const;
const stockIndex = stockScenes.map((scene) => ({
  symbol: scene.symbol,
  shortName: scene.shortName,
  categoryLabel: scene.categoryLabel,
}));
const introNarration = "同一個盤，中間一半從負百分之五點八，裂到正百分之六點三。今天先看台達電。我是 AI 虛擬觀測員墨衡。";
const outroNarration = "五檔是五種觀察角度，不是排行。這是財經文化研究，不是投資建議。完整案例與反例，都在盤勢。";

export const defaultRemotionVideoProps: RemotionVideoProps = {
  schemaVersion: 1,
  date: DATE,
  series: "今日五盤",
  contentClassification: "財經文化研究",
  presenterSrc: "studio/presenter/moheng-virtual-host.png",
  hostName: "墨衡",
  appUrl: "https://panshi.nomadsustaintech.com/",
  scenes: [
    {
      kind: "intro",
      id: "00-intro",
      audioSrc: "",
      durationFrames: 180,
      captionTokens: createTimedCaptionTokens(introNarration, 180),
      narration: introNarration,
      date: DATE,
      dateLabel: "2026 年 7 月 13 日",
      series: "今日五盤",
      hook: "同一個盤，中間一半從 -5.8% 裂到 +6.3%。今天先看台達電。",
      hostName: "墨衡",
      hostDisclosure: "我是 AI 虛擬觀測員墨衡。",
      priceBasisLine: "資料截至 2026 年 7 月 13 日；價格皆為未還原收盤價。",
      stockIndex,
    },
    ...stockScenes,
    {
      kind: "outro",
      id: "06-outro",
      audioSrc: "",
      durationFrames: 180,
      captionTokens: createTimedCaptionTokens(outroNarration, 180),
      narration: outroNarration,
      boundaryLine: "這是財經文化研究，不是投資建議，不提供買賣訊號。",
      ctaLine: "完整案例、反例與資料缺口，到盤勢搜尋股票代號。",
      appUrl: "https://panshi.nomadsustaintech.com/",
      stockIndex: stockScenes.map((scene) => ({ symbol: scene.symbol, categoryLabel: scene.categoryLabel })),
    },
  ],
};
