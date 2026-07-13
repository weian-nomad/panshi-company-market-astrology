import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  calculateRenderContentHash,
  verifyEditionArtifacts,
} from "@/studio/artifact-integrity";
import {
  appendAudit,
  claimNextPublishableEdition,
  deleteYouTubeAuthorizedData,
  getEdition,
  getStudioDb,
  listAudit,
  saveEdition,
  setEditionFailed,
  setEditionPublishRetry,
  setEditionUploadCompletion,
  setEditionUploaded,
  setEditionUploadSession,
  updateEditionPublishingControls,
  type StoredEdition,
} from "@/studio/store";
import {
  assertEditionChannel,
  parseResumableRange,
  parseYouTubeVisibility,
  probeResumableUploadSession,
} from "@/studio/youtube";

const root = mkdtempSync(join(tmpdir(), "panshi-publish-resilience-"));
process.env.YOUTUBE_CHANNEL_ID = "UC-test-channel";
process.env.YOUTUBE_VISIBILITY = "public";

function useDatabase(name: string) {
  process.env.STUDIO_DB_PATH = join(root, `${name}.db`);
}

function editionInput(tradeDate: string) {
  return {
    tradeDate,
    status: "ready" as const,
    title: `${tradeDate}｜今日五盤`,
    description: "test",
    manifest: { schemaVersion: 1 },
    qc: { passed: true },
    contentHash: "a".repeat(64),
    videoPath: "/tmp/video.mp4",
    thumbnailPath: "/tmp/thumbnail.png",
    publishAt: null,
    channelId: "UC-test-channel",
    visibilityOverride: null,
    requestedVisibility: null,
    actualVisibility: null,
    legalReviewId: null,
    approvedAt: null,
    approvedBy: null,
    youtubeVideoId: null,
    youtubeUrl: null,
    error: null,
  };
}

test("claim, stale reclaim, and terminal writes are lease-safe", { concurrency: false }, () => {
  useDatabase("leases");
  const tradeDate = "2026-07-13";
  const base = new Date("2026-07-13T10:00:00.000Z");
  saveEdition(editionInput(tradeDate));

  const first = claimNextPublishableEdition({ now: base, maxAttempts: 5, staleAfterMs: 60_000 });
  assert.equal(first?.status, "uploading");
  assert.equal(first?.publishAttempts, 1);
  assert.equal(first?.requestedVisibility, "public");
  assert.ok(first?.publishClaimToken);
  assert.equal(
    claimNextPublishableEdition({ now: base, maxAttempts: 5, staleAfterMs: 60_000 }),
    null,
  );

  const sessionUrl = "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=private-marker";
  const session = setEditionUploadSession(
    tradeDate,
    first!.publishClaimToken!,
    sessionUrl,
    8_388_608,
  );
  assert.equal(session?.uploadSessionUrl, sessionUrl);
  assert.equal(session?.uploadSize, 8_388_608);

  const retry = setEditionPublishRetry(
    tradeDate,
    first!.publishClaimToken!,
    `request failed at ${sessionUrl}`,
    { now: base, maxAttempts: 5, baseDelayMs: 1_000 },
  );
  assert.equal(retry?.status, "publish_retry");
  assert.equal(retry?.publishRetryAt, "2026-07-13T10:00:01.000Z");
  assert.doesNotMatch(retry?.error || "", /private-marker/);
  assert.equal(
    claimNextPublishableEdition({
      now: new Date("2026-07-13T10:00:00.999Z"),
      maxAttempts: 5,
      staleAfterMs: 60_000,
    }),
    null,
  );

  const originalVisibility = process.env.YOUTUBE_VISIBILITY;
  let second: StoredEdition | null = null;
  try {
    process.env.YOUTUBE_VISIBILITY = "private";
    second = claimNextPublishableEdition({
      now: new Date("2026-07-13T10:00:01.000Z"),
      maxAttempts: 5,
      staleAfterMs: 60_000,
    });
  } finally {
    process.env.YOUTUBE_VISIBILITY = originalVisibility;
  }
  assert.equal(second?.publishAttempts, 2);
  assert.equal(second?.requestedVisibility, "public");
  assert.notEqual(second?.publishClaimToken, first?.publishClaimToken);
  assert.equal(second?.uploadSessionUrl, sessionUrl);

  getStudioDb().prepare(
    "UPDATE studio_editions SET updated_at = ? WHERE trade_date = ?",
  ).run("2026-07-13T09:00:00.000Z", tradeDate);
  const reclaimed = claimNextPublishableEdition({
    now: new Date("2026-07-13T10:02:00.000Z"),
    maxAttempts: 5,
    staleAfterMs: 60_000,
  });
  assert.equal(reclaimed?.publishAttempts, 3);
  assert.notEqual(reclaimed?.publishClaimToken, second?.publishClaimToken);
  assert.equal(reclaimed?.uploadSessionUrl, sessionUrl);

  const completed = setEditionUploadCompletion(
    tradeDate,
    reclaimed!.publishClaimToken!,
    "video-current",
  );
  assert.equal(completed?.youtubeVideoId, "video-current");

  assert.equal(
    setEditionUploaded(
      tradeDate,
      second!.publishClaimToken!,
      "video-old",
      "https://www.youtube.com/watch?v=video-old",
      "public",
    ),
    null,
  );
  const uploaded = setEditionUploaded(
    tradeDate,
    reclaimed!.publishClaimToken!,
    "video-current",
    "https://www.youtube.com/watch?v=video-current",
    "public",
  );
  assert.equal(uploaded?.status, "scheduled");
  assert.equal(uploaded?.actualVisibility, "public");
  assert.equal(uploaded?.uploadSessionUrl, null);
  assert.equal(uploaded?.uploadSize, null);
  assert.equal(uploaded?.publishClaimToken, null);

  setEditionFailed(tradeDate, "late worker failure");
  assert.equal(getEdition(tradeDate)?.status, "scheduled");
  assert.equal(
    setEditionPublishRetry(tradeDate, reclaimed!.publishClaimToken!, "late retry"),
    null,
  );

  appendAudit(tradeDate, "redaction_probe", "test", {
    uploadSessionUrl: sessionUrl,
    publishClaimToken: reclaimed!.publishClaimToken,
  });
  const auditJson = listAudit(tradeDate).map((item) => item.details_json).join("\n");
  assert.doesNotMatch(auditJson, /private-marker/);
  assert.doesNotMatch(auditJson, new RegExp(reclaimed!.publishClaimToken!));
});

