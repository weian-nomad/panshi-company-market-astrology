import companyRegistry from "@/data/twse-company-registry.json";
import type { PriceBar } from "@/lib/astrology";

type TwseMonth = {
  stat?: string;
  date?: string;
  data?: string[][];
};

type TwseHolidaySchedule = {
  stat?: string;
  title?: string;
  data?: string[][];
};

export type CompanyRecord = (typeof companyRegistry)[number];

export type TradingDateResolution = {
  requestedDate: string;
  effectiveDate: string;
  adjusted: boolean;
  reason: string | null;
  calendarBasis: "official" | "weekday-fallback";
};

export type PriceHistory = {
  bars: PriceBar[];
  coverage: {
    requestedMonths: number;
    receivedMonths: number;
    missingMonths: string[];
    from: string | null;
    to: string | null;
    sessions: number;
    complete: boolean;
    basis: "raw-unadjusted-close";
  };
};

export const COMPANY_ENDPOINT = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L";
export const PRICE_ENDPOINT = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY";
export const PRICE_FALLBACK_ENDPOINT = "https://www.twse.com.tw/exchangeReport/STOCK_DAY";
export const PRICE_SOURCE_PAGE = "https://www.twse.com.tw/zh/trading/historical/stock-day.html";
export const HOLIDAY_ENDPOINT = "https://www.twse.com.tw/holidaySchedule/holidaySchedule";
export const HOLIDAY_SOURCE_PAGE = "https://www.twse.com.tw/zh/trading/holiday.html";

const PRICE_REQUEST_TIMEOUT_MS = 5_000;
const PRICE_HISTORY_DEADLINE_MS = 24_000;
const PRICE_CONCURRENCY = 10;

export const INDUSTRIES: Record<string, string> = {
  "01": "水泥工業",
  "02": "食品工業",
  "03": "塑膠工業",
  "04": "紡織纖維",
  "05": "電機機械",
  "06": "電器電纜",
  "08": "玻璃陶瓷",
  "09": "造紙工業",
  "10": "鋼鐵工業",
  "11": "橡膠工業",
  "12": "汽車工業",
  "14": "建材營造",
  "15": "航運業",
  "16": "觀光餐旅",
  "17": "金融保險",
  "18": "貿易百貨",
  "20": "其他",
  "21": "化學工業",
  "22": "生技醫療",
  "23": "油電燃氣",
  "24": "半導體業",
  "25": "電腦及週邊設備",
  "26": "光電業",
  "27": "通信網路",
  "28": "電子零組件",
  "29": "電子通路",
  "30": "資訊服務",
  "31": "其他電子",
  "32": "文化創意",
  "33": "農業科技",
  "34": "電子商務",
  "35": "綠能環保",
  "36": "數位雲端",
  "37": "運動休閒",
  "38": "居家生活",
};

export function compactDate(value: string) {
  const cleaned = String(value || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cleaned)) throw new Error("公司日期資料不完整");
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
}

export function registryReportDate(value: string) {
  const cleaned = String(value || "").replace(/\D/g, "");
  if (/^\d{7}$/.test(cleaned)) {
    const year = Number(cleaned.slice(0, 3)) + 1911;
    return `${year}-${cleaned.slice(3, 5)}-${cleaned.slice(5, 7)}`;
  }
  return compactDate(cleaned);
}

function rocDate(value: string) {
  const match = /^(\d{2,3})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("股價日期格式不正確");
  const year = Number(match[1]) + 1911;
  return `${year}-${match[2]}-${match[3]}`;
}

function numberValue(value: string) {
  const numeric = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

export function buildMonthKeys(total: number, notBefore?: string, now = new Date()) {
  const keys: string[] = [];
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    keys.push(
      `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}01`,
    );
  }
  const firstApplicableMonth = notBefore
    ? `${notBefore.slice(0, 4)}${notBefore.slice(5, 7)}01`
    : null;
  return firstApplicableMonth
    ? keys.filter((key) => key >= firstApplicableMonth)
    : keys;
}

