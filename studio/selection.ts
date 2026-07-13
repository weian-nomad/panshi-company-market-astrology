import type { InquiryStudy } from "@/lib/inquiry-types";
import {
  EDITORIAL_CATEGORIES,
  EDITORIAL_CATEGORY_LABELS,
  type DailyFiveSelection,
  type DailySelectionItem,
  type DailyStockFacts,
  type EditorialCategory,
  type FiveItems,
  type SalienceMetric,
} from "@/studio/types";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function round(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

function signedPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function primaryStudyTransit(candidate: DailyStockFacts) {
  const matching = candidate.study
    ? candidate.transits.find((transit) => transit.signature === candidate.study?.signature)
    : null;
  return matching ?? [...candidate.transits].sort((a, b) => (
    a.orb - b.orb || a.signature.localeCompare(b.signature)
  ))[0] ?? null;
}

export function signatureForCandidate(candidate: DailyStockFacts) {
  return primaryStudyTransit(candidate)?.signature ?? "";
}

function hasUsableCoverage(candidate: DailyStockFacts) {
  const coverage = candidate.coverage;
  return coverage.basis === "raw-unadjusted-close"
    && coverage.sessions > 0
    && coverage.requestedMonths > 0
    && coverage.receivedMonths > 0
    && coverage.from !== null
    && coverage.to !== null;
}

function hasCurrentStudy(candidate: DailyStockFacts) {
  return candidate.study !== null
    && candidate.transits.some((transit) => transit.signature === candidate.study?.signature);
}

function isBaseEligible(candidate: DailyStockFacts, date: string) {
  return DATE_PATTERN.test(date)
    && candidate.date === date
    && candidate.session.date === date
    && Number.isFinite(candidate.session.close)
    && candidate.session.close > 0
    && Number.isFinite(candidate.session.dailyChangePercent)
    && candidate.transits.length > 0
    && hasCurrentStudy(candidate)
    && hasUsableCoverage(candidate);
}

export function isEligibleForCategory(
  candidate: DailyStockFacts,
  category: EditorialCategory,
  date = candidate.date,
) {
  if (!isBaseEligible(candidate, date)) return false;

  switch (category) {
    case "market-move":
      return Math.abs(candidate.session.dailyChangePercent) > 0;
    case "volume-anomaly": {
      const ratio = candidate.session.volumeRatio20SessionMedian;
      return ratio !== null && Number.isFinite(ratio) && ratio > 0 && Math.abs(ratio - 1) >= 0.05;
    }
    case "dense-aspects":
      return candidate.transits.length >= 2;
    case "historical-divergence": {
      const study = candidate.study;
      const q1 = study?.statistics.q1Return;
      const q3 = study?.statistics.q3Return;
      if (
        !study
        || study.status !== "descriptive-only"
        || study.statistics.sampleSize < study.minimumDescriptiveSample
        || q1 === null
        || q1 === undefined
        || q3 === null
        || q3 === undefined
      ) return false;
      return q3 > q1;
    }
    case "rare-sample":
      return Boolean(candidate.study && candidate.study.statistics.sampleSize < 5);
  }
}

function categoryScore(candidate: DailyStockFacts, category: EditorialCategory) {
  switch (category) {
    case "market-move":
      return Math.abs(candidate.session.dailyChangePercent);
    case "volume-anomaly":
      return Math.abs(Math.log(candidate.session.volumeRatio20SessionMedian ?? 1));
    case "dense-aspects": {
      const tightestOrb = Math.min(...candidate.transits.map((transit) => transit.orb));
      return candidate.transits.length + Math.max(0, 3 - tightestOrb) / 10;
    }
    case "historical-divergence": {
      const q1 = candidate.study?.statistics.q1Return;
      const q3 = candidate.study?.statistics.q3Return;
      return q1 === null || q1 === undefined || q3 === null || q3 === undefined ? -Infinity : q3 - q1;
    }
    case "rare-sample":
      return 5 - (candidate.study?.statistics.sampleSize ?? 5);
  }
}

function categoryMetric(category: EditorialCategory): SalienceMetric {
  switch (category) {
    case "market-move": return "absolute-daily-change";
    case "volume-anomaly": return "volume-ratio-to-20-session-median";
    case "dense-aspects": return "active-aspect-count";
    case "historical-divergence": return "interquartile-spread";
    case "rare-sample": return "exact-sample-count";
  }
}

function salienceValue(candidate: DailyStockFacts, category: EditorialCategory) {
  switch (category) {
    case "market-move":
      return round(Math.abs(candidate.session.dailyChangePercent), 1);
    case "volume-anomaly":
      return round(candidate.session.volumeRatio20SessionMedian ?? 0, 2);
    case "dense-aspects":
      return candidate.transits.length;
    case "historical-divergence": {
      const q1 = candidate.study?.statistics.q1Return ?? 0;
      const q3 = candidate.study?.statistics.q3Return ?? 0;
      return round(q3 - q1, 1);
    }
    case "rare-sample":
      return candidate.study?.statistics.sampleSize ?? 0;
  }
}

function salienceSummary(candidate: DailyStockFacts, category: EditorialCategory) {
  switch (category) {
    case "market-move":
      return `單日未還原收盤價變動為 ${signedPercent(candidate.session.dailyChangePercent)}。`;
    case "volume-anomaly":
      return `成交量為近 20 個交易日中位量的 ${(candidate.session.volumeRatio20SessionMedian ?? 0).toFixed(1)} 倍。`;
    case "dense-aspects":
      return `3° 容許度內共有 ${candidate.transits.length} 組主要相位。`;
    case "historical-divergence": {
      const study = candidate.study as InquiryStudy;
      const spread = (study.statistics.q3Return as number) - (study.statistics.q1Return as number);
      return `同組態 D+${study.horizon} 變動的四分位跨度為 ${spread.toFixed(1)} 個百分點。`;
    }
    case "rare-sample":
      return `同組態只有 ${candidate.study?.statistics.sampleSize ?? 0} 筆完整樣本，樣本不足。`;
  }
}

function stableCandidateKey(candidate: DailyStockFacts) {
  return [
    candidate.symbol,
    candidate.industry,
    signatureForCandidate(candidate),
    candidate.session.close.toFixed(4),
    candidate.session.dailyChangePercent.toFixed(4),
    candidate.transits.length,
    candidate.study?.statistics.sampleSize ?? -1,
  ].join("|");
}

function deduplicateCandidates(candidates: DailyStockFacts[]) {
  const sorted = [...candidates].sort((a, b) => stableCandidateKey(a).localeCompare(stableCandidateKey(b)));
  const seen = new Set<string>();
  return sorted.filter((candidate) => {
    if (seen.has(candidate.symbol)) return false;
    seen.add(candidate.symbol);
    return true;
  });
}

function sharesSignature(candidate: DailyStockFacts, selected: DailyStockFacts[]) {
  const selectedSignatures = new Set(selected.flatMap((item) => item.transits.map((transit) => transit.signature)));
  return candidate.transits.some((transit) => selectedSignatures.has(transit.signature));
}

function compareForCategory({
  category,
  recent,
  selected,
}: {
  category: EditorialCategory;
  recent: Set<string>;
  selected: DailyStockFacts[];
}) {
  return (a: DailyStockFacts, b: DailyStockFacts) => {
    const aRecent = Number(recent.has(a.symbol));
    const bRecent = Number(recent.has(b.symbol));
    if (aRecent !== bRecent) return aRecent - bRecent;

    const aSignatureRepeat = Number(sharesSignature(a, selected));
    const bSignatureRepeat = Number(sharesSignature(b, selected));
    if (aSignatureRepeat !== bSignatureRepeat) return aSignatureRepeat - bSignatureRepeat;

    const usedIndustries = new Set(selected.map((item) => item.industry));
    const aIndustryRepeat = Number(usedIndustries.has(a.industry));
    const bIndustryRepeat = Number(usedIndustries.has(b.industry));
    if (aIndustryRepeat !== bIndustryRepeat) return aIndustryRepeat - bIndustryRepeat;

    const scoreDifference = categoryScore(b, category) - categoryScore(a, category);
    if (Math.abs(scoreDifference) > Number.EPSILON) return scoreDifference;
    return a.symbol.localeCompare(b.symbol);
  };
}

function canCompleteAssignment({
  categories,
  candidates,
  blockedSymbols,
  date,
}: {
  categories: EditorialCategory[];
  candidates: DailyStockFacts[];
  blockedSymbols: Set<string>;
  date: string;
}) {
  const matchedCategoryBySymbol = new Map<string, EditorialCategory>();

  const findMatch = (category: EditorialCategory, visited: Set<string>): boolean => {
    const eligible = candidates
      .filter((candidate) => !blockedSymbols.has(candidate.symbol) && isEligibleForCategory(candidate, category, date))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));

    for (const candidate of eligible) {
      if (visited.has(candidate.symbol)) continue;
      visited.add(candidate.symbol);
      const previousCategory = matchedCategoryBySymbol.get(candidate.symbol);
      if (!previousCategory || findMatch(previousCategory, visited)) {
        matchedCategoryBySymbol.set(candidate.symbol, category);
        return true;
      }
    }
    return false;
  };

  return categories.every((category) => findMatch(category, new Set()));
}

