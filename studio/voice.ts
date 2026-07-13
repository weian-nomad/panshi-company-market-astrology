import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getStudioConfig } from "@/studio/config";

const SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";

export const STUDIO_VOICE_DIRECTION = [
  "以自然的臺灣華語朗讀。",
  "成年男性，中低音、近距離收音，胸腔共鳴厚而乾淨，帶一點氣聲與克制的微笑。",
  "性感來自沉著、自信和留白；不要刻意壓嗓，也不要油膩。",
  "像深夜財經節目的主持人：第一句稍輕、稍慢，把人留下。",
  "股票代號逐字念；公司名、價格、正負號與百分比必須咬字清楚。",
  "重要數字前後各留半拍，轉折句略降速，句尾自然下沉。",
  "每一到兩句要有細微節奏與情緒變化。",
  "避免新聞播報腔、廣告腔、預言腔、整段耳語、鼻音、聲帶摩擦音與機械式等速。",
  "保持乾聲，不加混響或背景音。",
].join(" ");

class NonRetryableSpeechError extends Error {}

function requiredApiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is missing from the runtime secret configuration.");
  return key;
}

async function speechRequest(text: string) {
  const config = getStudioConfig();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await fetch(SPEECH_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requiredApiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.ttsModel,
          voice: config.ttsVoice,
          speed: config.ttsSpeed,
          input: text,
          response_format: "wav",
          instructions: STUDIO_VOICE_DIRECTION,
        }),
      });

      if (response.ok) return Buffer.from(await response.arrayBuffer());

      await response.text().catch(() => "");
      const retryable = response.status === 429 || response.status >= 500;
      const error = new Error(`Speech generation failed (${response.status}).`);
      if (!retryable) throw new NonRetryableSpeechError(error.message);
      lastError = error;
    } catch (error) {
      if (error instanceof NonRetryableSpeechError) throw error;
      lastError = error instanceof Error ? error : new Error("Speech generation failed.");
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (2 ** attempt)));
    }
  }

  throw lastError || new Error("Speech generation failed after retries.");
}

/**
 * Generates one isolated WAV per scene. Isolated files let the renderer align
 * scene cuts to speech without estimating Mandarin reading speed.
 */
export async function generateNarrationWav(text: string, outputPath: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Narration text is empty.");
  if (normalized.length > 1_600) throw new Error("Narration scene exceeds the speech safety limit.");

  await mkdir(dirname(outputPath), { recursive: true });
  const audio = await speechRequest(normalized);
  if (audio.length < 1_000) throw new Error("Speech generation returned an unexpectedly small audio file.");
  await writeFile(outputPath, audio, { mode: 0o600 });
  return outputPath;
}
