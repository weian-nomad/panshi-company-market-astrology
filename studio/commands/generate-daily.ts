import { createHash } from "node:crypto";
import { buildDailyCandidates, getLatestMarketTradeDate } from "@/studio/facts";
import { renderDailyVideo } from "@/studio/render";
import { buildDailyContentPackage } from "@/studio/script";
import { selectDailyFive } from "@/studio/selection";
import {
  getEdition,
  isEditionGenerationLocked,
  listEditions,
  saveEdition,
  setEditionFailed,
} from "@/studio/store";
import { getStudioConfig, taipeiDate } from "@/studio/config";
import type { DailyContentPackage } from "@/studio/types";
import { validateDailyPackage } from "@/studio/validation";
import { loadVaultKeys } from "@/studio/vault";

function option(name: string) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((value) => value.startsWith(prefix))?.slice(prefix.length) || null;
}

function hasFlag(name: string) {
  return process.argv.slice(2).includes(`--${name}`);
}

function recentSymbols() {
  return listEditions(10).flatMap((edition) => {
    const stocks = edition.manifest.stocks;
    if (!Array.isArray(stocks)) return [];
    return stocks.flatMap((stock) => {
      if (!stock || typeof stock !== "object") return [];
      const symbol = (stock as { symbol?: unknown }).symbol;
      return typeof symbol === "string" ? [symbol] : [];
    });
  });
}

function currentConfiguration(content: DailyContentPackage, index: number) {
  const item = content.selection.items[index];
  const matching = item.facts.transits.find((transit) => transit.signature === item.facts.study?.signature)
    ?? item.facts.transits[0];
  return matching
    ? {
        label: `${matching.transitBodyZh}${matching.aspectZh}本命${matching.natalBodyZh}`,
        orb: matching.orb,
        signature: matching.signature,
      }
    : null;
}

function manifestFor(content: DailyContentPackage, render: Awaited<ReturnType<typeof renderDailyVideo>>) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    series: content.script.series,
    contentClassification: content.script.contentClassification,
    selectionPolicy: content.selection.policy,
    aiHost: {
      name: content.script.host.name,
      disclosed: content.script.hostDisclosure,
    },
    tags: content.script.hashtags.map((tag) => tag.replace(/^#/, "")),
    stocks: content.selection.items.map((item, index) => ({
      symbol: item.facts.symbol,
      companyName: item.facts.shortName,
      category: item.categoryLabel,
      industry: item.facts.industry,
      market: item.facts.market,
      marketSession: item.facts.session,
      currentConfiguration: currentConfiguration(content, index),
      study: item.facts.study,
      coverage: item.facts.coverage,
      appUrl: item.facts.appUrl,
    })),
    sceneNarrations: render.sceneNarrations,
    renderManifestPath: render.manifestPath,
    content,
  };
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2_000) : "Daily studio generation failed.";
}

function saveInitialFailure(tradeDate: string, error: string) {
  const existing = getEdition(tradeDate);
  if (existing) {
    if (isEditionGenerationLocked(existing)) return;
    setEditionFailed(tradeDate, error);
    return;
  }
  const contentHash = createHash("sha256").update(`${tradeDate}:${error}`).digest("hex");
  saveEdition({
    tradeDate,
    status: "failed",
    title: `${tradeDate}｜今日五盤｜生成未完成`,
    description: "本期未進入發布佇列。",
    manifest: { schemaVersion: 1, generationError: error },
    qc: { passed: false, issues: [error] },
    contentHash,
    videoPath: null,
    thumbnailPath: null,
    publishAt: null,
    channelId: null,
    visibilityOverride: null,
    requestedVisibility: null,
    actualVisibility: null,
    legalReviewId: null,
    approvedAt: null,
    approvedBy: null,
    youtubeVideoId: null,
    youtubeUrl: null,
    error,
  });
}

async function main() {
  loadVaultKeys(["OPENAI_API_KEY"]);
  const requestedDate = option("date");
  const today = taipeiDate();
  const latest = getLatestMarketTradeDate();
  const tradeDate = requestedDate || today;
  const force = hasFlag("force");

  if (!requestedDate && latest !== today) {
    console.log(JSON.stringify({
      status: "skipped",
      reason: "market-date-not-ready",
      expectedDate: today,
      latestCachedTradeDate: latest,
    }));
    return;
  }

  const existing = getEdition(tradeDate);
  if (existing && isEditionGenerationLocked(existing)) {
    console.log(JSON.stringify({ status: "locked", tradeDate, editionStatus: existing.status }));
    return;
  }
  if (existing?.status === "ready" && !force) {
    console.log(JSON.stringify({ status: "ready", tradeDate, message: "Existing edition retained." }));
    return;
  }

  try {
    const config = getStudioConfig();
    const candidates = buildDailyCandidates(tradeDate, { appBaseUrl: `${config.siteUrl}/` });
    const selection = selectDailyFive({
      date: tradeDate,
      candidates,
      recentSymbols: recentSymbols(),
    });
    const content = buildDailyContentPackage(selection, { appUrl: `${config.siteUrl}/` });
    const validation = validateDailyPackage(content, { expectedDate: tradeDate });
    if (!validation.valid) {
      throw new Error(`Content validation failed: ${validation.errors.map((item) => `${item.code}:${item.message}`).join(" | ")}`);
    }

    const render = await renderDailyVideo(content);
    const description = `${content.script.caption}\n\n${content.script.hashtags.join(" ")}`;
    const edition = saveEdition({
      tradeDate,
      status: "ready",
      title: content.script.title,
      description,
      manifest: manifestFor(content, render),
      qc: render.qc as unknown as Record<string, unknown>,
      contentHash: render.contentHash,
      videoPath: render.videoPath,
      thumbnailPath: render.thumbnailPath,
      publishAt: null,
      channelId: config.channelId,
      visibilityOverride: null,
      requestedVisibility: null,
      actualVisibility: null,
      legalReviewId: config.legalReviewId,
      approvedAt: null,
      approvedBy: null,
      youtubeVideoId: null,
      youtubeUrl: null,
      error: null,
    });

    console.log(JSON.stringify({
      status: edition.status,
      tradeDate,
      symbols: content.selection.items.map((item) => item.facts.symbol),
      durationSeconds: render.qc.durationSeconds,
      contentHash: render.contentHash,
      publicationMode: config.publicationMode,
    }));
  } catch (error) {
    const message = safeMessage(error);
    saveInitialFailure(tradeDate, message);
    throw error;
  }
}

main().catch((error) => {
  console.error(safeMessage(error));
  process.exitCode = 1;
});