function toSelectionItem(candidate: DailyStockFacts, category: EditorialCategory): DailySelectionItem {
  return {
    category,
    categoryLabel: EDITORIAL_CATEGORY_LABELS[category],
    facts: candidate,
    salience: {
      metric: categoryMetric(category),
      value: salienceValue(candidate, category),
      summary: salienceSummary(candidate, category),
    },
  };
}

export function selectDailyFive({
  date,
  candidates,
  recentSymbols = [],
}: {
  date: string;
  candidates: DailyStockFacts[];
  recentSymbols?: string[];
}): DailyFiveSelection {
  if (!DATE_PATTERN.test(date)) throw new Error("今日五盤日期必須使用 YYYY-MM-DD。");

  const pool = deduplicateCandidates(candidates).filter((candidate) => isBaseEligible(candidate, date));
  const categoryOrder = [...EDITORIAL_CATEGORIES].sort((a, b) => {
    const aCount = pool.filter((candidate) => isEligibleForCategory(candidate, a, date)).length;
    const bCount = pool.filter((candidate) => isEligibleForCategory(candidate, b, date)).length;
    return aCount - bCount || EDITORIAL_CATEGORIES.indexOf(a) - EDITORIAL_CATEGORIES.indexOf(b);
  });

  if (!canCompleteAssignment({ categories: categoryOrder, candidates: pool, blockedSymbols: new Set(), date })) {
    const availability = EDITORIAL_CATEGORIES.map((category) => {
      const count = pool.filter((candidate) => isEligibleForCategory(candidate, category, date)).length;
      return `${EDITORIAL_CATEGORY_LABELS[category]} ${count} 檔`;
    }).join("、");
    throw new Error(`無法組成五檔不重複的今日五盤：${availability}。`);
  }

  const recent = new Set(recentSymbols);
  const selected = new Map<EditorialCategory, DailyStockFacts>();
  const selectedFacts: DailyStockFacts[] = [];

  for (let index = 0; index < categoryOrder.length; index += 1) {
    const category = categoryOrder[index];
    const remainingCategories = categoryOrder.slice(index + 1);
    const ranked = pool
      .filter((candidate) => (
        !selectedFacts.some((item) => item.symbol === candidate.symbol)
        && isEligibleForCategory(candidate, category, date)
      ))
      .sort(compareForCategory({ category, recent, selected: selectedFacts }));

    const choice = ranked.find((candidate) => {
      const blockedSymbols = new Set([...selectedFacts.map((item) => item.symbol), candidate.symbol]);
      return canCompleteAssignment({
        categories: remainingCategories,
        candidates: pool,
        blockedSymbols,
        date,
      });
    });

    if (!choice) throw new Error(`無法為「${EDITORIAL_CATEGORY_LABELS[category]}」保留唯一標的。`);
    selected.set(category, choice);
    selectedFacts.push(choice);
  }

  const items = EDITORIAL_CATEGORIES.map((category) => {
    const candidate = selected.get(category);
    if (!candidate) throw new Error(`缺少「${EDITORIAL_CATEGORY_LABELS[category]}」標的。`);
    return toSelectionItem(candidate, category);
  }) as FiveItems<DailySelectionItem>;

  return {
    date,
    policy: "neutral-editorial-salience",
    items,
    diversification: {
      recentSymbolsConsidered: [...new Set(recentSymbols)].sort((a, b) => a.localeCompare(b)),
      precedence: ["recent-symbol", "signature", "industry", "category-salience", "symbol"],
    },
  };
}
