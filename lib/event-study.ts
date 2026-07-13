import type { HistoricalTransitEpisode, PriceBar } from "@/lib/astrology";
import type { InquiryHorizon, InquiryStudy } from "@/lib/inquiry-types";

function round(value: number) {
  return Number(value.toFixed(1));
}

export function eventStudyQuantile(values: number[], proportion: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * proportion;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return round(sorted[lower]);
  const interpolated = sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  return round(interpolated);
}

export function summarizeInquiryCases(cases: InquiryStudy["cases"]): InquiryStudy["statistics"] {
  const returns = cases.map((item) => item.returnPercent);
  const adverseMoves = cases.map((item) => item.maxAdverseMove);
  return {
    sampleSize: cases.length,
    positiveCount: returns.filter((value) => value > 0).length,
    zeroCount: returns.filter((value) => value === 0).length,
    medianReturn: eventStudyQuantile(returns, 0.5),
    q1Return: eventStudyQuantile(returns, 0.25),
    q3Return: eventStudyQuantile(returns, 0.75),
    medianAdverseMove: eventStudyQuantile(adverseMoves, 0.5),
    worstAdverseMove: adverseMoves.length ? round(Math.min(...adverseMoves)) : null,
  };
}

function intervalCrossesMissingMonth(startDate: string, endDate: string, missingMonths: Set<string>) {
  const cursor = new Date(`${startDate.slice(0, 7)}-01T00:00:00Z`);
  const end = new Date(`${endDate.slice(0, 7)}-01T00:00:00Z`);
  while (cursor <= end) {
    const key = `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, "0")}01`;
    if (missingMonths.has(key)) return true;
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return false;
}

function statusLabel(returns: number[]) {
  if (returns.length < 5) return "樣本不足";
  return "僅供描述";
}

export function buildExactConfigurationStudy({
  bars,
  episodes,
  signature,
  configurationLabel,
  horizon,
  missingMonths = [],
}: {
  bars: PriceBar[];
  episodes: HistoricalTransitEpisode[];
  signature: string;
  configurationLabel: string;
  horizon: InquiryHorizon;
  missingMonths?: string[];
}): InquiryStudy {
  const missing = new Set(missingMonths);
  const cases = episodes
    .filter((episode) => episode.signature === signature)
    .flatMap((episode) => {
      const end = bars[episode.barIndex + horizon];
      if (!end) return [];
      if (intervalCrossesMissingMonth(episode.date, end.date, missing)) return [];
      const forwardBars = bars.slice(episode.barIndex + 1, episode.barIndex + horizon + 1);
      if (forwardBars.length !== horizon) return [];
      const lowest = Math.min(...forwardBars.map((bar) => bar.low));
      return [{
        date: episode.date,
        endDate: end.date,
        startClose: episode.close,
        endClose: end.close,
        returnPercent: round(((end.close / episode.close) - 1) * 100),
        maxAdverseMove: round(((lowest / episode.close) - 1) * 100),
        orb: episode.orb,
      }];
    });

  const statistics = summarizeInquiryCases(cases);
  const returns = cases.map((item) => item.returnPercent);
  const sampleSize = statistics.sampleSize;

  return {
    matchMode: "exact",
    signature,
    configurationLabel,
    horizon,
    status: sampleSize === 0
      ? "no-sample"
      : sampleSize < 5
        ? "insufficient-sample"
        : "descriptive-only",
    statusLabel: statusLabel(returns),
    minimumDescriptiveSample: 5,
    statistics,
    cases,
  };
}