async function fetchTwseMonth(
  endpoint: string,
  symbol: string,
  date: string,
  deadlineAt: number,
) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) return null;
  const url = new URL(endpoint);
  url.searchParams.set("date", date);
  url.searchParams.set("stockNo", symbol);
  url.searchParams.set("response", "json");

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1, Math.min(PRICE_REQUEST_TIMEOUT_MS, remaining)),
  );
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      next: { revalidate: 21_600 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as TwseMonth;
    if (Array.isArray(payload.data)) return payload;
    if (/沒有符合|no data/i.test(payload.stat || "")) return { ...payload, data: [] };
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchMonthWithFallback(symbol: string, date: string, deadlineAt: number) {
  const primary = await fetchTwseMonth(PRICE_ENDPOINT, symbol, date, deadlineAt);
  if (primary) return primary;
  return fetchTwseMonth(PRICE_FALLBACK_ENDPOINT, symbol, date, deadlineAt);
}

export async function fetchPriceHistory(
  symbol: string,
  months: number,
  options?: { notBefore?: string },
): Promise<PriceHistory> {
  const keys = buildMonthKeys(months, options?.notBefore);
  const results: Array<TwseMonth | null> = new Array(keys.length).fill(null);
  const deadlineAt = Date.now() + PRICE_HISTORY_DEADLINE_MS;
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < keys.length && Date.now() < deadlineAt) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fetchMonthWithFallback(symbol, keys[index], deadlineAt);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(PRICE_CONCURRENCY, keys.length) }, () => worker()),
  );

  const byDate = new Map<string, PriceBar>();
  for (const payload of results) {
    if (!payload?.data) continue;
    for (const row of payload.data) {
      if (!Array.isArray(row) || row.length < 9) continue;
      try {
        const bar = {
          date: rocDate(row[0]),
          volume: numberValue(row[1]),
          open: numberValue(row[3]),
          high: numberValue(row[4]),
          low: numberValue(row[5]),
          close: numberValue(row[6]),
        };
        if (bar.close > 0) byDate.set(bar.date, bar);
      } catch {
        continue;
      }
    }
  }

  const bars = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const missingMonths = keys.filter((_, index) => results[index] === null);
  return {
    bars,
    coverage: {
      requestedMonths: keys.length,
      receivedMonths: keys.length - missingMonths.length,
      missingMonths,
      from: bars[0]?.date || null,
      to: bars.at(-1)?.date || null,
      sessions: bars.length,
      complete: missingMonths.length === 0,
      basis: "raw-unadjusted-close",
    },
  };
}

export async function fetchPriceBars(
  symbol: string,
  months: number,
  options?: { notBefore?: string },
): Promise<PriceBar[]> {
  return (await fetchPriceHistory(symbol, months, options)).bars;
}

export function findCompany(symbol: string): CompanyRecord | null {
  return companyRegistry.find((item) => item.symbol === symbol) ?? null;
}

function validateIsoDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("請使用 YYYY-MM-DD 日期格式");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error("目標日期不存在");
  }
  return date;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function scheduleDisposition(name: string, description: string) {
  const text = `${name} ${description}`;
  if (/開始交易|最後交易|恢復交易/.test(text) && !/無交易|停止交易|休市/.test(text)) {
    return "open" as const;
  }
  if (/無交易|停止交易|休市|放假/.test(text)) return "closed" as const;
  return null;
}

export function parseHolidaySchedule(payload: TwseHolidaySchedule, year: number) {
  if (
    payload.stat?.toLowerCase() !== "ok" ||
    !Array.isArray(payload.data) ||
    payload.data.length === 0
  ) return null;

  const schedule = new Map<string, { disposition: "open" | "closed" | null; name: string }>();
  for (const row of payload.data) {
    if (
      !Array.isArray(row) ||
      row.length < 2 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row[0]) ||
      !row[0].startsWith(`${year}-`)
    ) continue;
    schedule.set(row[0], {
      disposition: scheduleDisposition(row[1] || "", row[2] || ""),
      name: row[1] || "交易所行事曆",
    });
  }
  return schedule.size ? schedule : null;
}

async function fetchHolidaySchedule(year: number) {
  const url = new URL(HOLIDAY_ENDPOINT);
  url.searchParams.set("response", "json");
  url.searchParams.set("queryYear", String(year - 1911));
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 86_400 },
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as TwseHolidaySchedule;
    return parseHolidaySchedule(payload, year);
  } catch {
    return null;
  }
}

export async function resolveTradingDate(requestedDate: string): Promise<TradingDateResolution> {
  const requested = validateIsoDate(requestedDate);
  const schedules = new Map<number, Awaited<ReturnType<typeof fetchHolidaySchedule>>>();
  let usedFallback = false;
  let closureReason: string | null = null;

  for (let offset = 0; offset <= 14; offset += 1) {
    const candidate = new Date(requested.getTime() + offset * 86_400_000);
    const candidateText = isoDate(candidate);
    const year = candidate.getUTCFullYear();
    if (!schedules.has(year)) schedules.set(year, await fetchHolidaySchedule(year));
    const schedule = schedules.get(year);
    if (!schedule) usedFallback = true;

    const scheduled = schedule?.get(candidateText);
    const weekday = candidate.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const isOpen = scheduled?.disposition === "open" || (!weekend && scheduled?.disposition !== "closed");

    if (isOpen) {
      return {
        requestedDate,
        effectiveDate: candidateText,
        adjusted: offset > 0,
        reason: offset > 0
          ? closureReason || "原目標日不是交易日，已順延至下一個交易日"
          : null,
        calendarBasis: usedFallback ? "weekday-fallback" : "official",
      };
    }

    if (offset === 0) {
      closureReason = scheduled?.disposition === "closed"
        ? `${scheduled.name}，已順延至下一個交易日`
        : "原目標日為週末，已順延至下一個交易日";
    }
  }

  throw new Error("無法在目標日後 14 天內確認交易日");
}
