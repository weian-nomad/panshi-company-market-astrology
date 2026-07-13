import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { getStudioConfig } from "@/studio/config";
import { calculateRenderContentHash } from "@/studio/artifact-integrity";
import { mapDailyContentPackageToRemotionProps } from "@/studio/remotion/map-content";
import type { RemotionMediaBundle, RemotionSceneMedia } from "@/studio/remotion/types";
import { formatSignedPercent } from "@/studio/script";
import type { DailyContentPackage, DailySelectionItem } from "@/studio/types";
import { validateDailyPackage } from "@/studio/validation";
import { generateNarrationWav } from "@/studio/voice";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const DEFAULT_SPEECH_RATE = 1.36;
const MAX_SPEECH_RATE = 1.5;
const SCENE_TAIL_SECONDS = 0.35;
const TARGET_DURATION_SECONDS = 88;
const SPEECH_CACHE_VERSION = "panshi-remotion-speech-v2";
const RENDER_ENGINE = "remotion-4";
const PRESENTER_PUBLIC_PATH = "studio/presenter/moheng-virtual-host.png";

type Scene = {
  id: string;
  kind: "intro" | "stock" | "outro";
  narration: string;
  item?: DailySelectionItem;
  index?: number;
};

type SevenRenderScenes = [Scene, Scene, Scene, Scene, Scene, Scene, Scene];

export type RenderQc = {
  passed: boolean;
  width: number;
  height: number;
  durationSeconds: number;
  videoCodec: string | null;
  audioCodec: string | null;
  hasAudio: boolean;
  fps: number;
  pixelFormat: string | null;
  audioSampleRate: number;
  integratedLoudnessLufs: number | null;
  truePeakDbfs: number | null;
  thumbnailWidth: number;
  thumbnailHeight: number;
  decoded: boolean;
  sceneCount: number;
  speechRate: number;
  renderEngine: typeof RENDER_ENGINE;
  issues: string[];
};

export type RenderResult = {
  videoPath: string;
  thumbnailPath: string;
  manifestPath: string;
  contentHash: string;
  sceneNarrations: string[];
  qc: RenderQc;
};

function primaryTransit(item: DailySelectionItem) {
  const signature = item.facts.study?.signature;
  return item.facts.transits.find((transit) => transit.signature === signature)
    ?? [...item.facts.transits].sort((a, b) => a.orb - b.orb)[0];
}

function narrationForItem(item: DailySelectionItem) {
  const { facts } = item;
  const transit = primaryTransit(item);
  const study = facts.study;
  const marketFact = item.category === "volume-anomaly" && facts.session.volumeRatio20SessionMedian
    ? `量是二十日中位的 ${facts.session.volumeRatio20SessionMedian.toFixed(1)} 倍`
    : item.category === "dense-aspects"
      ? `今天有 ${facts.transits.length} 組主要相位`
      : `日變動 ${formatSignedPercent(facts.session.dailyChangePercent)}`;
  const configuration = transit
    ? `${transit.transitBodyZh}${transit.aspectZh}本命${transit.natalBodyZh}`
    : "沒有可讀取的主要相位";

  if (!study || study.statistics.sampleSize < study.minimumDescriptiveSample) {
    return `${item.categoryLabel}，${facts.shortName} ${facts.symbol}。${marketFact}；${configuration}。同盤 ${study?.statistics.sampleSize ?? 0} 筆，樣本不足，不讀方向。`;
  }

  const stats = study.statistics;
  return `${item.categoryLabel}，${facts.shortName} ${facts.symbol}。${marketFact}；${configuration}。同盤 ${stats.sampleSize} 筆；D 加 ${study.horizon} 中位 ${formatSignedPercent(stats.medianReturn as number)}，四分位 ${formatSignedPercent(stats.q1Return as number)} 到 ${formatSignedPercent(stats.q3Return as number)}。`;
}