test("publish errors stop after a finite retry budget", { concurrency: false }, () => {
  useDatabase("retry-budget");
  const tradeDate = "2026-07-14";
  saveEdition(editionInput(tradeDate));
  let now = new Date("2026-07-14T10:00:00.000Z");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claim = claimNextPublishableEdition({ now, maxAttempts: 3, staleAfterMs: 60_000 });
    assert.equal(claim?.publishAttempts, attempt);
    const outcome = setEditionPublishRetry(
      tradeDate,
      claim!.publishClaimToken!,
      "temporary failure",
      { now, maxAttempts: 3, baseDelayMs: 1_000 },
    );
    if (attempt < 3) {
      assert.equal(outcome?.status, "publish_retry");
      now = new Date(outcome!.publishRetryAt!);
    } else {
      assert.equal(outcome?.status, "failed");
      assert.equal(outcome?.publishRetryAt, null);
    }
  }

  assert.equal(
    claimNextPublishableEdition({
      now: new Date("2026-07-15T10:00:00.000Z"),
      maxAttempts: 3,
      staleAfterMs: 60_000,
    }),
    null,
  );
  assert.throws(
    () => saveEdition(editionInput(tradeDate)),
    /locked in status failed/,
    "a generator rerun must not erase terminal publication state",
  );
});

test("local generation failures remain repairable before publication", { concurrency: false }, () => {
  useDatabase("generation-repair");
  const tradeDate = "2026-07-15";
  saveEdition(editionInput(tradeDate));
  assert.equal(setEditionFailed(tradeDate, "render failed")?.status, "failed");
  assert.equal(saveEdition(editionInput(tradeDate)).status, "ready");
});

test("operator controls are editable before upload and lock when publishing begins", { concurrency: false }, () => {
  useDatabase("publishing-controls");
  const tradeDate = "2026-07-18";
  saveEdition(editionInput(tradeDate));
  const updated = updateEditionPublishingControls({
    tradeDate,
    title: "調整後標題",
    description: "調整後說明",
    visibility: "unlisted",
    actor: "test-operator",
  });
  assert.equal(updated.title, "調整後標題");
  assert.equal(updated.description, "調整後說明");
  assert.equal(updated.visibilityOverride, "unlisted");
  assert.equal(updated.requestedVisibility, null);
  assert.throws(
    () => saveEdition(editionInput(tradeDate)),
    /locked/,
  );

  const claimed = claimNextPublishableEdition({
    now: new Date("2026-07-18T10:00:00.000Z"),
    maxAttempts: 5,
    staleAfterMs: 60_000,
  });
  assert.equal(claimed?.requestedVisibility, "unlisted");
  assert.throws(
    () => updateEditionPublishingControls({
      tradeDate,
      title: "不能再改",
      description: "已進入上傳",
      visibility: "private",
      actor: "test-operator",
    }),
    /不能再變更/,
  );
});

