import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { sep } from "node:path";
import { Readable } from "node:stream";
import { verifySessionCookie } from "@/studio/auth";
import { getEdition } from "@/studio/store";
import { getStudioWebConfig } from "@/studio/web-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized() {
  return new Response("Unauthorized", { status: 401 });
}

export async function GET(request: Request) {
  if (!verifySessionCookie(request.headers.get("cookie")?.match(/panshi_studio_session=([^;]+)/)?.[1])) {
    return unauthorized();
  }
  const url = new URL(request.url);
  const tradeDate = url.searchParams.get("date") || "";
  const asset = url.searchParams.get("asset");
  const expectedHash = url.searchParams.get("hash");
  const edition = getEdition(tradeDate);
  if (!edition || edition.contentHash !== expectedHash) return new Response("Not found", { status: 404 });
  const requestedPath = asset === "video" ? edition.videoPath : asset === "thumbnail" ? edition.thumbnailPath : null;
  if (!requestedPath || !existsSync(requestedPath)) return new Response("Not found", { status: 404 });

  const outputRoot = getStudioWebConfig().outputRoot;
  if (!existsSync(outputRoot)) return new Response("Not found", { status: 404 });
  const root = realpathSync(outputRoot);
  const path = realpathSync(requestedPath);
  if (!(path === root || path.startsWith(`${root}${sep}`))) return new Response("Not found", { status: 404 });

  const size = statSync(path).size;
  const contentType = asset === "video" ? "video/mp4" : "image/png";
  const range = request.headers.get("range");
  if (range && asset === "video") {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) return new Response(null, { status: 416 });
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || end < start) return new Response(null, { status: 416 });
    const stream = createReadStream(path, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Type": contentType,
        "Cache-Control": "private, no-store",
      },
    });
  }
  const stream = createReadStream(path);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(size),
      "Content-Type": contentType,
      "Cache-Control": "private, no-store",
    },
  });
}