export function buildRenderScenes(content: DailyContentPackage): SevenRenderScenes {
  const [, month, day] = content.script.date.split("-").map(Number);
  const intro: Scene = {
    id: "00-intro",
    kind: "intro",
    narration: `我是 AI 虛擬觀測員${content.script.host.name}。今日五盤，五檔股票，五種入選理由。資料截至 ${month} 月 ${day} 日，採未還原收盤價。`,
  };
  const stocks = content.selection.items.map((item, index) => ({
    id: `${String(index + 1).padStart(2, "0")}-${item.facts.symbol}`,
    kind: "stock" as const,
    narration: narrationForItem(item),
    item,
    index,
  })) as [Scene, Scene, Scene, Scene, Scene];
  const outro: Scene = {
    id: "06-outro",
    kind: "outro",
    narration: `五檔是五種觀察角度，不是排行。${content.script.boundaryLine} 完整案例、反例與資料缺口，都在盤勢。`,
  };
  return [intro, ...stocks, outro];
}

async function run(command: string, args: string[]) {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const capture = (chunk: Buffer | string) => {
      output = `${output}${String(chunk)}`.slice(-16_000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${basename(command)} exited with ${code}: ${output.slice(-3_000)}`));
    });
  });
}

async function probeJson(path: string) {
  const config = getStudioConfig();
  return await new Promise<Record<string, unknown>>((resolvePromise, reject) => {
    const child = spawn(config.ffprobePath, [
      "-v", "error",
      "-show_streams",
      "-show_format",
      "-of", "json",
      path,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe failed: ${stderr.slice(-1_000)}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout) as Record<string, unknown>);
      } catch {
        reject(new Error("ffprobe returned invalid JSON."));
      }
    });
  });
}

async function mediaDuration(path: string) {
  const probe = await probeJson(path);
  const format = probe.format as { duration?: string } | undefined;
  const duration = Number(format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Cannot determine media duration: ${path}`);
  }
  return duration;
}

