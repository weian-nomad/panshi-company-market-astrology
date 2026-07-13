import { NextResponse } from "next/server";
import {
  STUDIO_SESSION_COOKIE,
  STUDIO_SESSION_MAX_AGE_SECONDS,
  sessionCookieValue,
  verifyReviewToken,
} from "@/studio/auth";
import {
  forbiddenStudioPost,
  isTrustedStudioPost,
  studioLocation,
} from "@/studio/http-security";

export const runtime = "nodejs";

function redirect(location: string) {
  return new NextResponse(null, {
    status: 303,
    headers: { "cache-control": "no-store", location },
  });
}

export async function POST(request: Request) {
  if (!isTrustedStudioPost(request)) return forbiddenStudioPost();
  const form = await request.formData();
  const token = String(form.get("token") || "");
  if (!verifyReviewToken(token)) {
    return redirect(studioLocation("error"));
  }
  const value = sessionCookieValue();
  if (!value) return redirect(studioLocation("error"));
  const response = redirect(studioLocation());
  response.cookies.set(STUDIO_SESSION_COOKIE, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STUDIO_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}
