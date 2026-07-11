import { NextResponse } from "next/server";
import {
  buildHistoricalTransitEpisodes,
  buildNatalChart,
  buildTransitSnapshot,
} from "@/lib/astrology";
import {
  HOLIDAY_SOURCE_PAGE,
  INDUSTRIES,
  PRICE_SOURCE_PAGE,
  compactDate,
  fetchPriceHistory,
  findCompany,
  resolveTradingDate,
} from "@/lib/company-data";
import { buildExactConfigurationStudy } from "@/lib/event-study";
import { fetchCompanyEventCheck } from "@/lib/company-events";
import type {
  InquiryAnchorKey,
  InquiryHorizon,
  InquiryPayload,
} from "@/lib/inquiry-types";
import { isInquiryAnchor } from "@/lib/inquiry-types";

export const runtime = "edge";

const HISTORY_MONTHS = 84;
const HORIZONS = new Set<InquiryHorizon>([5, 20, 60]);

function parseDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = String(url.searchParams.get("symbol") || "").trim();
    const requestedDate = String(url.searchParams.get("date") || "").trim();
    const requestedAnchor = url.searchParams.get("anchor");
    if (requestedAnchor !== null && !isInquiryAnchor(requestedAnchor)) {
      return NextResponse.json({ error: "命盤基準只支援首日上市或公司成立日。" }, { status: 400 });
    }
    const anchor = (requestedAnchor === "established" ? "established" : "listing") satisfies InquiryAnchorKey;
    const horizonValue = Number(url.searchParams.get("horizon") || 20) as InquiryHorizon;

    if (!/^\d{4,6}$/.test(symbol)) {
      return NextResponse.json(
        { error: "請輸入 4 至 6 碼臺灣上市股票代號。" },
        { status: 400 },
      );
    }
    const targetMoment = parseDate(requestedDate);
    if (!targetMoment) {
      return NextResponse.json({ error: "請選擇有效的目標日期。" }, { status: 400 });
    }
    if (!HORIZONS.has(horizonValue)) {
      return NextResponse.json({ error: "觀察期只支援 5、20 或 60 個交易日。" }, { status: 400 });
    }

    const today = parseDate(taipeiToday())!;
    const daysFromToday = Math.round((targetMoment.getTime() - today.getTime()) / 86_400_000);
    if (daysFromToday < 0 || daysFromToday > 366) {
      return NextResponse.json(
        { error: "目標日期請選今天至未來一年內。" },
        { status: 400 },
      );
    }

    const row = findCompany(symbol);
    if (!row) {
      return NextResponse.json(
        { error: `找不到上市公司 ${symbol}，請確認股票代號。` },
        { status: 404 },
      );
    }

    const listingDate = compactDate(row.listingDate);
    const establishedDate = compactDate(row.establishedDate);
    const [tradingSession, history] = await Promise.all([
      resolveTradingDate(requestedDate),
      fetchPriceHistory(symbol, HISTORY_MONTHS, { notBefore: listingDate }),
    ]);
    if (!history.bars.length) {
      throw new Error("目前無法取得足夠的歷史價格，請稍後再試。");
    }

    const natal = anchor === "listing"
      ? buildNatalChart(listingDate, 9)
      : buildNatalChart(establishedDate, 12).filter((planet) => planet.body !== "Moon");
    const configurations = buildTransitSnapshot(natal, tradingSession.effectiveDate, 3);
    const primary = configurations[0] || null;
    const episodes = primary
      ? buildHistoricalTransitEpisodes(natal, history.bars, 1.25)
      : [];
    const configurationLabel = primary
      ? `${primary.transitBodyZh}${primary.aspectZh}本命${primary.natalBodyZh}`
      : "目標日無主要相位";
    const study = primary
      ? buildExactConfigurationStudy({
        bars: history.bars,
        episodes,
        signature: primary.signature,
        configurationLabel,
        horizon: horizonValue,
        missingMonths: history.coverage.missingMonths,
      })
      : null;
    const companyEvents = await fetchCompanyEventCheck(symbol, tradingSession.effectiveDate);

    const payload: InquiryPayload = {
      company: {
        symbol,
        shortName: row.shortName.trim(),
      },
      question: {
        requestedDate,
        anchor,
        horizon: horizonValue,
      },
      tradingSession,
      symbolic: {
        activeOrb: 3,
        primary,
        configurations,
      },
      evidence: {
        study,
        coverage: history.coverage,
      },
      events: {
        ...companyEvents,
        checks: [
          {
            label: "交易所開休市排程",
            state: tradingSession.calendarBasis === "official" ? "checked" : "unavailable",
            detail: tradingSession.calendarBasis === "official"
              ? "已依證交所公告行事曆校正目標日。"
              : "官方行事曆暫時無法讀取，本次只依平日規則推定。",
          },
          ...companyEvents.checks,
        ],
      },
      boundaries: {
        chartPrecision: anchor === "listing"
          ? "首日上市交易以 09:00 開盤作為代理時間。"
          : "公司成立資料只有日期，行星位置以當日中點估算，不解讀月亮與宮位。",
        statements: [
          "歷史價格為未還原收盤價，不含現金股利，除權息可能造成報酬失真。",
          "同組態樣本不是獨立實驗，只能描述過去，不能支持因果或未來預測。",
          "公告日曆不含尚未發生的天然災害臨時休市與個股暫停交易。",
          `公司產業分類為${INDUSTRIES[row.industryCode.trim()] || "未分類"}，本次統計沒有做產業或大盤控制。`,
        ],
      },
      sources: {
        price: PRICE_SOURCE_PAGE,
        calendar: HOLIDAY_SOURCE_PAGE,
        events: "https://openapi.twse.com.tw/",
        generatedAt: new Date().toISOString(),
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "問盤資料暫時無法取得";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