test("OAuth revocation deletes authorized identifiers and stops queued uploads", { concurrency: false }, () => {
  useDatabase("authorized-data-deletion");
  const tradeDate = "2026-07-19";
  saveEdition(editionInput(tradeDate));
  assert.equal(claimNextPublishableEdition({
    now: new Date("2026-07-19T10:00:00.000Z"),
    maxAttempts: 5,
    staleAfterMs: 60_000,
  })?.requestedVisibility, "public");
  appendAudit(tradeDate, "authorized-data-probe", "test", { youtubeVideoId: "video-id" });
  const deletion = deleteYouTubeAuthorizedData();
  const edition = getEdition(tradeDate);
  assert.equal(deletion.editionsUpdated, 1);
  assert.ok(deletion.auditRowsDeleted >= 1);
  assert.equal(edition?.status, "quarantined");
  assert.equal(edition?.channelId, null);
  assert.equal(edition?.visibilityOverride, null);
  assert.equal(edition?.requestedVisibility, null);
  assert.equal(edition?.actualVisibility, null);
  assert.equal(edition?.youtubeVideoId, null);
  assert.equal(edition?.uploadSessionUrl, null);
  assert.deepEqual(listAudit(tradeDate), []);
});

test("queue claim searches SQLite directly beyond the newest 30 rows", { concurrency: false }, () => {
  useDatabase("deep-queue");
  const dates = Array.from({ length: 35 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 4, 1 + index));
    return date.toISOString().slice(0, 10);
  });
  for (const date of dates) saveEdition(editionInput(date));
  const claimed = claimNextPublishableEdition({
    now: new Date("2026-07-20T10:00:00.000Z"),
    maxAttempts: 5,
    staleAfterMs: 60_000,
  });
  assert.equal(claimed?.tradeDate, dates[0]);
});

test("legacy SQLite databases migrate without losing queued editions", { concurrency: false }, () => {
  const path = join(root, "legacy.db");
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE studio_editions (
      trade_date TEXT PRIMARY KEY, status TEXT NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL, manifest_json TEXT NOT NULL, qc_json TEXT NOT NULL,
      content_hash TEXT NOT NULL, video_path TEXT, thumbnail_path TEXT, publish_at TEXT,
      channel_id TEXT, legal_review_id TEXT, approved_at TEXT, approved_by TEXT,
      youtube_video_id TEXT, youtube_url TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  legacy.prepare(
    `INSERT INTO studio_editions (
       trade_date, status, title, description, manifest_json, qc_json, content_hash,
       video_path, thumbnail_path, channel_id, created_at, updated_at
     ) VALUES (?, 'ready', 'legacy', 'legacy', '{}', '{"passed":true}', ?, ?, ?, ?, ?, ?)`,
  ).run(
    "2026-07-15",
    "a".repeat(64),
    "/tmp/video.mp4",
    "/tmp/thumbnail.png",
    "UC-test-channel",
    "2026-07-15T00:00:00.000Z",
    "2026-07-15T00:00:00.000Z",
  );
  legacy.close();

  process.env.STUDIO_DB_PATH = path;
  const migrated = getEdition("2026-07-15");
  assert.equal(migrated?.publishAttempts, 0);
  assert.equal(migrated?.uploadSessionUrl, null);
  assert.equal(migrated?.visibilityOverride, null);
  assert.equal(migrated?.requestedVisibility, null);
  assert.equal(migrated?.actualVisibility, null);
  const columns = getStudioDb().prepare("PRAGMA table_info(studio_editions)").all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === "upload_session_url"));
  assert.ok(columns.some((column) => column.name === "publish_claim_token"));
  assert.ok(columns.some((column) => column.name === "visibility_override"));
  assert.ok(columns.some((column) => column.name === "requested_visibility"));
  assert.ok(columns.some((column) => column.name === "actual_visibility"));
  assert.equal(
    claimNextPublishableEdition({
      now: new Date("2026-07-15T10:00:00.000Z"),
      maxAttempts: 5,
      staleAfterMs: 60_000,
    })?.status,
    "uploading",
  );
  getStudioDb().prepare(
    "UPDATE studio_editions SET actual_visibility = 'corrupt' WHERE trade_date = ?",
  ).run("2026-07-15");
  assert.throws(() => getEdition("2026-07-15"), /unsupported YouTube visibility/);
});

