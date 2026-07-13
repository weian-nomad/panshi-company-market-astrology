import { NextResponse } from "next/server";
import { verifySessionCookie } from "@/studio/auth";
import {
  forbiddenStudioPost,
  isTrustedStudioPost,
  studioLocation,
} from "@/studio/http-security";
import { updateEditionPublishingControls } from "@/studio/store";

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
  try {
    updateEditionPublishingControls({
      tradeDate,
      title: String(form.get("title") || ""),
      description: String(form.get("description") || ""),
      visibility: String(form.get("visibility") || "") as "public" | "unlisted" | "private",
      actor: "studio-operator",
    });
    return redirect("settings-saved", tradeDate);
  } catch {
    return redirect("error", tradeDate);
  }
}
