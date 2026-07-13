import { NextResponse } from "next/server";
import { forbiddenStudioPost, isTrustedStudioPost } from "@/studio/http-security";

export const runtime = "nodejs";

// Kept as a closed compatibility endpoint so an old dashboard cannot mutate
// an edition. Ready trading-day editions are claimed by the automatic worker.
export async function POST(request: Request) {
  if (!isTrustedStudioPost(request)) return forbiddenStudioPost();
  return NextResponse.json(
    { error: "Per-edition approval is disabled because publishing is automatic." },
    { status: 410 },
  );
}
