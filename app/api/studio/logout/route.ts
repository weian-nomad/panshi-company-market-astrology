import { NextResponse } from "next/server";
import { STUDIO_SESSION_COOKIE } from "@/studio/auth";
import {
  forbiddenStudioPost,
  isTrustedStudioPost,
  studioLocation,
} from "@/studio/http-security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isTrustedStudioPost(request)) return forbiddenStudioPost();
  const response = new NextResponse(null, {
    status: 303,
    headers: { "cache-control": "no-store", location: studioLocation() },
  });
  response.cookies.set(STUDIO_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
