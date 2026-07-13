import { verifyEditionArtifacts } from "@/studio/artifact-integrity";
import { getStudioConfig } from "@/studio/config";
import type { YouTubeVisibility } from "@/studio/config";
import { inspectRender } from "@/studio/render";
import { isValidYouTubeUploadSessionUrl, type StoredEdition } from "@/studio/store";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_ROOT = "https://www.googleapis.com/youtube/v3";
const UPLOAD_ROOT = "https://www.googleapis.com/upload/youtube/v3";
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type YouTubeChannel = {
  id: string;
  snippet?: { title?: string };
};

type YouTubeVideo = {
  id: string;
  snippet?: { channelId?: string };
  status?: { privacyStatus?: string };
};

export type UploadPersistence = {
  persistSession: (sessionUrl: string, uploadSize: number) => Promise<void> | void;
  persistCompletion: (youtubeVideoId: string) => Promise<void> | void;
  heartbeat?: () => Promise<void> | void;
};

export type ResumableUploadState =
  | { kind: "active"; offset: number; rangeConfirmed: boolean }
  | { kind: "complete"; video: YouTubeVideo }
  | { kind: "expired" };

class NonRetryableYouTubeError extends Error {}

function requiredSecret(name: "YOUTUBE_OAUTH_CLIENT_ID" | "YOUTUBE_OAUTH_CLIENT_SECRET" | "YOUTUBE_REFRESH_TOKEN") {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is missing from the runtime secret configuration.`);
  return value;
}

async function accessToken() {
  const body = new URLSearchParams({
    client_id: requiredSecret("YOUTUBE_OAUTH_CLIENT_ID"),
    client_secret: requiredSecret("YOUTUBE_OAUTH_CLIENT_SECRET"),
    refresh_token: requiredSecret("YOUTUBE_REFRESH_TOKEN"),
    grant_type: "refresh_token",
  });
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    const code = payload.error && /^[a-z_]{1,64}$/u.test(payload.error)
      ? ` (${payload.error})`
      : "";
    throw new Error(`YouTube OAuth refresh failed${code}.`);
  }
  return payload.access_token;
}

async function youtubeFetch(
  token: string,
  url: string,
  init: RequestInit = {},
  acceptedStatuses: number[] = [],
) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          ...init.headers,
        },
      });
      if (response.ok || acceptedStatuses.includes(response.status)) return response;
      await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) throw new NonRetryableYouTubeError(`YouTube API request failed (${response.status}).`);
      lastError = new Error(`YouTube API request failed (${response.status}).`);
    } catch (error) {
      if (error instanceof NonRetryableYouTubeError) throw error;
      lastError = error instanceof Error ? error : new Error("YouTube request failed.");
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 2 ** attempt * 1_000));
  }
  throw lastError || new Error("YouTube request failed after retries.");
}

export async function getAuthorizedChannel(providedToken?: string) {
  const expected = getStudioConfig().channelId;
  if (!expected) throw new Error("YOUTUBE_CHANNEL_ID is required for automatic upload.");
  const token = providedToken ?? await accessToken();
  const response = await youtubeFetch(
    token,
    `${API_ROOT}/channels?part=id%2Csnippet&mine=true&maxResults=1`,
  );
  const payload = (await response.json()) as { items?: YouTubeChannel[] };
  const channel = payload.items?.[0];
  if (!channel) throw new Error("The connected Google account does not expose a YouTube channel.");
  if (channel.id !== expected) {
    throw new Error("The connected OAuth account does not match YOUTUBE_CHANNEL_ID.");
  }
  return { token, channel };
}

export async function resolveVideoCategoryId(token: string) {
  const config = getStudioConfig();
  const response = await youtubeFetch(
    token,
    `${API_ROOT}/videoCategories?part=snippet&regionCode=${encodeURIComponent(config.youtubeRegion)}`,
  );
  const payload = (await response.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string; assignable?: boolean } }>;
  };
  const category = payload.items?.find(
    (item) => item.snippet?.assignable !== false
      && item.snippet?.title?.toLocaleLowerCase("en")
        === config.youtubeCategoryName.toLocaleLowerCase("en"),
  );
  if (!category) {
    throw new Error(`YouTube category "${config.youtubeCategoryName}" is not assignable in ${config.youtubeRegion}.`);
  }
  return category.id;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").slice(0, 30)
    : [];
}

function metadataForEdition(edition: StoredEdition, categoryId: string) {
  const config = getStudioConfig();
  const tags = stringArray(edition.manifest.tags);
  const status: Record<string, unknown> = {
    privacyStatus: config.youtubeVisibility,
    selfDeclaredMadeForKids: false,
    containsSyntheticMedia: true,
  };
  return {
    snippet: {
      title: edition.title.slice(0, 100),
      description: edition.description.slice(0, 5_000),
      tags,
      categoryId,
      defaultLanguage: "zh-TW",
      defaultAudioLanguage: "zh-TW",
    },
    status,
  };
}

async function initiateResumableUpload({
  token,
  metadata,
  size,
}: {
  token: string;
  metadata: Record<string, unknown>;
  size: number;
}) {
  const response = await youtubeFetch(
    token,
    `${UPLOAD_ROOT}/videos?uploadType=resumable&part=snippet%2Cstatus&notifySubscribers=${getStudioConfig().youtubeNotifySubscribers}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(size),
        "X-Upload-Content-Type": "video/mp4",
      },
      body: JSON.stringify(metadata),
    },
  );
  const location = response.headers.get("location");
  if (!location) throw new Error("YouTube did not return a resumable upload URL.");
  return location;
}

