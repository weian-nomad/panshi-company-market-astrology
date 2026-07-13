import { getStudioConfig } from "@/studio/config";
import {
  appendAudit,
  claimNextPublishableEdition,
  deleteYouTubeAuthorizedData,
  getEdition,
  redactSensitivePublishText,
  setEditionPublishRetry,
  setEditionUploadCompletion,
  setEditionUploadSession,
  setEditionUploaded,
  touchEditionUploadLease,
} from "@/studio/store";
import { uploadReadyEdition, YouTubeGrantRevokedError } from "@/studio/youtube";
import { loadVaultKeys } from "@/studio/vault";

async function main() {
  const config = getStudioConfig();
  if (!config.autoPublish) {
    console.log(JSON.stringify({ status: "paused", reason: "AUTO_PUBLISH=false" }));
    return;
  }
  loadVaultKeys([
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
  ]);
  if (!config.channelId) throw new Error("YOUTUBE_CHANNEL_ID is required for automatic upload.");
  for (const key of [
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_REFRESH_TOKEN",
  ] as const) {
    if (!process.env[key]?.trim()) throw new Error(`${key} is required for automatic upload.`);
  }
  const edition = claimNextPublishableEdition({
    maxAttempts: config.publishMaxAttempts,
    staleAfterMs: config.uploadStaleMinutes * 60_000,
  });
  if (!edition) {
    console.log(JSON.stringify({ status: "idle", message: "No publishable trading-day edition." }));
    return;
  }
  const claimToken = edition.publishClaimToken;
  if (!claimToken) throw new Error("Claimed edition is missing its publication lease.");
  try {
    const result = await uploadReadyEdition(edition, {
      persistSession: (sessionUrl, uploadSize) => {
        const stored = setEditionUploadSession(
          edition.tradeDate,
          claimToken,
          sessionUrl,
          uploadSize,
        );
        if (!stored) throw new Error("Publication lease was reclaimed before upload began.");
      },
      persistCompletion: (youtubeVideoId) => {
        const stored = setEditionUploadCompletion(
          edition.tradeDate,
          claimToken,
          youtubeVideoId,
        );
        if (!stored) throw new Error("Publication lease was reclaimed before completion was saved.");
      },
      heartbeat: () => {
        if (!touchEditionUploadLease(edition.tradeDate, claimToken)) {
          throw new Error("Publication lease was reclaimed during upload.");
        }
      },
    });
    const uploaded = setEditionUploaded(
      edition.tradeDate,
      claimToken,
      result.videoId,
      result.videoUrl,
      result.visibility,
    );
    if (!uploaded) throw new Error("Publication lease was reclaimed before completion was saved.");
    if (result.postUploadWarnings.length) {
      appendAudit(edition.tradeDate, "edition_post_upload_warning", "publisher", {
        warnings: result.postUploadWarnings,
      });
    }
    console.log(JSON.stringify({
      status: result.visibility === "public" ? "published" : `uploaded_${result.visibility}`,
      tradeDate: edition.tradeDate,
      channelId: result.channel.id,
      requestedVisibility: result.requestedVisibility,
      actualVisibility: result.visibility,
      postUploadWarnings: result.postUploadWarnings,
    }));
  } catch (error) {
    const revoked = error instanceof YouTubeGrantRevokedError;
    const authorizedDataDeletion = revoked ? deleteYouTubeAuthorizedData() : null;
    const message = redactSensitivePublishText(
      error instanceof Error ? error.message : "YouTube upload failed.",
    );
    if (revoked) {
      const current = getEdition(edition.tradeDate);
      console.error(JSON.stringify({
        status: current?.status ?? "quarantined",
        tradeDate: edition.tradeDate,
        errorType: error.name,
        attempts: current?.publishAttempts ?? edition.publishAttempts,
        retryAt: null,
        authorizedDataDeleted: Boolean(authorizedDataDeletion),
      }));
      process.exitCode = 1;
      return;
    }
    const next = setEditionPublishRetry(edition.tradeDate, claimToken, message, {
      maxAttempts: config.publishMaxAttempts,
      baseDelayMs: config.publishRetryBaseSeconds * 1_000,
    });
    const current = next ?? getEdition(edition.tradeDate);
    console.error(JSON.stringify({
      status: next?.status ?? "terminal_state_preserved",
      tradeDate: edition.tradeDate,
      errorType: error instanceof Error ? error.name : "UnknownError",
      attempts: current?.publishAttempts ?? edition.publishAttempts,
      retryAt: next?.status === "publish_retry" ? next.publishRetryAt : null,
      authorizedDataDeleted: Boolean(authorizedDataDeletion),
    }));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    status: "worker_failed",
    errorType: error instanceof Error ? error.name : "UnknownError",
  }));
  process.exitCode = 1;
});
