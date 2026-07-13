import { resolve } from "node:path";
import type { YouTubeVisibility } from "./config";

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

/** Runtime settings used by the monitoring UI, without render or OAuth fields. */
export function getStudioWebConfig() {
  const youtubeVisibility = (process.env.YOUTUBE_VISIBILITY || "public") as YouTubeVisibility;
  if (!(["public", "unlisted", "private"] as const).includes(youtubeVisibility)) {
    throw new Error("YOUTUBE_VISIBILITY must be public, unlisted, or private.");
  }

  return {
    autoPublish: envFlag("AUTO_PUBLISH", true),
    youtubeVisibility,
    studioDbPath: process.env.STUDIO_DB_PATH?.trim() || resolve("data/panshi-studio.db"),
    outputRoot: process.env.STUDIO_OUTPUT_ROOT?.trim() || resolve("var/panshi-studio"),
    channelId: process.env.YOUTUBE_CHANNEL_ID?.trim() || null,
    youtubeCategoryName: process.env.YOUTUBE_CATEGORY_NAME || "Education",
    publishMaxAttempts: positiveInteger("STUDIO_PUBLISH_MAX_ATTEMPTS", 5),
    reviewTokenConfigured: Boolean(process.env.STUDIO_REVIEW_TOKEN?.trim()),
  };
}
