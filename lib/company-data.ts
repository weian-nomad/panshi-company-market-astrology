import companyRegistry from "@/data/twse-company-registry.json";
import type { PriceBar } from "@/lib/astrology";
import { fetchWithTimeout } from "@/lib/http-timeout";

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
export const PRICE_SOURCE_PAGE = "https://www.twse.com.tw/zh/trading/historical/stock-day.html";
export const HOLIDAY_ENDPOINT = "https://www.twse.com.tw/holidaySchedule/holidaySchedule";
export const HOLIDAY_SOURCE_PAGE = "https://www.twse.com.tw/zh/trading/holiday.html";
export const DAILY_ALL_ENDPOINT = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX";

// TWSE/TPEx resolve to several round-robin backend IPs; some are
// intermittently unreachable from our host while others respond in well
// under a second. A short timeout + retry (see withRetry callers) "rerolls"
// onto a different backend fast, instead of one bad pick eating 8+ seconds.
const DAILY_BULK_TIMEOUT_MS = 3_000;
const REGISTRY_TIMEOUT_MS = 6_000;
const HOLIDAY_TIMEOUT_MS = 4_000;

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

function numberValue(value: string) {
  const numeric = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

export function findCompany(symbol: string): CompanyRecord | null {
  return companyRegistry.find((item) => item.symbol === symbol) ?? null;
}

type TwseDailyTable = {
  title?: string;
  fields?: string[];
  data?: string[][];
};

export type TwseDailyPayload = {
  stat?: string;
  date?: string | number;
  tables?: TwseDailyTable[];
};

const TWSE_MIN_RAW_DAILY_ROWS = 500;
const TWSE_MIN_PARSED_DAILY_ROWS = 400;
const TWSE_MIN_PARSE_RATIO = 0.5;
const TWSE_DAILY_COLUMNS = [
  [0, "證券代號"],
  [2, "成交股數"],
  [5, "開盤價"],
  [6, "最高價"],
  [7, "最低價"],
  [8, "收盤價"],
] as const;

/** Parse and validate the official TWSE whole-market response. */
export function parseTwseDailyQuotesPayload(
  isoDate: string,
  payload: TwseDailyPayload,
): Array<{ symbol: string; bar: PriceBar }> {
  const compact = isoDate.replace(/-/g, "");
  const stat = String(payload.stat || "").trim();

  if (stat.toUpperCase() !== "OK") {
    const hasRows = payload.tables?.some((table) => Array.isArray(table.data) && table.data.length > 0);
    if (/\u6c92\u6709\u7b26\u5408\u689d\u4ef6\u7684\u8cc7\u6599/.test(stat) && !hasRows) return [];
    throw new Error(`TWSE ${isoDate} daily quote response status is invalid: ${stat || "missing"}`);
  }

  const responseDate = String(payload.date ?? "").replace(/\D/g, "");
  if (responseDate !== compact) {
    throw new Error(`TWSE daily quote date mismatch: requested ${compact}, received ${responseDate || "missing"}`);
  }
  if (!Array.isArray(payload.tables)) {
    throw new Error(`TWSE ${isoDate} daily quote tables are missing`);
  }
  const table = payload.tables.find((item) => (item.title || "").includes("每日收盤行情"));
  if (!table || !Array.isArray(table.data)) {
    throw new Error(`TWSE ${isoDate} daily closing table is missing`);
  }
  if (!TWSE_DAILY_COLUMNS.every(([index, label]) => table.fields?.[index]?.trim() === label)) {
    throw new Error(`TWSE ${isoDate} daily quote columns are invalid`);
  }
  if (table.data.length < TWSE_MIN_RAW_DAILY_ROWS) {
    throw new Error(
      `TWSE ${isoDate} daily quote response is incomplete: ${table.data.length} raw rows`,
    );
  }

  const results: Array<{ symbol: string; bar: PriceBar }> = [];
  for (const row of table.data) {
    if (!Array.isArray(row) || row.length < 9) continue;
    const symbol = String(row[0] || "").trim();
    if (!/^\d{4}[A-Z]?$/.test(symbol)) continue;
    const close = numberValue(row[8]);
    if (close <= 0) continue;
    results.push({
      symbol,
      bar: {
        date: isoDate,
        volume: numberValue(row[2]),
        open: numberValue(row[5]),
        high: numberValue(row[6]),
        low: numberValue(row[7]),
        close,
      },
    });
  }

  if (
    results.length < TWSE_MIN_PARSED_DAILY_ROWS
    || results.length / table.data.length < TWSE_MIN_PARSE_RATIO
  ) {
    throw new Error(
      `TWSE ${isoDate} daily quote response is incomplete: ${results.length}/${table.data.length} usable rows`,
    );
  }
  if (new Set(results.map((row) => row.symbol)).size !== results.length) {
    throw new Error(`TWSE ${isoDate} daily quote response contains duplicate symbols`);
  }
  return results;
}

/**
 * Bulk daily OHLCV for ALL TWSE securities on one trading day (one request
 * instead of one per symbol). Returns an empty array for non-trading days
 * (weekends/holidays) — that is the normal "nothing happened" case, not an
 * error.
 */
export async function fetchTwseDailyQuotes(
  isoDate: string,
): Promise<Array<{ symbol: string; bar: PriceBar }>> {
  const compact = isoDate.replace(/-/g, "");
  const url = new URL(DAILY_ALL_ENDPOINT);
  url.searchParams.set("response", "json");
  url.searchParams.set("date", compact);
  url.searchParams.set("type", "ALLBUT0999");

  const response = await fetchWithTimeout(
    url,
    { headers: { Accept: "application/json" } },
    DAILY_BULK_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`TWSE 股價 HTTP ${response.status}`);
  const payload = (await response.json()) as TwseDailyPayload;
  return parseTwseDailyQuotesPayload(isoDate, payload);
}

type TwseCompanyRaw = {
  出表日期: string;
  公司代號: string;
  公司名稱: string;
  公司簡稱: string;
  產業別: string;
  成立日期: string;
  上市日期: string;
  英文簡稱: string;
  網址: string;
};

/** Live refresh of the TWSE company registry (the committed JSON is a point-in-time snapshot). */
export async function fetchTwseCompanyRegistryLive() {
  const response = await fetchWithTimeout(
    COMPANY_ENDPOINT,
    { headers: { Accept: "application/json" } },
    REGISTRY_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`TWSE 公司資料 HTTP ${response.status}`);
  const payload = (await response.json()) as TwseCompanyRaw[];
  if (!Array.isArray(payload)) throw new Error("TWSE 公司資料格式不正確");

  return payload
    .filter((row) => /^\d{4}[A-Z]?$/.test((row.公司代號 || "").trim()))
    .map((row) => ({
      symbol: row.公司代號.trim(),
      market: "TWSE" as const,
      shortName: (row.公司簡稱 || "").trim(),
      fullName: (row.公司名稱 || "").trim(),
      englishName: (row.英文簡稱 || "").trim(),
      establishedDate: registryReportDate(row.成立日期 || ""),
      listingDate: registryReportDate(row.上市日期 || ""),
      industryCode: (row.產業別 || "").trim(),
      website: (row.網址 || "").trim(),
      reportDate: (row.出表日期 || "").trim(),
    }))
    .filter((row) => row.establishedDate && row.listingDate);
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
    const response = await fetchWithTimeout(
      url,
      { headers: { Accept: "application/json" }, next: { revalidate: 86_400 } },
      HOLIDAY_TIMEOUT_MS,
    );
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
