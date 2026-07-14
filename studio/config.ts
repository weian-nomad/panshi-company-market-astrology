import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const STUDIO_TIME_ZONE = "Asia/Taipei";

export type YouTubeVisibility = "public" | "unlisted" | "private";

const MACOS_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function envFlag(name: string, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function boundedNumber(name: string, fallback: number, minimum: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}.`);
  }
  return value;
}

export function getStudioConfig() {
  const youtubeVisibility = (process.env.YOUTUBE_VISIBILITY || "public") as YouTubeVisibility;
  if (!(["public", "unlisted", "private"] as const).includes(youtubeVisibility)) {
    throw new Error("YOUTUBE_VISIBILITY must be public, unlisted, or private.");
  }

  return {
    autoPublish: envFlag("AUTO_PUBLISH", true),
    youtubeVisibility,
    // Compatibility fields for manifests created by older generator builds.
    // They no longer gate or schedule publication.
    publicationMode: "automatic" as const,
    legalReviewId: null,
    siteUrl: (process.env.SITE_URL || "https://panshi.nomadsustaintech.com").replace(/\/$/, ""),
    // Keep environment-provided mount paths opaque to Next's file tracer. Node
    // resolves relative paths from the same working directory when the files
    // are opened; resolving only the static fallbacks prevents a dynamic path
    // from making the tracer copy the whole repository into the Web image.
    marketDbPath: process.env.MARKET_DB_PATH?.trim() || resolve("data/panshi-market.db"),
    studioDbPath: process.env.STUDIO_DB_PATH?.trim() || resolve("data/panshi-studio.db"),
    outputRoot: process.env.STUDIO_OUTPUT_ROOT?.trim() || resolve("var/panshi-studio"),
    presenterPath: process.env.STUDIO_PRESENTER_PATH?.trim()
      || resolve("studio/assets/moheng-virtual-host.png"),
    ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
    remotionBrowserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE?.trim()
      || (process.platform === "darwin" && existsSync(MACOS_CHROME) ? MACOS_CHROME : null),
    remotionConcurrency: positiveInteger("REMOTION_CONCURRENCY", 2),
    ttsModel: process.env.STUDIO_TTS_MODEL || "gpt-4o-mini-tts",
    ttsVoice: process.env.STUDIO_TTS_VOICE || "onyx",
    ttsSpeed: boundedNumber("STUDIO_TTS_SPEED", 1, 0.25, 4),
    channelId: process.env.YOUTUBE_CHANNEL_ID?.trim() || null,
    youtubeRegion: process.env.YOUTUBE_REGION || "TW",
    youtubeCategoryName: process.env.YOUTUBE_CATEGORY_NAME || "Education",
    youtubeNotifySubscribers: envFlag("YOUTUBE_NOTIFY_SUBSCRIBERS", true),
    publishMaxAttempts: positiveInteger("STUDIO_PUBLISH_MAX_ATTEMPTS", 5),
    publishRetryBaseSeconds: positiveInteger("STUDIO_PUBLISH_RETRY_BASE_SECONDS", 300),
    uploadStaleMinutes: positiveInteger("STUDIO_UPLOAD_STALE_MINUTES", 20),
    reviewTokenConfigured: Boolean(process.env.STUDIO_REVIEW_TOKEN?.trim()),
  };
}

export function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STUDIO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
