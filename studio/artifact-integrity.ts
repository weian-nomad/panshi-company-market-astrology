import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative } from "node:path";
import type { StoredEdition } from "@/studio/store";

type CurrentInspection = {
  passed: boolean;
  issues: string[];
};

type IntegrityOptions = {
  outputRoot: string;
  inspect: (videoPath: string, thumbnailPath: string) => Promise<CurrentInspection>;
};

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function assertInside(root: string, candidate: string) {
  const pathFromRoot = relative(root, candidate);
  if (pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !isAbsolute(pathFromRoot))) return;
  throw new Error("Rendered media must remain inside STUDIO_OUTPUT_ROOT.");
}

function hashInputs(edition: StoredEdition) {
  const content = edition.manifest.content;
  const narrations = edition.manifest.sceneNarrations;
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw new Error("Stored render manifest is missing its content binding.");
  }
  if (!Array.isArray(narrations) || narrations.length !== 7 || narrations.some((item) => typeof item !== "string")) {
    throw new Error("Stored render manifest is missing its seven-scene narration binding.");
  }
  return { content, narrations };
}

export async function calculateRenderContentHash({
  content,
  narrations,
  qc,
  videoPath,
  thumbnailPath,
}: {
  content: unknown;
  narrations: string[];
  qc: Record<string, unknown>;
  videoPath: string;
  thumbnailPath: string;
}) {
  const [videoBytes, thumbnailBytes] = await Promise.all([
    readFile(videoPath),
    readFile(thumbnailPath),
  ]);
  return calculateRenderContentHashFromBytes({
    content,
    narrations,
    qc,
    videoBytes,
    thumbnailBytes,
  });
}

export function calculateRenderContentHashFromBytes({
  content,
  narrations,
  qc,
  videoBytes,
  thumbnailBytes,
}: {
  content: unknown;
  narrations: string[];
  qc: Record<string, unknown>;
  videoBytes: Buffer;
  thumbnailBytes: Buffer;
}) {
  const canonical = JSON.stringify({
    renderEngine: qc.renderEngine,
    content,
    narrations,
    qc,
  });
  return createHash("sha256")
    .update(canonical)
    .update(videoBytes)
    .update(thumbnailBytes)
    .digest("hex");
}

export async function verifyEditionArtifacts(
  edition: StoredEdition,
  options: IntegrityOptions,
) {
  if (edition.qc.passed !== true) throw new Error("Stored render QC did not pass.");
  if (edition.qc.renderEngine !== "remotion-4") {
    throw new Error("Stored render engine is not supported for automatic upload.");
  }
  if (edition.qc.sceneCount !== 7) throw new Error("Stored render must contain seven scenes.");
  if (!finitePositive(edition.qc.durationSeconds) || !finitePositive(edition.qc.speechRate)) {
    throw new Error("Stored render QC is incomplete.");
  }
  if (!edition.videoPath || !edition.thumbnailPath) {
    throw new Error("Ready edition is missing rendered media.");
  }
  if (extname(edition.videoPath).toLowerCase() !== ".mp4") {
    throw new Error("Rendered video must use the .mp4 file extension.");
  }
  if (extname(edition.thumbnailPath).toLowerCase() !== ".png") {
    throw new Error("Rendered thumbnail must use the .png file extension.");
  }
  if (!/^[a-f0-9]{64}$/i.test(edition.contentHash)) {
    throw new Error("Stored render content hash is invalid.");
  }

  const [root, videoPath, thumbnailPath] = await Promise.all([
    realpath(options.outputRoot),
    realpath(edition.videoPath),
    realpath(edition.thumbnailPath),
  ]);
  assertInside(root, videoPath);
  assertInside(root, thumbnailPath);
  const [videoStats, thumbnailStats] = await Promise.all([stat(videoPath), stat(thumbnailPath)]);
  if (!videoStats.isFile() || !thumbnailStats.isFile()) {
    throw new Error("Rendered media paths must point to regular files.");
  }

  const { content, narrations } = hashInputs(edition);
  const current = await options.inspect(videoPath, thumbnailPath);
  if (!current.passed) {
    throw new Error(`Current media inspection failed: ${current.issues.join("; ")}`);
  }

  // Read once after the current-format inspection. The caller uploads these
  // exact verified bytes, eliminating a path re-read between check and use.
  const [videoBytes, thumbnailBytes] = await Promise.all([
    readFile(videoPath),
    readFile(thumbnailPath),
  ]);
  if (videoBytes.length !== videoStats.size || thumbnailBytes.length !== thumbnailStats.size) {
    throw new Error("Rendered media changed during upload validation.");
  }
  const actualHash = calculateRenderContentHashFromBytes({
    content,
    narrations,
    qc: edition.qc,
    videoBytes,
    thumbnailBytes,
  });
  if (actualHash !== edition.contentHash) {
    throw new Error("Rendered media no longer matches its content manifest.");
  }

  return {
    videoPath,
    thumbnailPath,
    videoBytes,
    thumbnailBytes,
    videoSize: videoBytes.length,
    thumbnailSize: thumbnailBytes.length,
  };
}