test("invalid persisted visibility fails closed instead of defaulting to public", { concurrency: false }, () => {
  useDatabase("invalid-persisted-visibility");
  const tradeDate = "2026-07-21";
  saveEdition(editionInput(tradeDate));
  assert.throws(
    () => getStudioDb().prepare(
      "UPDATE studio_editions SET visibility_override = 'corrupt' WHERE trade_date = ?",
    ).run(tradeDate),
    /constraint/i,
  );
});

test("artifact integrity binds files, QC, manifest, and output realpaths", { concurrency: false }, async () => {
  const outputRoot = join(root, "artifacts");
  const editionRoot = join(outputRoot, "2026-07-16");
  mkdirSync(editionRoot, { recursive: true });
  const videoPath = join(editionRoot, "daily.mp4");
  const thumbnailPath = join(editionRoot, "daily.png");
  writeFileSync(videoPath, Buffer.from("rendered-video"));
  writeFileSync(thumbnailPath, Buffer.from("rendered-thumbnail"));
  const qc: Record<string, unknown> = {
    passed: true,
    renderEngine: "remotion-4",
    sceneCount: 7,
    durationSeconds: 88,
    speechRate: 1.37,
  };
  const content = { script: "bound content" };
  const narrations = Array.from({ length: 7 }, (_, index) => `scene-${index}`);
  const contentHash = await calculateRenderContentHash({
    content,
    narrations,
    qc,
    videoPath,
    thumbnailPath,
  });
  const edition: StoredEdition = {
    ...editionInput("2026-07-16"),
    manifest: { content, sceneNarrations: narrations },
    qc,
    contentHash,
    videoPath,
    thumbnailPath,
    uploadSessionUrl: null,
    uploadSize: null,
    publishAttempts: 0,
    publishRetryAt: null,
    publishClaimToken: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
  };

  const verified = await verifyEditionArtifacts(edition, {
    outputRoot,
    inspect: async () => ({ passed: true, issues: [] }),
  });
  assert.equal(verified.videoSize, Buffer.byteLength("rendered-video"));

  writeFileSync(videoPath, Buffer.from("tampered-video"));
  await assert.rejects(
    verifyEditionArtifacts(edition, {
      outputRoot,
      inspect: async () => ({ passed: true, issues: [] }),
    }),
    /no longer matches/,
  );

  writeFileSync(videoPath, Buffer.from("rendered-video"));
  const outsidePath = join(root, "outside.mp4");
  writeFileSync(outsidePath, Buffer.from("rendered-video"));
  await assert.rejects(
    verifyEditionArtifacts({ ...edition, videoPath: outsidePath }, {
      outputRoot,
      inspect: async () => ({ passed: true, issues: [] }),
    }),
    /inside STUDIO_OUTPUT_ROOT/,
  );

  await assert.rejects(
    verifyEditionArtifacts(edition, {
      outputRoot,
      inspect: async () => ({ passed: false, issues: ["not an MP4 container"] }),
    }),
    /Current media inspection failed/,
  );
});

test("resumable probes never guess progress and visibility cannot fall back", { concurrency: false }, async () => {
  assert.equal(parseResumableRange(null, 100), null);
  assert.equal(parseResumableRange("bytes=0-39", 100), 40);
  assert.throws(() => parseResumableRange("bytes=40-80", 100), /invalid/);

  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 308 });
    const active = await probeResumableUploadSession(
      "token",
      "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=hidden",
      100,
    );
    assert.deepEqual(active, { kind: "active", offset: 0, rangeConfirmed: false });

    globalThis.fetch = async () => new Response(JSON.stringify({ id: "existing-video" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const complete = await probeResumableUploadSession(
      "token",
      "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=hidden",
      100,
    );
    assert.equal(complete.kind, "complete");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(parseYouTubeVisibility("private"), "private");
  assert.throws(() => parseYouTubeVisibility(undefined), /unsupported visibility/);
});

test("channel binding fails closed", { concurrency: false }, () => {
  const edition = {
    ...editionInput("2026-07-17"),
    uploadSessionUrl: null,
    uploadSize: null,
    publishAttempts: 0,
    publishRetryAt: null,
    publishClaimToken: null,
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
  } satisfies StoredEdition;
  assert.throws(() => assertEditionChannel(edition, null), /required/);
  assert.throws(() => assertEditionChannel(edition, "UC-other"), /does not match/);
  assert.doesNotThrow(() => assertEditionChannel(edition, "UC-test-channel"));
});
