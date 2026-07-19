import { NextResponse } from "next/server";
import {
  buildNatalChart,
  buildTransitEvents,
  buildUpcomingTransitEvents,
} from "@/lib/astrology";
import {
  COMPANY_ENDPOINT,
  INDUSTRIES,
  PRICE_SOURCE_PAGE,
  compactDate,
  registryReportDate,
} from "@/lib/company-data";
import { TPEX_COMPANY_ENDPOINT, TPEX_PRICE_SOURCE_PAGE } from "@/lib/tpex-data";
import { findCompanyUnified, getPriceBarsUnified } from "@/lib/market-data";
import { assessQueryAccess, attachQueryCookie } from "@/lib/query-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let access: Awaited<ReturnType<typeof assessQueryAccess>> | null = null;
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
        { error: "目前先支援 4 至 6 碼臺灣上市股票代號。" },
        { status: 400 },
      );
    }

    const row = findCompanyUnified(symbol);
    if (!row) {
      return NextResponse.json(
        { error: `找不到上市櫃公司 ${symbol}，請確認股票代號。` },
        { status: 404 },
      );
    }
    access = await assessQueryAccess(request, { kind: "company", symbol });
    if (!access.usage.allowed) {
      const response = NextResponse.json(
        {
          error: "今天 3 檔額外查詢已用完。今日五盤仍可閱讀，明天會重新計算額度。",
          code: "FREE_DAILY_LIMIT_REACHED",
          usage: access.usage,
        },
        { status: 429, headers: { "Cache-Control": "private, no-store" } },
      );
      return attachQueryCookie(response, access);
    }
    const establishedDate = compactDate(row.establishedDate);
    const listingDate = compactDate(row.listingDate);
    const bars = await getPriceBarsUnified(symbol, row.market, months, { notBefore: listingDate });
    if (bars.length === 0) {
      throw new Error("目前無法取得任何歷史價格，請稍後再試。");
    }
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
        exchange: row.market,
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
        company: row.market === "TWSE" ? COMPANY_ENDPOINT : TPEX_COMPANY_ENDPOINT,
        price: row.market === "TWSE" ? PRICE_SOURCE_PAGE : TPEX_PRICE_SOURCE_PAGE,
        fetchedAt: new Date().toISOString(),
      },
    };

    const response = NextResponse.json({ ...payload, usage: access.usage }, {
      headers: { "Cache-Control": "private, no-store" },
    });
    return attachQueryCookie(response, access);
  } catch (error) {
    const message = error instanceof Error ? error.message : "資料暫時無法取得";
    const response = NextResponse.json(
      { error: message },
      { status: 502, headers: { "Cache-Control": "private, no-store" } },
    );
    return access ? attachQueryCookie(response, access) : response;
  }
}
