import { NextResponse } from "next/server";
import companyRegistry from "@/data/twse-company-registry.json";
import {
  buildNatalChart,
  buildTransitEvents,
  buildUpcomingTransitEvents,
  type PriceBar,
} from "@/lib/astrology";

export const runtime = "edge";

type TwseMonth = {
  stat?: string;
  date?: string;
  data?: string[][];
};

const COMPANY_ENDPOINT = "https://openapi.twse.com.tw/v1/opendata/t187ap03_L";
const PRICE_ENDPOINT = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY";
const PRICE_REQUEST_TIMEOUT_MS = 8_000;

const INDUSTRIES: Record<string, string> = {
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

function compactDate(value: string) {
  const cleaned = String(value || "").replace(/\D/g, "");
  if (!/^\d{8}$/.test(cleaned)) throw new Error("公司日期資料不完整");
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`;
}

function registryReportDate(value: string) {
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

function monthKeys(total: number) {
  const now = new Date();
  const keys: string[] = [];
  for (let offset = total - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    keys.push(
      `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}01`,
    );
  }
  return keys;
}

async function priceBars(symbol: string, months: number): Promise<PriceBar[]> {
  const results = await Promise.allSettled(
    monthKeys(months).map(async (date) => {
      const url = new URL(PRICE_ENDPOINT);
      url.searchParams.set("date", date);
      url.searchParams.set("stockNo", symbol);
      url.searchParams.set("response", "json");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), PRICE_REQUEST_TIMEOUT_MS);
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return null;
        return (await response.json()) as TwseMonth;
      } finally {
        clearTimeout(timeout);
      }
    }),
  );

  const byDate = new Map<string, PriceBar>();
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    const payload = result.value;
    if (!payload || payload.stat !== "OK" || !Array.isArray(payload.data)) continue;
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

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = String(url.searchParams.get("symbol") || "2330").trim();
    const requestedMonths = Number(url.searchParams.get("months") || 13);
    const months = Math.max(
      3,
      Math.min(18, Number.isFinite(requestedMonths) ? Math.floor(requestedMonths) : 13),
    );

    if (!/^\d{4,6}$/.test(symbol)) {
      return NextResponse.json(
        { error: "目前先支援 4–6 碼臺灣上市股票代號。" },
        { status: 400 },
      );
    }

    const row = companyRegistry.find((item) => item.symbol === symbol);
    if (!row) {
      return NextResponse.json(
        { error: `找不到上市公司 ${symbol}，請確認股票代號。` },
        { status: 404 },
      );
    }
    const bars = await priceBars(symbol, months);
    if (bars.length === 0) {
      throw new Error("目前無法從臺灣證券交易所取得任何歷史價格，請稍後再試。");
    }

    const establishedDate = compactDate(row.establishedDate);
    const listingDate = compactDate(row.listingDate);
    const establishedNatal = buildNatalChart(establishedDate, 12)
      .filter((planet) => planet.body !== "Moon");
    const listingNatal = buildNatalChart(listingDate, 9);
    const latest = bars.at(-1)!;
    const previous = bars.at(-2) ?? latest;

    const payload = {
      company: {
        symbol,
        shortName: row.shortName.trim(),
        fullName: row.fullName.trim(),
        englishName: row.englishName.trim(),
        establishedDate,
        listingDate,
        industry: INDUSTRIES[row.industryCode.trim()] || `產業代碼 ${row.industryCode.trim()}`,
        website: row.website.trim(),
        registryUpdatedAt: registryReportDate(row.reportDate),
      },
      market: {
        exchange: "TWSE",
        currency: "TWD",
        timeZone: "Asia/Taipei",
        latestDate: latest.date,
        latestClose: latest.close,
        change: Number((latest.close - previous.close).toFixed(2)),
        changePercent: Number((((latest.close / previous.close) - 1) * 100).toFixed(2)),
        basis: "原始收盤價（未還原除權息）",
      },
      bars,
      anchors: {
        established: {
          date: establishedDate,
          label: "公司成立日",
          precision: "date",
          precisionLabel: "僅日期",
          timeLabel: "時間未知・行星以當日中點估算・月亮與宮位不解讀",
          confidence: "日期高・時分未知",
          natal: establishedNatal,
          events: buildTransitEvents(establishedNatal, bars),
          upcoming: buildUpcomingTransitEvents(establishedNatal, latest.date),
        },
        listing: {
          date: listingDate,
          label: "首日上市交易",
          precision: "derived",
          precisionLabel: "推定時間",
          timeLabel: "09:00・以交易所開盤作為代理值",
          confidence: "中高",
          natal: listingNatal,
          events: buildTransitEvents(listingNatal, bars),
          upcoming: buildUpcomingTransitEvents(listingNatal, latest.date),
        },
      },
      sources: {
        company: COMPANY_ENDPOINT,
        price: "https://www.twse.com.tw/zh/trading/historical/stock-day.html",
        fetchedAt: new Date().toISOString(),
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "資料暫時無法取得";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
