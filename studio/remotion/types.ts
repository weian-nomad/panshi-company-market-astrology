export const REMOTION_FPS = 30 as const;
export const REMOTION_WIDTH = 1080 as const;
export const REMOTION_HEIGHT = 1920 as const;
export const MAX_DURATION_FRAMES = 90 * REMOTION_FPS;

export type SerializedCaptionToken = {
  text: string;
  startMs: number;
  endMs: number;
  timestampMs: number | null;
  confidence: number | null;
};

export type RemotionSceneMedia = {
  /** Public-folder path (without a leading slash), data URL, or remote URL. */
  audioSrc: string;
  /** The probed audio duration, rounded up to whole 30fps frames. */
  durationFrames: number;
  /** Optional word/phrase timing. The mapper creates deterministic timing when omitted. */
  captionTokens?: SerializedCaptionToken[];
};

export type SceneBase = {
  id: string;
  audioSrc: string;
  durationFrames: number;
  captionTokens: SerializedCaptionToken[];
  narration: string;
};

export type IntroScene = SceneBase & {
  kind: "intro";
  date: string;
  dateLabel: string;
  series: string;
  hook: string;
  hostName: string;
  hostDisclosure: string;
  priceBasisLine: string;
  stockIndex: Array<{
    symbol: string;
    shortName: string;
    categoryLabel: string;
  }>;
};

export type StockScene = SceneBase & {
  kind: "stock";
  ordinal: number;
  symbol: string;
  shortName: string;
  industry: string;
  market: "TWSE" | "TPEx";
  category: string;
  categoryLabel: string;
  close: number;
  dailyChangePercent: number;
  volumeRatio20SessionMedian: number | null;
  salienceSummary: string;
  configuration: {
    transitBodyZh: string | null;
    transitGlyph: string | null;
    natalBodyZh: string | null;
    natalGlyph: string | null;
    aspectZh: string | null;
    aspectGlyph: string | null;
    orb: number | null;
    transitLongitude: number | null;
    natalLongitude: number | null;
    activeAspectCount: number;
  };
  history: {
    horizon: number;
    status: "no-sample" | "insufficient-sample" | "descriptive-only" | "unavailable";
    minimumDescriptiveSample: number;
    sampleSize: number;
    positiveCount: number;
    zeroCount: number;
    medianReturn: number | null;
    q1Return: number | null;
    q3Return: number | null;
    caseReturns: number[];
  };
  coverage: {
    from: string | null;
    to: string | null;
    sessions: number;
    complete: boolean;
  };
};

export type OutroScene = SceneBase & {
  kind: "outro";
  boundaryLine: string;
  ctaLine: string;
  appUrl: string;
  stockIndex: Array<{
    symbol: string;
    categoryLabel: string;
  }>;
};

export type RemotionVideoScene = IntroScene | StockScene | OutroScene;

export type SevenScenes = [
  IntroScene,
  StockScene,
  StockScene,
  StockScene,
  StockScene,
  StockScene,
  OutroScene,
];

/** Pure JSON contract passed to `--props`; no Date, Map, functions, or staticFile output. */
export type RemotionVideoProps = {
  schemaVersion: 1;
  date: string;
  series: string;
  contentClassification: string;
  presenterSrc: string;
  hostName: string;
  appUrl: string;
  scenes: SevenScenes;
};

export type RemotionMediaBundle = {
  intro: RemotionSceneMedia;
  stocks: [
    RemotionSceneMedia,
    RemotionSceneMedia,
    RemotionSceneMedia,
    RemotionSceneMedia,
    RemotionSceneMedia,
  ];
  outro: RemotionSceneMedia;
};
