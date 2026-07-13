import type { DailyContentPackage, DailySelectionItem } from "@/studio/types";
import { createTimedCaptionTokens, validateRemotionVideoProps } from "./utils";
import type {
  RemotionMediaBundle,
  RemotionSceneMedia,
  RemotionVideoProps,
  SevenScenes,
  StockScene,
} from "./types";

const DEFAULT_PRESENTER = "studio/presenter/moheng-virtual-host.png";
const DEFAULT_APP_URL = "https://panshi.nomadsustaintech.com/";

type MapOptions = {
  presenterSrc?: string;
  appUrl?: string;
  sceneNarrations?: [string, string, string, string, string, string, string];
};

function dateLabel(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

function primaryTransit(item: DailySelectionItem) {
  const signature = item.facts.study?.signature;
  return item.facts.transits.find((transit) => transit.signature === signature)
    ?? [...item.facts.transits].sort((a, b) => a.orb - b.orb || a.signature.localeCompare(b.signature))[0]
    ?? null;
}

function captions(narration: string, media: RemotionSceneMedia) {
  return media.captionTokens ?? createTimedCaptionTokens(narration, media.durationFrames);
}

function stockScene(
  content: DailyContentPackage,
  index: number,
  media: RemotionSceneMedia,
  narration: string,
): StockScene {
  const item = content.selection.items[index];
  const study = item.facts.study;
  const transit = primaryTransit(item);

  return {
    kind: "stock",
    id: `${String(index + 1).padStart(2, "0")}-${item.facts.symbol}`,
    audioSrc: media.audioSrc,
    durationFrames: media.durationFrames,
    captionTokens: captions(narration, media),
    narration,
    ordinal: index + 1,
    symbol: item.facts.symbol,
    shortName: item.facts.shortName,
    industry: item.facts.industry,
    market: item.facts.market,
    category: item.category,
    categoryLabel: item.categoryLabel,
    close: item.facts.session.close,
    dailyChangePercent: item.facts.session.dailyChangePercent,
    volumeRatio20SessionMedian: item.facts.session.volumeRatio20SessionMedian,
    salienceSummary: item.salience.summary,
    configuration: {
      transitBodyZh: transit?.transitBodyZh ?? null,
      transitGlyph: transit?.transitGlyph ?? null,
      natalBodyZh: transit?.natalBodyZh ?? null,
      natalGlyph: transit?.natalGlyph ?? null,
      aspectZh: transit?.aspectZh ?? null,
      aspectGlyph: transit?.aspectGlyph ?? null,
      orb: transit?.orb ?? null,
      transitLongitude: transit?.transitLongitude ?? null,
      natalLongitude: transit?.natalLongitude ?? null,
      activeAspectCount: item.facts.transits.length,
    },
    history: {
      horizon: study?.horizon ?? 20,
      status: study?.status ?? "unavailable",
      minimumDescriptiveSample: study?.minimumDescriptiveSample ?? 5,
      sampleSize: study?.statistics.sampleSize ?? 0,
      positiveCount: study?.statistics.positiveCount ?? 0,
      negativeCount: study
        ? study.statistics.sampleSize - study.statistics.positiveCount - study.statistics.zeroCount
        : 0,
      zeroCount: study?.statistics.zeroCount ?? 0,
      medianReturn: study?.statistics.medianReturn ?? null,
      q1Return: study?.statistics.q1Return ?? null,
      q3Return: study?.statistics.q3Return ?? null,
      medianAdverseMove: study?.statistics.medianAdverseMove ?? null,
      worstAdverseMove: study?.statistics.worstAdverseMove ?? null,
      caseReturns: study?.cases.map((sample) => sample.returnPercent) ?? [],
    },
    coverage: {
      from: item.facts.coverage.from,
      to: item.facts.coverage.to,
      sessions: item.facts.coverage.sessions,
      complete: item.facts.coverage.complete,
    },
  };
}

/** Maps fact-locked content plus probed audio media into the render-only JSON contract. */
export function mapDailyContentPackageToRemotionProps(
  content: DailyContentPackage,
  media: RemotionMediaBundle,
  options: MapOptions = {},
): RemotionVideoProps {
  const allMedia = [media.intro, ...media.stocks, media.outro];
  if (allMedia.some((entry) => !entry.audioSrc.trim())) {
    throw new Error("Every production Remotion scene requires an audioSrc.");
  }
  const appUrl = options.appUrl?.trim() || DEFAULT_APP_URL;
  const introNarration = [content.script.hook, content.script.hostDisclosure, content.script.priceBasisLine].join(" ");
  const outroNarration = [
    "完整案例和反例，進盤勢查畫面上的股票代號。",
    content.script.boundaryLine,
  ].join(" ");
  const defaultNarrations: [string, string, string, string, string, string, string] = [
    introNarration,
    content.script.segments[0].narration,
    content.script.segments[1].narration,
    content.script.segments[2].narration,
    content.script.segments[3].narration,
    content.script.segments[4].narration,
    outroNarration,
  ];
  const sceneNarrations = options.sceneNarrations ?? defaultNarrations;
  if (sceneNarrations.some((narration) => !narration.trim())) {
    throw new Error("Every Remotion scene requires narration.");
  }
  const stockScenes = content.selection.items.map((_, index) => stockScene(
    content,
    index,
    media.stocks[index],
    sceneNarrations[index + 1],
  )) as [
    StockScene,
    StockScene,
    StockScene,
    StockScene,
    StockScene,
  ];

  const scenes: SevenScenes = [
    {
      kind: "intro",
      id: "00-intro",
      audioSrc: media.intro.audioSrc,
      durationFrames: media.intro.durationFrames,
      captionTokens: captions(sceneNarrations[0], media.intro),
      narration: sceneNarrations[0],
      date: content.script.date,
      dateLabel: dateLabel(content.script.date),
      series: content.script.series,
      hook: content.script.hook,
      hostName: content.script.host.name,
      hostDisclosure: content.script.hostDisclosure,
      priceBasisLine: content.script.priceBasisLine,
      stockIndex: content.selection.items.map((item) => ({
        symbol: item.facts.symbol,
        shortName: item.facts.shortName,
        categoryLabel: item.categoryLabel,
      })),
    },
    ...stockScenes,
    {
      kind: "outro",
      id: "06-outro",
      audioSrc: media.outro.audioSrc,
      durationFrames: media.outro.durationFrames,
      captionTokens: captions(sceneNarrations[6], media.outro),
      narration: sceneNarrations[6],
      boundaryLine: content.script.boundaryLine,
      ctaLine: content.script.ctaLine,
      appUrl,
      stockIndex: content.selection.items.map((item) => ({
        symbol: item.facts.symbol,
        categoryLabel: item.categoryLabel,
      })),
    },
  ];

  const props: RemotionVideoProps = {
    schemaVersion: 1,
    date: content.script.date,
    series: content.script.series,
    contentClassification: content.script.contentClassification,
    presenterSrc: options.presenterSrc?.trim() || DEFAULT_PRESENTER,
    hostName: content.script.host.name,
    appUrl,
    scenes,
  };
  validateRemotionVideoProps(props);
  JSON.stringify(props);
  return props;
}
