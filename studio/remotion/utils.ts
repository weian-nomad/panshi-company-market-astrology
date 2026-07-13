import { Easing, interpolate, staticFile } from "remotion";
import { EASE } from "./tokens";
import {
  MAX_DURATION_FRAMES,
  REMOTION_FPS,
  type RemotionVideoProps,
  type SerializedCaptionToken,
} from "./types";

export function publicAsset(src: string) {
  if (/^(?:https?:|data:|blob:)/i.test(src)) return src;
  return staticFile(src.replace(/^\/+/, ""));
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function editorialEnter(frame: number, durationFrames = 24, delayFrames = 0) {
  return interpolate(frame, [delayFrames, delayFrames + durationFrames], [0, 1], {
    easing: Easing.bezier(...EASE.editorial),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export function sceneOpacity(frame: number, durationFrames: number) {
  const fadeFrames = Math.min(8, Math.max(2, Math.floor(durationFrames / 5)));
  const enter = interpolate(frame, [0, fadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(frame, [durationFrames - fadeFrames, durationFrames - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return Math.min(enter, exit);
}

export function formatSignedPercent(value: number | null, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat("zh-TW", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatDateDot(value: string) {
  return value.replaceAll("-", ".");
}

export function totalDurationFrames(props: RemotionVideoProps) {
  return props.scenes.reduce((sum, scene) => sum + scene.durationFrames, 0);
}

export function validateRemotionVideoProps(props: RemotionVideoProps) {
  if (props.schemaVersion !== 1) throw new Error("Unsupported Remotion props schema.");
  if (props.scenes.length !== 7) throw new Error("DailyFive requires exactly seven scenes.");
  if (props.scenes[0].kind !== "intro" || props.scenes[6].kind !== "outro") {
    throw new Error("DailyFive scene order must be intro, five stocks, outro.");
  }
  if (props.scenes.slice(1, 6).some((scene) => scene.kind !== "stock")) {
    throw new Error("DailyFive requires five stock scenes.");
  }
  const ids = new Set<string>();
  for (const scene of props.scenes) {
    if (ids.has(scene.id)) throw new Error(`Duplicate Remotion scene id: ${scene.id}.`);
    ids.add(scene.id);
    if (!Number.isInteger(scene.durationFrames) || scene.durationFrames < 12) {
      throw new Error(`Scene ${scene.id} has an invalid durationFrames value.`);
    }
    const durationMs = (scene.durationFrames / REMOTION_FPS) * 1000;
    for (const token of scene.captionTokens) {
      if (token.startMs < 0 || token.endMs <= token.startMs || token.endMs > durationMs + 34) {
        throw new Error(`Scene ${scene.id} contains invalid caption timing.`);
      }
    }
  }
  const total = totalDurationFrames(props);
  if (total > MAX_DURATION_FRAMES) {
    throw new Error(`DailyFive is ${total} frames; the limit is ${MAX_DURATION_FRAMES}.`);
  }
  return total;
}

function phraseParts(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentencePunctuation = new Set(["，", "。", "！", "？", "；", "：", ",", ".", "!", "?", ";", ":"]);
  const characters = [...normalized];
  const parts: string[] = [];
  let current = "";

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    current += character;
    if (!sentencePunctuation.has(character)) continue;

    const decimalPoint = character === "."
      && /\d/u.test(characters[index - 1] ?? "")
      && /\d/u.test(characters[index + 1] ?? "");
    if (decimalPoint) continue;

    const part = current.trim();
    if (part) parts.push(part);
    current = "";
  }

  const tail = current.trim();
  if (tail) parts.push(tail);
  const maxCharacters = 18;
  const pages = parts.flatMap((part) => {
    const tokens = part.match(/[+-]?\d+(?:\.\d+)?%?|D\+\d+|[A-Za-z]+|\s+|./gu) ?? [];
    const chunks: string[] = [];
    let chunk = "";
    for (const token of tokens) {
      const next = `${chunk}${token}`;
      if (chunk.trim() && [...next.trim()].length > maxCharacters) {
        chunks.push(chunk.trim());
        chunk = token.trimStart();
      } else {
        chunk = next;
      }
    }
    if (chunk.trim()) chunks.push(chunk.trim());
    return chunks;
  });

  const merged: string[] = [];
  for (const current of pages) {
    const previous = merged.at(-1);
    if (
      previous
      && [...previous].length < 7
      && [...`${previous}${current}`].length <= maxCharacters
    ) {
      merged[merged.length - 1] = `${previous}${current}`;
    } else {
      merged.push(current);
    }
  }
  return merged;
}

/**
 * Creates phrase timing when the speech provider did not return alignment.
 * The allocation is weighted by spoken character count and stays JSON-only.
 */
export function createTimedCaptionTokens(
  narration: string,
  durationFrames: number,
): SerializedCaptionToken[] {
  const parts = phraseParts(narration);
  if (!parts.length) return [];
  const durationMs = (durationFrames / REMOTION_FPS) * 1000;
  const usableMs = Math.max(1, durationMs - 120);
  const weights = parts.map((part) => Math.max(1, [...part].length));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = 0;
  return parts.map((part, index) => {
    const startMs = Math.round(cursor);
    cursor += (weights[index] / totalWeight) * usableMs;
    const endMs = index === parts.length - 1 ? Math.round(usableMs) : Math.round(cursor);
    return {
      text: `${index === 0 ? "" : " "}${part}`,
      startMs,
      endMs: Math.max(startMs + 1, endMs),
      timestampMs: null,
      confidence: null,
    };
  });
}
