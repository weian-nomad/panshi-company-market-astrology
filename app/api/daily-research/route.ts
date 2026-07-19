import { NextResponse } from "next/server";
import { buildPublicDailyResearch } from "@/lib/daily-research";
import { listEditions } from "@/studio/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = buildPublicDailyResearch(listEditions(20));
    if (!payload) {
      return NextResponse.json(
        { error: "目前沒有已公開且通過完整資料檢核的今日五盤。" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json(
      { error: "今日五盤資料暫時無法讀取。" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
