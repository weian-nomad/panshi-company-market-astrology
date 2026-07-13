import type { TransitConfiguration } from "@/lib/astrology";
import type { PriceHistory } from "@/lib/company-data";
import type { InquiryStudy } from "@/lib/inquiry-types";

/**
 * The five editorial lenses are intentionally descriptive. They explain why a
 * company is worth examining today; they never describe it as worth trading.
 */
export const EDITORIAL_CATEGORIES = [
  "market-move",
  "volume-anomaly",
  "dense-aspects",
  "historical-divergence",
  "rare-sample",
] as const;

export type EditorialCategory = (typeof EDITORIAL_CATEGORIES)[number];

export const EDITORIAL_CATEGORY_LABELS: Record<EditorialCategory, string> = {
  "market-move": "市場異動",
  "volume-anomaly": "量能異常",
  "dense-aspects": "相位密集",
  "historical-divergence": "歷史分歧",
  "rare-sample": "稀有組態",
};

export type DailyStockFacts = {
  /** Taiwan trading/content date in YYYY-MM-DD. */
  date: string;
  symbol: string;
  shortName: string;
  industry: string;
  market: "TWSE" | "TPEx";
  session: {
    date: string;
    close: number;
    dailyChangePercent: number;
    /** Today's volume divided by the median volume of the previous 20 sessions. */
    volumeRatio20SessionMedian: number | null;
  };
  /** The existing inquiry engine remains the source of symbolic facts. */
  transits: TransitConfiguration[];
  /** The existing event-study result remains the source of historical claims. */
  study: InquiryStudy | null;
  coverage: PriceHistory["coverage"];
  /** Absolute public URL for the corresponding Panshi research view. */
  appUrl: string;
};

export type SalienceMetric =
  | "absolute-daily-change"
  | "volume-ratio-to-20-session-median"
  | "active-aspect-count"
  | "interquartile-spread"
  | "exact-sample-count";

export type DailySelectionItem = {
  category: EditorialCategory;
  categoryLabel: string;
  facts: DailyStockFacts;
  salience: {
    metric: SalienceMetric;
    value: number;
    summary: string;
  };
};

export type FiveItems<T> = [T, T, T, T, T];

export type DailyFiveSelection = {
  date: string;
  policy: "neutral-editorial-salience";
  items: FiveItems<DailySelectionItem>;
  diversification: {
    recentSymbolsConsidered: string[];
    precedence: ["recent-symbol", "signature", "industry", "category-salience", "symbol"];
  };
};

export type DailyScriptSegment = {
  symbol: string;
  shortName: string;
  category: EditorialCategory;
  categoryLabel: string;
  marketLine: string;
  configurationLine: string;
  historyLine: string;
  coverageLine: string;
  narration: string;
};

export type DailyVideoScript = {
  date: string;
  series: "今日五盤";
  title: string;
  contentClassification: "財經文化研究";
  host: {
    name: string;
    isAi: true;
  };
  hostDisclosure: string;
  hook: string;
  priceBasisLine: string;
  segments: FiveItems<DailyScriptSegment>;
  boundaryLine: string;
  ctaLine: string;
  fullNarration: string;
  caption: string;
  hashtags: string[];
};

export type DailyContentPackage = {
  selection: DailyFiveSelection;
  script: DailyVideoScript;
};

export type DailyScriptOptions = {
  hostName?: string;
  appName?: string;
  appUrl?: string;
};

export type ContentValidationIssue = {
  code: string;
  path: string;
  message: string;
};

export type ContentValidationResult = {
  valid: boolean;
  errors: ContentValidationIssue[];
};

export type ContentValidationOptions = {
  /** Defaults to the current calendar date in Asia/Taipei. */
  expectedDate?: string;
  /** Injectable clock for deterministic jobs and tests. */
  now?: Date;
};