export function parseResumableRange(range: string | null, totalSize: number) {
  if (!range) return null;
  const match = /^bytes=0-(\d+)$/.exec(range.trim());
  if (!match) throw new Error("YouTube returned an invalid resumable upload range.");
  const offset = Number(match[1]) + 1;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > totalSize) {
    throw new Error("YouTube returned an out-of-bounds resumable upload range.");
  }
  return offset;
}

export async function probeResumableUploadSession(
  token: string,
  location: string,
  totalSize: number,
): Promise<ResumableUploadState> {
  const response = await youtubeFetch(
    token,
    location,
    {
      method: "PUT",
      headers: {
        "Content-Length": "0",
        "Content-Range": `bytes */${totalSize}`,
      },
    },
    [308, 404, 410],
  );
  if (response.status === 404 || response.status === 410) return { kind: "expired" };
  if (response.status === 308) {
    const range = parseResumableRange(response.headers.get("range"), totalSize);
    return { kind: "active", offset: range ?? 0, rangeConfirmed: range !== null };
  }
  const video = (await response.json()) as YouTubeVideo;
  if (!video.id) throw new Error("Completed upload session did not return a video ID.");
  return { kind: "complete", video };
}

async function uploadChunkOnce(
  token: string,
  location: string,
  chunk: Buffer,
  offset: number,
  end: number,
  totalSize: number,
) {
  let response: Response;
  try {
    response = await fetch(location, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${offset}-${end}/${totalSize}`,
        "Content-Type": "video/mp4",
      },
      body: chunk as unknown as BodyInit,
    });
  } catch {
    throw new Error("YouTube resumable upload request failed before progress was confirmed.");
  }
  if (response.ok || response.status === 308) return response;
  await response.text().catch(() => "");
  throw new Error(`YouTube resumable upload failed (${response.status}).`);
}

async function uploadVideoBytes(
  token: string,
  location: string,
  bytes: Buffer,
  initialOffset: number,
  heartbeat?: () => Promise<void> | void,
) {
  let offset = initialOffset;
  while (offset < bytes.length) {
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, bytes.length) - 1;
    const chunk = bytes.subarray(offset, end + 1);
    const response = await uploadChunkOnce(
      token,
      location,
      chunk,
      offset,
      end,
      bytes.length,
    );
    if (response.status === 308) {
      const receivedOffset = parseResumableRange(response.headers.get("range"), bytes.length);
      if (receivedOffset !== null) {
        if (receivedOffset <= offset) {
          throw new Error("YouTube resumable upload made no confirmed progress.");
        }
        offset = receivedOffset;
        await heartbeat?.();
        continue;
      }

      // A 308 without Range does not prove that the just-sent chunk was
      // accepted. Probe the server and never advance to `end + 1` by guess.
      const probed = await probeResumableUploadSession(token, location, bytes.length);
      if (probed.kind === "complete") return probed.video;
      if (probed.kind === "expired") {
        throw new Error("YouTube resumable upload session expired before completion.");
      }
      if (!probed.rangeConfirmed || probed.offset <= offset) {
        throw new Error("YouTube resumable upload progress could not be confirmed.");
      }
      offset = probed.offset;
      await heartbeat?.();
      continue;
    }
    return (await response.json()) as YouTubeVideo;
  }
  throw new Error("YouTube upload ended without a video resource.");
}

async function setThumbnail(token: string, videoId: string, bytes: Buffer) {
  await youtubeFetch(
    token,
    `${UPLOAD_ROOT}/thumbnails/set?videoId=${encodeURIComponent(videoId)}&uploadType=media`,
    {
      method: "POST",
      headers: {
        "Content-Length": String(bytes.length),
        "Content-Type": "image/png",
      },
      body: bytes as unknown as BodyInit,
    },
  );
}

async function getUploadedVideo(token: string, videoId: string) {
  const response = await youtubeFetch(
    token,
    `${API_ROOT}/videos?part=id%2Csnippet%2Cstatus&id=${encodeURIComponent(videoId)}&maxResults=1`,
  );
  const payload = (await response.json()) as { items?: YouTubeVideo[] };
  const video = payload.items?.[0];
  if (!video?.id || !video.snippet?.channelId || !video.status?.privacyStatus) {
    throw new Error("YouTube did not return authoritative channel and visibility state.");
  }
  return video;
}

export function assertEditionChannel(edition: StoredEdition, configuredChannelId: string | null) {
  if (!configuredChannelId) throw new Error("YOUTUBE_CHANNEL_ID is required for automatic upload.");
  if (!edition.channelId || edition.channelId !== configuredChannelId) {
    throw new Error("Edition channel does not match YOUTUBE_CHANNEL_ID.");
  }
}

export function parseYouTubeVisibility(value: string | undefined): YouTubeVisibility {
  if (value === "public" || value === "unlisted" || value === "private") return value;
  throw new Error("YouTube returned an unsupported visibility state.");
}

export async function uploadReadyEdition(
  edition: StoredEdition,
  persistence: UploadPersistence,
) {
  const config = getStudioConfig();
  assertEditionChannel(edition, config.channelId);
  const sceneCount = Number(edition.qc.sceneCount);
  const speechRate = Number(edition.qc.speechRate);
  const expectedDuration = Number(edition.qc.durationSeconds);
  const artifacts = await verifyEditionArtifacts(edition, {
    outputRoot: config.outputRoot,
    inspect: (videoPath, thumbnailPath) => inspectRender(
      videoPath,
      thumbnailPath,
      sceneCount,
      speechRate,
      expectedDuration,
    ),
  });
  const { token, channel } = await getAuthorizedChannel();
  const categoryId = await resolveVideoCategoryId(token);
  const metadata = metadataForEdition(edition, categoryId);
  const videoSize = artifacts.videoSize;
  let location = edition.uploadSessionUrl;
  let offset = 0;
  let video: YouTubeVideo | null = edition.youtubeVideoId ? { id: edition.youtubeVideoId } : null;
  if ((location === null) !== (edition.uploadSize === null)) {
    throw new Error("Stored upload session metadata is incomplete.");
  }
  if (location && !isValidYouTubeUploadSessionUrl(location)) {
    throw new Error("Stored upload session URL is invalid.");
  }
  if (location && edition.uploadSize !== videoSize) {
    throw new Error("Rendered video size changed after the upload session began.");
  }
  if (!video && location) {
    const state = await probeResumableUploadSession(token, location, videoSize);
    await persistence.heartbeat?.();
    if (state.kind === "complete") video = state.video;
    if (state.kind === "active") offset = state.offset;
    if (state.kind === "expired") location = null;
  }
  if (!video && !location) {
    location = await initiateResumableUpload({ token, metadata, size: videoSize });
    await persistence.persistSession(location, videoSize);
  }
  if (!video) {
    video = await uploadVideoBytes(
      token,
      location as string,
      artifacts.videoBytes,
      offset,
      persistence.heartbeat,
    );
  }
  if (!video.id) throw new Error("YouTube upload response did not include a video ID.");
  if (edition.youtubeVideoId !== video.id) await persistence.persistCompletion(video.id);
  await persistence.heartbeat?.();
  const authoritativeVideo = await getUploadedVideo(token, video.id);
  if (authoritativeVideo.snippet?.channelId !== channel.id || channel.id !== config.channelId) {
    throw new Error("Uploaded video channel did not match the configured channel.");
  }
  const postUploadWarnings: string[] = [];
  try {
    await setThumbnail(token, video.id, artifacts.thumbnailBytes);
  } catch {
    // The video already exists at this point. Keep it and surface a precise,
    // non-secret warning instead of retrying into a duplicate upload.
    postUploadWarnings.push("thumbnail_not_set");
  }
  const visibility = parseYouTubeVisibility(authoritativeVideo.status?.privacyStatus);
  return {
    videoId: video.id,
    videoUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`,
    visibility,
    requestedVisibility: config.youtubeVisibility,
    channel: { id: channel.id, title: channel.snippet?.title || channel.id },
    categoryId,
    postUploadWarnings,
  };
}
