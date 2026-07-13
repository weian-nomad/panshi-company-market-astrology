import type { InquiryStudy } from "@/lib/inquiry-types";
import { summarizeInquiryCases } from "@/lib/event-study";

export type StudyDirectionCounts = {
  positive: number;
  negative: number;
  zero: number;
};

export function studyDirectionCounts(study: InquiryStudy): StudyDirectionCounts {
  return study.cases.reduce<StudyDirectionCounts>((counts, sample) => {
    if (sample.returnPercent > 0) counts.positive += 1;
    else if (sample.returnPercent < 0) counts.negative += 1;
    else counts.zero += 1;
    return counts;
  }, { positive: 0, negative: 0, zero: 0 });
}

export function hasCompleteDescriptiveStatistics(study: InquiryStudy) {
  const stats = study.statistics;
  return [
    stats.medianReturn,
    stats.q1Return,
    stats.q3Return,
    stats.medianAdverseMove,
    stats.worstAdverseMove,
  ].every((value) => value !== null && Number.isFinite(value));
}

function isRealIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sameNullableNumber(a: number | null, b: number | null) {
  if (a === null || b === null) return a === b;
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
}

function hasValidCases(study: InquiryStudy) {
  const dates = new Set<string>();
  return study.cases.every((sample) => {
    const expectedReturn = Number((((sample.endClose / sample.startClose) - 1) * 100).toFixed(1));
    const valid = isRealIsoDate(sample.date)
      && isRealIsoDate(sample.endDate)
      && sample.endDate >= sample.date
      && !dates.has(sample.date)
      && Number.isFinite(sample.startClose)
      && sample.startClose > 0
      && Number.isFinite(sample.endClose)
      && sample.endClose > 0
      && Number.isFinite(sample.returnPercent)
      && Math.abs(sample.returnPercent - expectedReturn) < 1e-9
      && Number.isFinite(sample.maxAdverseMove)
      && Number.isFinite(sample.orb)
      && sample.orb >= 0;
    dates.add(sample.date);
    return valid;
  });
}

export function hasConsistentStudyStatistics(study: InquiryStudy) {
  if (!hasValidCases(study)) return false;
  const expected = summarizeInquiryCases(study.cases);
  const actual = study.statistics;
  return actual.sampleSize === expected.sampleSize
    && actual.positiveCount === expected.positiveCount
    && actual.zeroCount === expected.zeroCount
    && sameNullableNumber(actual.medianReturn, expected.medianReturn)
    && sameNullableNumber(actual.q1Return, expected.q1Return)
    && sameNullableNumber(actual.q3Return, expected.q3Return)
    && sameNullableNumber(actual.medianAdverseMove, expected.medianAdverseMove)
    && sameNullableNumber(actual.worstAdverseMove, expected.worstAdverseMove);
}

/**
 * Publication is deliberately stricter than the underlying event-study API.
 * Every narrated study must clear the descriptive threshold and contain both
 * upward and downward historical outcomes. A one-sided tiny sample never
 * becomes a daily-video claim.
 */
export function isPublishableStudy(study: InquiryStudy | null): boolean {
  if (!study) return false;
  const directions = studyDirectionCounts(study);
  const stats = study.statistics;
  return study.status === "descriptive-only"
    && stats.sampleSize >= study.minimumDescriptiveSample
    && stats.sampleSize === study.cases.length
    && hasConsistentStudyStatistics(study)
    && stats.positiveCount === directions.positive
    && stats.zeroCount === directions.zero
    && directions.positive > 0
    && directions.negative > 0
    && hasCompleteDescriptiveStatistics(study);
}

function evidenceRank(study: InquiryStudy) {
  if (isPublishableStudy(study)) return 2;
  if (study.status === "descriptive-only") return 1;
  return 0;
}

/**
 * Chooses among today's exact active configurations using evidence quality,
 * never return magnitude. This is selection for support, not for a dramatic
 * historical outcome.
 */
export function selectBestExactActiveStudy(
  candidates: Array<{ study: InquiryStudy; orb: number }>,
) {
  return [...candidates].sort((a, b) => (
    evidenceRank(b.study) - evidenceRank(a.study)
    || b.study.statistics.sampleSize - a.study.statistics.sampleSize
    || a.orb - b.orb
    || a.study.signature.localeCompare(b.study.signature)
  ))[0]?.study ?? null;
}
