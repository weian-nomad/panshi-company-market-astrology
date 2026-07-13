import type { PriceBar } from "@/lib/astrology";
import type { CompanyRow } from "@/lib/market-db";
import { fetchWithTimeout } from "@/lib/http-timeout";

export const TPEX_COMPANY_ENDPOINT = "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O";
export const TPEX_PRICE_ENDPOINT =
  "https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php";
export const TPEX_PRICE_SOURCE_PAGE = "https://www.tpex.org.tw/zh-tw/mainboard/trading/info/mi-index.html";

// TWSE/TPEx resolve to several round-robin backend IPs; some are
// intermittently unreachable from our host while others respond in well
// under a second. A short timeout + retry (see withRetry callers) "rerolls"
// onto a different backend fast, instead of one bad pick eating 8+ seconds.
const REGISTRY_TIMEOUT_MS = 6_000;
const DAILY_BULK_TIMEOUT_MS = 3_000;

type TpexCompanyRaw = {
  SecuritiesCompanyCode: string;
  CompanyName: string;
  CompanyAbbreviation: string;
  SecuritiesIndustryCode: string;
  DateOfIncorporation: string;
  DateOfListing: string;
  Symbol: string;
  WebAddress: string;
  Date: string;
};

type TpexPriceTable = {
  date: string;
  totalCount: number;
  fields?: string[];
  data: string[][];
};

export type TpexDailyPayload = {
  stat?: string;
  date?: string | number;
  tables?: TpexPriceTable[];
};

const TPEX_MIN_RAW_DAILY_ROWS = 400;
const TPEX_MIN_PARSED_DAILY_ROWS = 300;
const TPEX_MIN_PARSE_RATIO = 0.5;
const TPEX_DAILY_COLUMNS = [
  [0, "代號"],
  [2, "收盤"],
  [4, "開盤"],
  [5, "最高"],
  [6, "最低"],
  [7, "成交股數"],
] as const;

