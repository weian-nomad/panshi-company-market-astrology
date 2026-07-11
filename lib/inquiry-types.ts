import type { TransitConfiguration } from "@/lib/astrology";
import type { PriceHistory, TradingDateResolution } from "@/lib/company-data";

export type InquiryAnchorKey = "listing" | "established";
export type InquiryIntent = "consider_buy" | "consider_sell" | "observe";
export type InquiryHorizon = 5 | 20 | 60;

export function isInquiryAnchor(value: string): value is InquiryAnchorKey {
  return value === "listing" || value === "established";
}

export type InquiryEvidenceCase = {
  date: string;
  endDate: string;
  startClose: number;
  endClose: number;
  returnPercent: number;
  maxAdverseMove: number;
  orb: number;
};

export type InquiryStudy = {
  matchMode: "exact";
  signature: string;
  configurationLabel: string;
  horizon: InquiryHorizon;
  status: "no-sample" | "insufficient-sample" | "descriptive-only";
  statusLabel: string;
  minimumDescriptiveSample: 5;
  statistics: {
    sampleSize: number;
    positiveCount: number;
    zeroCount: number;
    medianReturn: number | null;
    q1Return: number | null;
    q3Return: number | null;
    medianAdverseMove: number | null;
    worstAdverseMove: number | null;
  };
  cases: InquiryEvidenceCase[];
};

export type InquiryPayload = {
  company: {
    symbol: string;
    shortName: string;
  };
  question: {
    requestedDate: string;
    anchor: InquiryAnchorKey;
    horizon: InquiryHorizon;
  };
  tradingSession: TradingDateResolution;
  symbolic: {
    activeOrb: 3;
    primary: TransitConfiguration | null;
    configurations: TransitConfiguration[];
  };
  evidence: {
    study: InquiryStudy | null;
    coverage: PriceHistory["coverage"];
  };
  events: {
    status: "checked" | "partial" | "unavailable";
    windowDays: 7;
    items: Array<{
      date: string;
      category: "除權息" | "股東會" | "重大訊息" | "暫停交易";
      title: string;
    }>;
    checks: Array<{
      label: string;
      state: "found" | "checked" | "unavailable" | "not-integrated";
      detail: string;
    }>;
    checkedAt: string;
    freshnessNote: string;
  };
  boundaries: {
    chartPrecision: string;
    statements: string[];
  };
  sources: {
    price: string;
    calendar: string;
    events: string;
    generatedAt: string;
  };
};

export type SavedInquiry = {
  id: string;
  savedAt: string;
  company: InquiryPayload["company"];
  anchor: InquiryAnchorKey;
  targetDate: string;
  effectiveDate: string;
  intent: InquiryIntent;
  horizon: InquiryHorizon;
  observationStatus: string;
  dataAsOf: string | null;
  reason: string;
  disconfirmingEvidence: string;
  reviewDate: string;
  reviewedAt?: string | null;
};
