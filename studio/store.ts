import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { getStudioConfig } from "@/studio/config";
import type { YouTubeVisibility } from "@/studio/config";

export type EditionStatus =
  | "drafting"
  | "ready"
  | "approved"
  | "uploading"
  | "publish_retry"
  | "uploaded_private"
  | "scheduled"
  | "quarantined"
  | "failed"
  | "skipped";

export type StoredEdition = {
  tradeDate: string;
  status: EditionStatus;
  title: string;
  description: string;
  manifest: Record<string, unknown>;
  qc: Record<string, unknown>;
  contentHash: string;
  videoPath: string | null;
  thumbnailPath: string | null;
  publishAt: string | null;
  channelId: string | null;
  legalReviewId: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  youtubeVideoId: string | null;
  youtubeUrl: string | null;
  uploadSessionUrl: string | null;
  uploadSize: number | null;
  publishAttempts: number;
  publishRetryAt: string | null;
  publishClaimToken: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

type EditionRow = {
  trade_date: string;
  status: string;
  title: string;
  description: string;
  manifest_json: string;
  qc_json: string;
  content_hash: string;
  video_path: string | null;
  thumbnail_path: string | null;
  publish_at: string | null;
  channel_id: string | null;
  legal_review_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  youtube_video_id: string | null;
  youtube_url: string | null;
  upload_session_url: string | null;
  upload_size: number | null;
  publish_attempt_count: number;
  publish_retry_at: string | null;
  publish_claim_token: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

const connections = new Map<string, DatabaseSync>();

const REDACTED_UPLOAD_SESSION = "[redacted upload session]";

export type PublishClaimOptions = {
  now?: Date;
  maxAttempts?: number;
  staleAfterMs?: number;
};

export type PublishFailureOptions = {
  now?: Date;
  maxAttempts?: number;
  baseDelayMs?: number;
};

function positiveOption(value: number | undefined, fallback: number) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

export function redactSensitivePublishText(value: string) {
  return value
    .replace(
      /https:\/\/(?:[^/\s"']+\.)?googleapis\.com\/upload\/youtube\/[^\s"']+/gi,
      REDACTED_UPLOAD_SESSION,
    )
    .replace(/([?&](?:upload_id|upload_protocol|token|key)=)[^\s&"']+/gi, "$1[redacted]")
    .slice(0, 2_000);
}

function sanitizeAuditValue(value: unknown, key = ""): unknown {
  if (/session|claim.?token|authorization|secret/i.test(key)) return "[redacted]";
  if (typeof value === "string") return redactSensitivePublishText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitizeAuditValue(childValue, childKey),
      ]),
    );
  }
  return value;
}

function migrateStudioEditions(db: DatabaseSync) {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(studio_editions)").all() as Array<{ name: string }>)
      .map((column) => column.name),
  );
  const migrations = [
    ["upload_session_url", "ALTER TABLE studio_editions ADD COLUMN upload_session_url TEXT"],
    ["upload_size", "ALTER TABLE studio_editions ADD COLUMN upload_size INTEGER"],
    [
      "publish_attempt_count",
      "ALTER TABLE studio_editions ADD COLUMN publish_attempt_count INTEGER NOT NULL DEFAULT 0",
    ],
    ["publish_retry_at", "ALTER TABLE studio_editions ADD COLUMN publish_retry_at TEXT"],
    ["publish_claim_token", "ALTER TABLE studio_editions ADD COLUMN publish_claim_token TEXT"],
  ] as const;
  for (const [column, statement] of migrations) {
    if (!columns.has(column)) db.exec(statement);
  }
}

function databasePath() {
  return process.env.STUDIO_DB_PATH?.trim() || resolve("data/panshi-studio.db");
}

export function getStudioDb() {
  const path = databasePath();
  const existing = connections.get(path);
  if (existing) return existing;
  const directory = dirname(path);
  if (!existsSync(directory)) mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS studio_editions (
      trade_date TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      qc_json TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      video_path TEXT,
      thumbnail_path TEXT,
      publish_at TEXT,
      channel_id TEXT,
      legal_review_id TEXT,
      approved_at TEXT,
      approved_by TEXT,
      youtube_video_id TEXT,
      youtube_url TEXT,
      upload_session_url TEXT,
      upload_size INTEGER,
      publish_attempt_count INTEGER NOT NULL DEFAULT 0,
      publish_retry_at TEXT,
      publish_claim_token TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_studio_editions_status_date
      ON studio_editions(status, trade_date DESC);
    CREATE TABLE IF NOT EXISTS studio_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_date TEXT NOT NULL,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_studio_audit_trade_date
      ON studio_audit_log(trade_date, created_at DESC);
  `);
  migrateStudioEditions(db);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_studio_editions_publish_queue
      ON studio_editions(status, publish_retry_at, trade_date);
  `);
  connections.set(path, db);
  return db;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapEdition(row: EditionRow): StoredEdition {
  return {
    tradeDate: row.trade_date,
    status: row.status as EditionStatus,
    title: row.title,
    description: row.description,
    manifest: parseJson(row.manifest_json),
    qc: parseJson(row.qc_json),
    contentHash: row.content_hash,
    videoPath: row.video_path,
    thumbnailPath: row.thumbnail_path,
    publishAt: row.publish_at,
    channelId: row.channel_id,
    legalReviewId: row.legal_review_id,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    youtubeVideoId: row.youtube_video_id,
    youtubeUrl: row.youtube_url,
    uploadSessionUrl: row.upload_session_url,
    uploadSize: row.upload_size == null ? null : Number(row.upload_size),
    publishAttempts: Number(row.publish_attempt_count || 0),
    publishRetryAt: row.publish_retry_at,
    publishClaimToken: row.publish_claim_token,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function appendAudit(
  tradeDate: string,
  action: string,
  actor: string,
  details: Record<string, unknown> = {},
) {
  const safeDetails = sanitizeAuditValue(details) as Record<string, unknown>;
  getStudioDb()
    .prepare(
      `INSERT INTO studio_audit_log (trade_date, action, actor, details_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(tradeDate, action, actor, JSON.stringify(safeDetails), new Date().toISOString());
}

type EditionPublishRuntimeFields =
  | "uploadSessionUrl"
  | "uploadSize"
  | "publishAttempts"
  | "publishRetryAt"
  | "publishClaimToken";

/**
 * Generation may repair a local drafting/render failure, but it must never
 * replace an edition once automatic publication has touched the remote
 * platform. Otherwise a later generator run could erase a completed video ID
 * or resumable session and create a duplicate upload.
 */
export function isEditionGenerationLocked(edition: StoredEdition) {
  if ([
    "approved",
    "uploading",
    "publish_retry",
    "uploaded_private",
    "scheduled",
    "quarantined",
  ].includes(edition.status)) return true;
  return edition.status === "failed"
    && (edition.publishAttempts > 0
      || Boolean(edition.youtubeVideoId)
      || Boolean(edition.uploadSessionUrl));
}

export function saveEdition(
  input: Omit<StoredEdition, "createdAt" | "updatedAt" | EditionPublishRuntimeFields>,
) {
  const db = getStudioDb();
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = getEdition(input.tradeDate);
    if (existing && isEditionGenerationLocked(existing)) {
      throw new Error(`Edition ${input.tradeDate} is locked in status ${existing.status}.`);
    }
    db.prepare(
      `INSERT INTO studio_editions (
       trade_date, status, title, description, manifest_json, qc_json, content_hash,
       video_path, thumbnail_path, publish_at, channel_id, legal_review_id,
       approved_at, approved_by, youtube_video_id, youtube_url, error, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(trade_date) DO UPDATE SET
       status = excluded.status,
       title = excluded.title,
       description = excluded.description,
       manifest_json = excluded.manifest_json,
       qc_json = excluded.qc_json,
       content_hash = excluded.content_hash,
       video_path = excluded.video_path,
       thumbnail_path = excluded.thumbnail_path,
       publish_at = excluded.publish_at,
       channel_id = excluded.channel_id,
       legal_review_id = excluded.legal_review_id,
       approved_at = excluded.approved_at,
       approved_by = excluded.approved_by,
       youtube_video_id = excluded.youtube_video_id,
       youtube_url = excluded.youtube_url,
       upload_session_url = NULL,
       upload_size = NULL,
       publish_attempt_count = 0,
       publish_retry_at = NULL,
       publish_claim_token = NULL,
       error = excluded.error,
       updated_at = excluded.updated_at`,
    ).run(
      input.tradeDate,
      input.status,
      input.title,
      input.description,
      JSON.stringify(input.manifest),
      JSON.stringify(input.qc),
      input.contentHash,
      input.videoPath,
      input.thumbnailPath,
      input.publishAt,
      input.channelId,
      input.legalReviewId,
      input.approvedAt,
      input.approvedBy,
      input.youtubeVideoId,
      input.youtubeUrl,
      input.error,
      now,
      now,
    );
    appendAudit(input.tradeDate, "edition_saved", "engine", { status: input.status });
    db.exec("COMMIT");
    return getEdition(input.tradeDate)!;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function getEdition(tradeDate: string) {
  const row = getStudioDb()
    .prepare(`SELECT * FROM studio_editions WHERE trade_date = ?`)
    .get(tradeDate) as EditionRow | undefined;
  return row ? mapEdition(row) : null;
}

export function listEditions(limit = 20) {
  const rows = getStudioDb()
    .prepare(`SELECT * FROM studio_editions ORDER BY trade_date DESC LIMIT ?`)
    .all(Math.max(1, Math.min(limit, 100))) as unknown as EditionRow[];
  return rows.map(mapEdition);
}

export function quarantineEdition(tradeDate: string, reason: string, actor: string) {
  const now = new Date().toISOString();
  const result = getStudioDb()
    .prepare(
      `UPDATE studio_editions
       SET status = 'quarantined', error = ?, upload_session_url = NULL,
           upload_size = NULL, publish_retry_at = NULL, publish_claim_token = NULL,
           updated_at = ?
       WHERE trade_date = ? AND status IN ('ready', 'approved', 'publish_retry', 'failed')`,
    )
    .run(reason, now, tradeDate);
  if (Number(result.changes) !== 1) throw new Error("這期內容目前不能隔離。");
  appendAudit(tradeDate, "edition_quarantined", actor, { reason });
  return getEdition(tradeDate)!;
}

export function claimNextPublishableEdition(options: PublishClaimOptions = {}) {
  const config = getStudioConfig();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const maxAttempts = positiveOption(options.maxAttempts, config.publishMaxAttempts);
  const staleAfterMs = positiveOption(
    options.staleAfterMs,
    config.uploadStaleMinutes * 60_000,
  );
  const staleBeforeIso = new Date(now.getTime() - staleAfterMs).toISOString();
  const db = getStudioDb();
  const claimToken = randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    const exhausted = db.prepare(
      `SELECT trade_date, publish_attempt_count
       FROM studio_editions
       WHERE publish_attempt_count >= ? AND (
         status IN ('ready', 'approved')
         OR (status = 'publish_retry' AND (publish_retry_at IS NULL OR publish_retry_at <= ?))
         OR (status = 'uploading' AND updated_at <= ?)
       )`,
    ).all(maxAttempts, nowIso, staleBeforeIso) as Array<{
      trade_date: string;
      publish_attempt_count: number;
    }>;
    for (const row of exhausted) {
      const result = db.prepare(
        `UPDATE studio_editions
         SET status = 'failed',
             error = 'Automatic publish stopped after the retry limit.',
             publish_retry_at = NULL, publish_claim_token = NULL, updated_at = ?
         WHERE trade_date = ? AND publish_attempt_count >= ?
           AND status IN ('ready', 'approved', 'publish_retry', 'uploading')`,
      ).run(nowIso, row.trade_date, maxAttempts);
      if (Number(result.changes) === 1) {
        db.prepare(
          `INSERT INTO studio_audit_log
             (trade_date, action, actor, details_json, created_at)
           VALUES (?, 'edition_publish_retry_exhausted', 'publisher', ?, ?)`,
        ).run(
          row.trade_date,
          JSON.stringify({ attempts: Number(row.publish_attempt_count), maxAttempts }),
          nowIso,
        );
      }
    }

    const candidate = db.prepare(
      `SELECT trade_date
       FROM studio_editions
       WHERE publish_attempt_count < ? AND (
         status IN ('ready', 'approved')
         OR (status = 'publish_retry' AND (publish_retry_at IS NULL OR publish_retry_at <= ?))
         OR (status = 'uploading' AND updated_at <= ?)
       )
       ORDER BY trade_date ASC
       LIMIT 1`,
    ).get(maxAttempts, nowIso, staleBeforeIso) as { trade_date: string } | undefined;
    if (!candidate) {
      db.exec("COMMIT");
      return null;
    }

    const result = db.prepare(
      `UPDATE studio_editions
       SET status = 'uploading', publish_attempt_count = publish_attempt_count + 1,
           publish_retry_at = NULL, publish_claim_token = ?, error = NULL, updated_at = ?
       WHERE trade_date = ? AND publish_attempt_count < ? AND (
         status IN ('ready', 'approved')
         OR (status = 'publish_retry' AND (publish_retry_at IS NULL OR publish_retry_at <= ?))
         OR (status = 'uploading' AND updated_at <= ?)
       )`,
    ).run(
      claimToken,
      nowIso,
      candidate.trade_date,
      maxAttempts,
      nowIso,
      staleBeforeIso,
    );
    if (Number(result.changes) !== 1) {
      db.exec("ROLLBACK");
      return null;
    }
    db.prepare(
      `INSERT INTO studio_audit_log
         (trade_date, action, actor, details_json, created_at)
       VALUES (?, 'edition_claimed_for_auto_publish', 'publisher', ?, ?)`,
    ).run(candidate.trade_date, JSON.stringify({ maxAttempts }), nowIso);
    db.exec("COMMIT");
    return getEdition(candidate.trade_date);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function isValidYouTubeUploadSessionUrl(sessionUrl: string) {
  try {
    const url = new URL(sessionUrl);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (url.hostname === "www.googleapis.com" || url.hostname.endsWith(".googleapis.com"))
      && url.pathname.startsWith("/upload/youtube/");
  } catch {
    return false;
  }
}

export function setEditionUploadSession(
  tradeDate: string,
  claimToken: string,
  sessionUrl: string,
  uploadSize: number,
) {
  if (!isValidYouTubeUploadSessionUrl(sessionUrl)) throw new Error("YouTube returned an invalid upload session.");
  if (!Number.isSafeInteger(uploadSize) || uploadSize < 1) {
    throw new Error("Upload size must be a positive safe integer.");
  }
  const now = new Date().toISOString();
  const result = getStudioDb().prepare(
    `UPDATE studio_editions
     SET upload_session_url = ?, upload_size = ?, updated_at = ?
     WHERE trade_date = ? AND status = 'uploading' AND publish_claim_token = ?`,
  ).run(sessionUrl, uploadSize, now, tradeDate, claimToken);
  if (Number(result.changes) !== 1) return null;
  appendAudit(tradeDate, "edition_upload_session_saved", "publisher", { uploadSize });
  return getEdition(tradeDate);
}

export function touchEditionUploadLease(tradeDate: string, claimToken: string) {
  const result = getStudioDb().prepare(
    `UPDATE studio_editions SET updated_at = ?
     WHERE trade_date = ? AND status = 'uploading' AND publish_claim_token = ?`,
  ).run(new Date().toISOString(), tradeDate, claimToken);
  return Number(result.changes) === 1;
}

export function setEditionUploadCompletion(
  tradeDate: string,
  claimToken: string,
  youtubeVideoId: string,
) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(youtubeVideoId)) {
    throw new Error("Completed upload returned an invalid video ID.");
  }
  const now = new Date().toISOString();
  const youtubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}`;
  const result = getStudioDb().prepare(
    `UPDATE studio_editions
     SET youtube_video_id = ?, youtube_url = ?, updated_at = ?
     WHERE trade_date = ? AND status = 'uploading' AND publish_claim_token = ?`,
  ).run(youtubeVideoId, youtubeUrl, now, tradeDate, claimToken);
  if (Number(result.changes) !== 1) return null;
  return getEdition(tradeDate);
}

export function setEditionUploaded(
  tradeDate: string,
  claimToken: string,
  youtubeVideoId: string,
  youtubeUrl: string,
  visibility: YouTubeVisibility,
) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(youtubeVideoId)) {
    throw new Error("Completed upload returned an invalid video ID.");
  }
  const expectedYoutubeUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(youtubeVideoId)}`;
  if (youtubeUrl !== expectedYoutubeUrl) {
    throw new Error("Completed upload returned an invalid video URL.");
  }
  const now = new Date().toISOString();
  // Keep the two persisted terminal values compatible with existing generator
  // locks. `scheduled` now represents an immediately public upload.
  const status: EditionStatus = visibility === "public" ? "scheduled" : "uploaded_private";
  const result = getStudioDb()
    .prepare(
      `UPDATE studio_editions
       SET status = ?, youtube_video_id = ?, youtube_url = ?, error = NULL,
           upload_session_url = NULL, upload_size = NULL, publish_retry_at = NULL,
           publish_claim_token = NULL, updated_at = ?
       WHERE trade_date = ? AND status = 'uploading' AND publish_claim_token = ?`,
    )
    .run(status, youtubeVideoId, youtubeUrl, now, tradeDate, claimToken);
  if (Number(result.changes) !== 1) return null;
  const action = visibility === "public"
    ? "edition_published"
    : visibility === "unlisted"
      ? "edition_uploaded_unlisted"
      : "edition_uploaded_private";
  appendAudit(tradeDate, action, "publisher", {
    youtubeVideoId,
    visibility,
  });
  return getEdition(tradeDate)!;
}

export function setEditionFailed(tradeDate: string, error: string) {
  const now = new Date().toISOString();
  const result = getStudioDb()
    .prepare(
      `UPDATE studio_editions SET status = 'failed', error = ?, updated_at = ?
       WHERE trade_date = ? AND status IN ('drafting', 'ready', 'approved', 'failed', 'skipped')`,
    )
    .run(redactSensitivePublishText(error), now, tradeDate);
  if (Number(result.changes) === 1) {
    appendAudit(tradeDate, "edition_failed", "engine", { error });
  }
  return getEdition(tradeDate);
}

export function setEditionPublishRetry(
  tradeDate: string,
  claimToken: string,
  error: string,
  options: PublishFailureOptions = {},
) {
  const config = getStudioConfig();
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const maxAttempts = positiveOption(options.maxAttempts, config.publishMaxAttempts);
  const baseDelayMs = positiveOption(
    options.baseDelayMs,
    config.publishRetryBaseSeconds * 1_000,
  );
  const db = getStudioDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(
      `SELECT publish_attempt_count
       FROM studio_editions
       WHERE trade_date = ? AND status = 'uploading' AND publish_claim_token = ?`,
    ).get(tradeDate, claimToken) as { publish_attempt_count: number } | undefined;
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    const attempts = Number(row.publish_attempt_count);
    const safeError = redactSensitivePublishText(error);
    if (attempts >= maxAttempts) {
      const result = db.prepare(
        `UPDATE studio_editions
         SET status = 'failed', error = ?, publish_retry_at = NULL,
             publish_claim_token = NULL, updated_at = ?
         WHERE trade_date = ? AND status = 'uploading' AND publish_claim_token = ?`,
      ).run(safeError, nowIso, tradeDate, claimToken);
      if (Number(result.changes) !== 1) {
        db.exec("ROLLBACK");
        return null;
      }
      db.prepare(
        `INSERT INTO studio_audit_log
           (trade_date, action, actor, details_json, created_at)
         VALUES (?, 'edition_publish_retry_exhausted', 'publisher', ?, ?)`,
      ).run(tradeDate, JSON.stringify({ attempts, maxAttempts }), nowIso);
    } else {
      const delayMs = Math.min(baseDelayMs * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60_000);
      const retryAt = new Date(now.getTime() + delayMs).toISOString();
      const result = db.prepare(
        `UPDATE studio_editions
         SET status = 'publish_retry', error = ?, publish_retry_at = ?,
             publish_claim_token = NULL, updated_at = ?
         WHERE trade_date = ? AND status = 'uploading' AND publish_claim_token = ?`,
      ).run(safeError, retryAt, nowIso, tradeDate, claimToken);
      if (Number(result.changes) !== 1) {
        db.exec("ROLLBACK");
        return null;
      }
      db.prepare(
        `INSERT INTO studio_audit_log
           (trade_date, action, actor, details_json, created_at)
         VALUES (?, 'edition_publish_retry_scheduled', 'publisher', ?, ?)`,
      ).run(tradeDate, JSON.stringify({ attempts, maxAttempts, retryAt }), nowIso);
    }
    db.exec("COMMIT");
    return getEdition(tradeDate);
  } catch (failure) {
    db.exec("ROLLBACK");
    throw failure;
  }
}

export function listAudit(tradeDate: string) {
  return getStudioDb()
    .prepare(
      `SELECT action, actor, details_json, created_at
       FROM studio_audit_log WHERE trade_date = ? ORDER BY id DESC`,
    )
    .all(tradeDate) as Array<{
      action: string;
      actor: string;
      details_json: string;
      created_at: string;
    }>;
}
