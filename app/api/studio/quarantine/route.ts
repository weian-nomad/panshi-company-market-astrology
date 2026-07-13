import { NextResponse } from "next/server";
import { verifySessionCookie } from "@/studio/auth";
import {
  forbiddenStudioPost,
  isTrustedStudioPost,
  studioLocation,
} from "@/studio/http-security";
import { quarantineEdition } from "@/studio/store";

export const runtime = "nodejs";

function redirect(notice: string, tradeDate?: string) {
  return new NextResponse(null, {
    status: 303,
    headers: {
      "cache-control": "no-store",
      location: studioLocation(notice, tradeDate),
    },
  });
}

export async function POST(request: Request) {
  if (!isTrustedStudioPost(request)) return forbiddenStudioPost();
  if (!verifySessionCookie(request.headers.get("cookie")?.match(/panshi_studio_session=([^;]+)/)?.[1])) {
    return redirect("error");
  }
  const form = await request.formData();
  const tradeDate = String(form.get("trade_date") || "");
  const reason = String(form.get("reason") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate) || reason.length < 4) {
    return redirect("error", tradeDate);
  }
  try {
    quarantineEdition(tradeDate, reason, "studio-reviewer");
    return redirect("quarantined", tradeDate);
  } catch {
    return redirect("error", tradeDate);
  }
}