function numberValue(value: string) {
  const numeric = Number(String(value || "").replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric : 0;
}

/** "115/07/09" (ROC) -> "2026-07-09" (ISO) */
export function rocSlashToIso(value: string) {
  const match = /^(\d{2,3})\/(\d{2})\/(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("TPEx 日期格式不正確");
  const year = Number(match[1]) + 1911;
  return `${year}-${match[2]}-${match[3]}`;
}

/** "2026-07-09" (ISO) -> "115/07/09" (ROC) */
export function isoToRocSlash(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) throw new Error("日期格式不正確");
  const year = Number(match[1]) - 1911;
  return `${year}/${match[2]}/${match[3]}`;
}

/** "19670218" -> "1967-02-18"; also tolerates already-ISO input */
function compactOrIsoDate(value: string) {
  const cleaned = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  const digits = cleaned.replace(/\D/g, "");
  if (!/^\d{8}$/.test(digits)) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Parse and validate the official TPEx whole-market response. */
export function parseTpexDailyQuotesPayload(
  isoDate: string,
  payload: TpexDailyPayload,
): Array<{ symbol: string; bar: PriceBar }> {
  const compact = isoDate.replace(/-/g, "");
  if (String(payload.stat || "").trim().toLowerCase() !== "ok") {
    throw new Error(`TPEx ${isoDate} daily quote response status is invalid`);
  }
  const responseDate = String(payload.date ?? "").replace(/\D/g, "");
  if (responseDate !== compact) {
    throw new Error(`TPEx daily quote date mismatch: requested ${compact}, received ${responseDate || "missing"}`);
  }
  if (!Array.isArray(payload.tables) || !payload.tables[0]) {
    throw new Error(`TPEx ${isoDate} daily quote table is missing`);
  }
  const table = payload.tables[0];
  if (rocSlashToIso(String(table.date || "")) !== isoDate) {
    throw new Error(`TPEx daily quote table date mismatch for ${isoDate}`);
  }
  if (!Array.isArray(table.data)) {
    throw new Error(`TPEx ${isoDate} daily quote rows are missing`);
  }
  if (!TPEX_DAILY_COLUMNS.every(([index, label]) => table.fields?.[index]?.trim() === label)) {
    throw new Error(`TPEx ${isoDate} daily quote columns are invalid`);
  }
  const declaredCount = Number(table.totalCount);
  if (!Number.isInteger(declaredCount) || declaredCount < 0) {
    throw new Error(`TPEx ${isoDate} daily quote totalCount is invalid`);
  }
  if (table.data.length !== declaredCount) {
    throw new Error(
      `TPEx ${isoDate} daily quote response is incomplete: ${table.data.length}/${declaredCount} raw rows`,
    );
  }
  if (declaredCount === 0) return [];
  if (declaredCount < TPEX_MIN_RAW_DAILY_ROWS) {
    throw new Error(`TPEx ${isoDate} daily quote response is incomplete: ${declaredCount} raw rows`);
  }

  const results: Array<{ symbol: string; bar: PriceBar }> = [];
  for (const row of table.data) {
    if (!Array.isArray(row) || row.length < 8) continue;
    const symbol = String(row[0] || "").trim();
    if (!/^\d{4}[A-Z]?$/.test(symbol)) continue;
    const close = numberValue(row[2]);
    if (close <= 0) continue;
    results.push({
      symbol,
      bar: {
        date: isoDate,
        open: numberValue(row[4]),
        high: numberValue(row[5]),
        low: numberValue(row[6]),
        close,
        volume: numberValue(row[7]),
      },
    });
  }
  if (
    results.length < TPEX_MIN_PARSED_DAILY_ROWS
    || results.length / declaredCount < TPEX_MIN_PARSE_RATIO
  ) {
    throw new Error(
      `TPEx ${isoDate} daily quote response is incomplete: ${results.length}/${declaredCount} usable rows`,
    );
  }
  if (new Set(results.map((row) => row.symbol)).size !== results.length) {
    throw new Error(`TPEx ${isoDate} daily quote response contains duplicate symbols`);
  }
  return results;
}

export async function fetchTpexCompanyRegistry(): Promise<CompanyRow[]> {
  const response = await fetchWithTimeout(
    TPEX_COMPANY_ENDPOINT,
    { headers: { Accept: "application/json" } },
    REGISTRY_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`TPEx 公司資料 HTTP ${response.status}`);
  const payload = (await response.json()) as TpexCompanyRaw[];
  if (!Array.isArray(payload)) throw new Error("TPEx 公司資料格式不正確");

  return payload
    .filter((row) => /^\d{4}[A-Z]?$/.test((row.SecuritiesCompanyCode || "").trim()))
    .map((row) => ({
      symbol: row.SecuritiesCompanyCode.trim(),
      market: "TPEx" as const,
      shortName: (row.CompanyAbbreviation || "").trim(),
      fullName: (row.CompanyName || "").trim(),
      englishName: (row.Symbol || "").trim(),
      establishedDate: compactOrIsoDate(row.DateOfIncorporation),
      listingDate: compactOrIsoDate(row.DateOfListing),
      industryCode: (row.SecuritiesIndustryCode || "").trim(),
      website: (row.WebAddress || "").trim(),
      reportDate: (row.Date || "").trim(),
    }))
    .filter((row) => row.establishedDate && row.listingDate);
}

/**
 * Bulk daily OHLCV for ALL TPEx securities on one trading day.
 * Returns an empty array for non-trading days (weekends/holidays) — that is
 * the normal "nothing happened" case, not an error.
 */
export async function fetchTpexDailyQuotes(
  isoDate: string,
): Promise<Array<{ symbol: string; bar: PriceBar }>> {
  const url = new URL(TPEX_PRICE_ENDPOINT);
  url.searchParams.set("l", "zh-tw");
  url.searchParams.set("d", isoToRocSlash(isoDate));
  url.searchParams.set("se", "EW");
  url.searchParams.set("o", "json");

  const response = await fetchWithTimeout(
    url,
    { headers: { Accept: "application/json" } },
    DAILY_BULK_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`TPEx 股價 HTTP ${response.status}`);
  const payload = (await response.json()) as TpexDailyPayload;
  return parseTpexDailyQuotesPayload(isoDate, payload);
}
