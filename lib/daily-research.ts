import type { StoredEdition } from "@/studio/store";

type PublicEdition = Pick<
  StoredEdition,
  "tradeDate" | "status" | "actualVisibility" | "title" | "manifest" | "youtubeUrl"
>;

export type PublicDailyResearch = {
  date: string;
  title: string;
  selectionPolicy: "neutral-editorial-salience";
  items: Array<{
    symbol: string;
    shortName: string;
    category: string;
    industry: string;
    market: string;
    close: number;
    dailyChangePercent: number;
    configuration: { label: string; orb: number };
    study: {
      horizon: number;
      sampleSize: number;
      positiveCount: number;
      negativeCount: number;
      zeroCount: number;
      medianReturn: number | null;
      q1Return: number | null;
      q3Return: number | null;
    };
  }>;
  boundary: string;
  videoURL: string | null;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nullableFinite(value: unknown) {
  return value === null ? null : finite(value);
}

function publicItem(value: unknown) {
  const stock = record(value);
  const session = record(stock?.marketSession);
  const configuration = record(stock?.currentConfiguration);
  const study = record(stock?.study);
  const statistics = record(study?.statistics);
  if (!stock || !session || !configuration || !study || !statistics) return null;

  const symbol = text(stock.symbol);
  const shortName = text(stock.companyName);
  const category = text(stock.category);
  const industry = text(stock.industry);
  const market = text(stock.market);
  const close = finite(session.close);
  const dailyChangePercent = finite(session.dailyChangePercent);
  const configurationLabel = text(configuration.label);
  const orb = finite(configuration.orb);
  const horizon = finite(study.horizon);
  const sampleSize = finite(statistics.sampleSize);
  const positiveCount = finite(statistics.positiveCount);
  const zeroCount = finite(statistics.zeroCount);
  const medianReturn = nullableFinite(statistics.medianReturn);
  const q1Return = nullableFinite(statistics.q1Return);
  const q3Return = nullableFinite(statistics.q3Return);

  if (
    !symbol || !/^\d{4,6}$/.test(symbol) || !shortName || !category || !industry || !market
    || close === null || close <= 0 || dailyChangePercent === null
    || !configurationLabel || orb === null || orb < 0
    || horizon === null || sampleSize === null || positiveCount === null || zeroCount === null
  ) return null;

  const negativeCount = sampleSize - positiveCount - zeroCount;
  if (
    !Number.isInteger(horizon) || !Number.isInteger(sampleSize)
    || !Number.isInteger(positiveCount) || !Number.isInteger(zeroCount)
    || sampleSize < 5 || positiveCount < 1 || negativeCount < 1 || zeroCount < 0
  ) return null;

  return {
    symbol,
    shortName,
    category,
    industry,
    market,
    close,
    dailyChangePercent,
    configuration: { label: configurationLabel, orb },
    study: {
      horizon,
      sampleSize,
      positiveCount,
      negativeCount,
      zeroCount,
      medianReturn,
      q1Return,
      q3Return,
    },
  };
}

export function buildPublicDailyResearch(editions: PublicEdition[]): PublicDailyResearch | null {
  const edition = editions.find((item) => (
    item.status === "scheduled"
    && item.actualVisibility === "public"
    && /^\d{4}-\d{2}-\d{2}$/.test(item.tradeDate)
  ));
  if (!edition) return null;

  const stocks = edition.manifest.stocks;
  if (!Array.isArray(stocks)) return null;
  const items = stocks.map(publicItem);
  if (items.length !== 5 || items.some((item) => item === null)) return null;

  return {
    date: edition.tradeDate,
    title: "今日五盤",
    selectionPolicy: "neutral-editorial-salience",
    items: items as PublicDailyResearch["items"],
    boundary: "五檔依固定的市場顯著性與資料完整度選出，不按歷史報酬高低排序。歷史重合不代表因果，也不是推薦或未來方向。",
    videoURL: edition.youtubeUrl,
  };
}
