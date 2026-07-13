import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getStudioConfig } from "@/studio/config";

const SPEECH_ENDPOINT = "https://api.openai.com/v1/audio/speech";

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
          input: text,
          response_format: "wav",
          instructions: [
            "使用自然、沉著的臺灣華語。",
            "語速俐落但不催促，像資料編輯在口述研究札記。",
            "股票代號逐字念，數字與百分比清楚停頓。",
            "不營造權威預言、急迫感或招攬語氣。",
          ].join(" "),
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