async function analyzeLoudness(path: string) {
  const config = getStudioConfig();
  return await new Promise<{ integratedLoudnessLufs: number; truePeakDbfs: number }>(
    (resolvePromise, reject) => {
      const child = spawn(config.ffmpegPath, [
        "-hide_banner",
        "-nostats",
        "-i", path,
        "-map", "0:a:0",
        "-af", "ebur128=peak=true",
        "-f", "null",
        "-",
      ], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr = `${stderr}${String(chunk)}`.slice(-64_000);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg loudness analysis failed with code ${code}.`));
          return;
        }
        const loudness = [...stderr.matchAll(/I:\s+(-?\d+(?:\.\d+)?) LUFS/g)].at(-1);
        const peak = [...stderr.matchAll(/Peak:\s+(-?\d+(?:\.\d+)?) dBFS/g)].at(-1);
        const integratedLoudnessLufs = Number(loudness?.[1]);
        const truePeakDbfs = Number(peak?.[1]);
        if (!Number.isFinite(integratedLoudnessLufs) || !Number.isFinite(truePeakDbfs)) {
          reject(new Error("ffmpeg loudness analysis returned incomplete measurements."));
          return;
        }
        resolvePromise({ integratedLoudnessLufs, truePeakDbfs });
      });
    },
  );
}

async function ensureNarrationWav(text: string, audioPath: string) {
  const config = getStudioConfig();
  const cachePath = `${audioPath}.sha256`;
  const expected = createHash("sha256")
    .update(SPEECH_CACHE_VERSION)
    .update(config.ttsModel)
    .update(config.ttsVoice)
    .update(text)
    .digest("hex");
  try {
    const [cached, audio] = await Promise.all([readFile(cachePath, "utf8"), readFile(audioPath)]);
    if (cached.trim() === expected && audio.length >= 1_000) return;
  } catch {
    // Generate only the missing or stale scene.
  }
  await generateNarrationWav(text, audioPath);
  await writeFile(cachePath, `${expected}\n`, { mode: 0o600 });
}

async function paceNarrationWav(
  sourcePath: string,
  outputPath: string,
  sourceDuration: number,
  speechRate: number,
) {
  const config = getStudioConfig();
  const expectedDuration = sourceDuration / speechRate + SCENE_TAIL_SECONDS;
  await run(config.ffmpegPath, [
    "-y",
    "-i", sourcePath,
    "-af", `atempo=${speechRate.toFixed(4)},loudnorm=I=-16:LRA=7:TP=-1.5,apad=pad_dur=${SCENE_TAIL_SECONDS}`,
    "-t", expectedDuration.toFixed(3),
    "-c:a", "pcm_s16le",
    "-ar", "48000",
    "-ac", "2",
    outputPath,
  ]);
}

async function preparePublicAssets(publicRoot: string, presenterPath: string) {
  const studioRoot = join(publicRoot, "studio");
  await mkdir(studioRoot, { recursive: true });
  await cp(resolve("studio/assets/remotion-public/studio/fonts"), join(studioRoot, "fonts"), {
    recursive: true,
    force: true,
  });
  const presenterTarget = join(publicRoot, PRESENTER_PUBLIC_PATH);
  await mkdir(resolve(presenterTarget, ".."), { recursive: true });
  await copyFile(presenterPath, presenterTarget);
  await mkdir(join(studioRoot, "audio"), { recursive: true });
}

function toMediaBundle(media: RemotionSceneMedia[]): RemotionMediaBundle {
  if (media.length !== 7) throw new Error("Remotion requires exactly seven prepared audio scenes.");
  return {
    intro: media[0],
    stocks: [media[1], media[2], media[3], media[4], media[5]],
    outro: media[6],
  };
}

export async function inspectRender(
  videoPath: string,
  thumbnailPath: string,
  sceneCount: number,
  speechRate: number,
  expectedDurationSeconds: number,
): Promise<RenderQc> {
  const [probe, thumbnailProbe, videoStats, thumbnailStats, loudness] = await Promise.all([
    probeJson(videoPath),
    probeJson(thumbnailPath),
    stat(videoPath),
    stat(thumbnailPath),
    analyzeLoudness(videoPath),
  ]);
  const streams = (probe.streams ?? []) as Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    pix_fmt?: string;
    sample_rate?: string;
  }>;
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const thumbnail = ((thumbnailProbe.streams ?? []) as Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }>).find((stream) => stream.codec_type === "video");
  const [rateNumerator, rateDenominator] = (video?.r_frame_rate || "0/1").split("/").map(Number);
  const outputFps = rateDenominator ? rateNumerator / rateDenominator : 0;
  const audioSampleRate = Number(audio?.sample_rate ?? 0);
  const durationSeconds = Number(((probe.format ?? {}) as { duration?: string }).duration ?? 0);
  const issues: string[] = [];
  if (video?.width !== WIDTH || video.height !== HEIGHT) issues.push("影片尺寸不是 1080 × 1920。");
  const formatName = String(((probe.format ?? {}) as { format_name?: string }).format_name || "");
  if (!formatName.split(",").includes("mp4")) issues.push("影片容器不是 MP4。");
  if (video?.codec_name !== "h264") issues.push("影片編碼不是 H.264。");
  if (!audio) issues.push("影片缺少音軌。");
  if (audio && audio.codec_name !== "aac") issues.push("音訊編碼不是 AAC。");
  if (Math.abs(outputFps - FPS) > 0.01) issues.push("影片影格率不是 30fps。");
  if (video?.pix_fmt !== "yuv420p") issues.push("影片像素格式不是 yuv420p。");
  if (audio && audioSampleRate !== 48_000) issues.push("音軌取樣率不是 48kHz。");
  if (loudness.integratedLoudnessLufs < -20 || loudness.integratedLoudnessLufs > -12) {
    issues.push("整體口播響度不在 -20 至 -12 LUFS 的可用範圍。");
  }
  if (loudness.truePeakDbfs > -1) issues.push("音軌 true peak 高於 -1 dBFS。");
  if (thumbnail?.width !== WIDTH || thumbnail.height !== HEIGHT) {
    issues.push("縮圖尺寸不是 1080 × 1920。");
  }
  if (thumbnail?.codec_name !== "png") issues.push("縮圖格式不是 PNG。");
  if (videoStats.size < 100_000) issues.push("影片檔案大小異常。");
  if (thumbnailStats.size < 10_000) issues.push("縮圖檔案大小異常。");
  if (thumbnailStats.size > 2 * 1024 * 1024) issues.push("縮圖超過 YouTube 2MB 上限。");
  if (!Number.isFinite(durationSeconds) || durationSeconds < 45 || durationSeconds > 90) {
    issues.push("片長不在 45 至 90 秒的跨平台直式短影音範圍。");
  }
  if (Math.abs(durationSeconds - expectedDurationSeconds) > 0.15) {
    issues.push("輸出片長與 Remotion 時間軸不一致。");
  }
  let decoded = false;
  try {
    await run(getStudioConfig().ffmpegPath, [
      "-v", "error",
      "-i", videoPath,
      "-map", "0:v:0",
      "-map", "0:a:0",
      "-f", "null",
      "-",
    ]);
    decoded = true;
  } catch {
    issues.push("完整解碼檢查失敗。");
  }
  return {
    passed: issues.length === 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    durationSeconds: Number(durationSeconds.toFixed(2)),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    hasAudio: Boolean(audio),
    fps: Number(outputFps.toFixed(3)),
    pixelFormat: video?.pix_fmt ?? null,
    audioSampleRate,
    integratedLoudnessLufs: loudness.integratedLoudnessLufs,
    truePeakDbfs: loudness.truePeakDbfs,
    thumbnailWidth: thumbnail?.width ?? 0,
    thumbnailHeight: thumbnail?.height ?? 0,
    decoded,
    sceneCount,
    speechRate: Number(speechRate.toFixed(3)),
    renderEngine: RENDER_ENGINE,
    issues,
  };
}

export async function renderDailyVideo(
  content: DailyContentPackage,
  outputDirectory?: string,
): Promise<RenderResult> {
  const validation = validateDailyPackage(content, { expectedDate: content.selection.date });
  if (!validation.valid) {
    throw new Error(`內容驗證失敗：${validation.errors.map((error) => error.message).join("；")}`);
  }

  const config = getStudioConfig();
  const root = resolve(outputDirectory || join(config.outputRoot, content.selection.date));
  const rawAudioRoot = join(root, "audio", "raw");
  const publicRoot = join(root, "remotion-public");
  const renderAudioRoot = join(publicRoot, "studio", "audio");
  await Promise.all([
    mkdir(rawAudioRoot, { recursive: true }),
    mkdir(renderAudioRoot, { recursive: true }),
    preparePublicAssets(publicRoot, config.presenterPath),
  ]);

  const scenes = buildRenderScenes(content);
  const rawPaths: string[] = [];
  const rawDurations: number[] = [];
  for (const scene of scenes) {
    const rawPath = join(rawAudioRoot, `${scene.id}.wav`);
    await ensureNarrationWav(scene.narration, rawPath);
    rawPaths.push(rawPath);
    rawDurations.push(await mediaDuration(rawPath));
  }

  const rawTotal = rawDurations.reduce((sum, duration) => sum + duration, 0);
  const availableSpeechSeconds = TARGET_DURATION_SECONDS - scenes.length * SCENE_TAIL_SECONDS;
  const requiredSpeechRate = rawTotal / availableSpeechSeconds;
  const speechRate = Math.ceil(Math.max(DEFAULT_SPEECH_RATE, requiredSpeechRate) * 1_000) / 1_000;
  if (speechRate > MAX_SPEECH_RATE) {
    throw new Error(`旁白過長：需要 ${speechRate.toFixed(2)} 倍語速才能進入 90 秒，本期已自動隔離。`);
  }

  const preparedMedia: RemotionSceneMedia[] = [];
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const publicAudioPath = join(renderAudioRoot, `${scene.id}.wav`);
    await paceNarrationWav(rawPaths[index], publicAudioPath, rawDurations[index], speechRate);
    const durationSeconds = await mediaDuration(publicAudioPath);
    preparedMedia.push({
      audioSrc: `studio/audio/${scene.id}.wav`,
      durationFrames: Math.ceil(durationSeconds * FPS),
    });
  }

  const props = mapDailyContentPackageToRemotionProps(
    content,
    toMediaBundle(preparedMedia),
    {
      presenterSrc: PRESENTER_PUBLIC_PATH,
      appUrl: `${config.siteUrl}/`,
      sceneNarrations: scenes.map((scene) => scene.narration) as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ],
    },
  );
  const propsPath = join(root, "remotion-props.json");
  await writeFile(propsPath, JSON.stringify(props, null, 2), { mode: 0o600 });

  const remotionCli = resolve("node_modules/@remotion/cli/remotion-cli.js");
  const entryPoint = resolve("studio/remotion/index.ts");
  const browserArgs = config.remotionBrowserExecutable
    ? [`--browser-executable=${config.remotionBrowserExecutable}`]
    : [];
  const sharedArgs = [
    `--props=${propsPath}`,
    `--public-dir=${publicRoot}`,
    `--concurrency=${config.remotionConcurrency}`,
    "--overwrite",
    ...browserArgs,
  ];
  const videoPath = join(root, `今日五盤-${content.selection.date}.mp4`);
  const temporaryVideoPath = join(root, `.今日五盤-${content.selection.date}.partial.mp4`);
  await run(process.execPath, [
    remotionCli,
    "render",
    entryPoint,
    "DailyFive",
    temporaryVideoPath,
    ...sharedArgs,
    "--codec=h264",
    "--audio-codec=aac",
    "--audio-bitrate=192k",
    "--sample-rate=48000",
    "--crf=18",
    "--pixel-format=yuv420p",
    "--color-space=bt709",
    "--x264-preset=medium",
    "--image-format=png",
  ]);

  const thumbnailPath = join(root, `今日五盤-${content.selection.date}-封面.png`);
  const temporaryThumbnailPath = join(root, `.今日五盤-${content.selection.date}-封面.partial.png`);
  await run(process.execPath, [
    remotionCli,
    "still",
    entryPoint,
    "DailyFiveThumbnail",
    temporaryThumbnailPath,
    ...sharedArgs,
  ]);

  const expectedDurationSeconds = props.scenes
    .reduce((sum, scene) => sum + scene.durationFrames, 0) / FPS;
  const qc = await inspectRender(
    temporaryVideoPath,
    temporaryThumbnailPath,
    scenes.length,
    speechRate,
    expectedDurationSeconds,
  );
  if (!qc.passed) throw new Error(`影片 QC 未通過：${qc.issues.join("；")}`);
  await Promise.all([
    rename(temporaryVideoPath, videoPath),
    rename(temporaryThumbnailPath, thumbnailPath),
  ]);

  const contentHash = await calculateRenderContentHash({
    content,
    narrations: scenes.map((scene) => scene.narration),
    qc: qc as unknown as Record<string, unknown>,
    videoPath,
    thumbnailPath,
  });
  const manifestPath = join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    renderEngine: RENDER_ENGINE,
    content,
    sceneNarrations: scenes.map((scene) => scene.narration),
    sceneDurationsFrames: props.scenes.map((scene) => scene.durationFrames),
    qc,
    contentHash,
  }, null, 2), { mode: 0o600 });

  return {
    videoPath,
    thumbnailPath,
    manifestPath,
    contentHash,
    sceneNarrations: scenes.map((scene) => scene.narration),
    qc,
  };
}
