import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicDailyResearch } from "@/lib/daily-research";

function edition(overrides: Record<string, unknown> = {}) {
  return {
    tradeDate: "2026-07-17",
    status: "scheduled" as const,
    actualVisibility: "public" as const,
    title: "internal title",
    youtubeUrl: "https://www.youtube.com/watch?v=abc12345",
    manifest: {
      stocks: Array.from({ length: 5 }, (_, index) => ({
        symbol: `23${30 + index}`,
        companyName: `公司 ${index + 1}`,
        category: "市場異動",
        industry: "半導體業",
        market: "TWSE",
        marketSession: { close: 100 + index, dailyChangePercent: index - 2 },
        currentConfiguration: { label: "火星四分相本命太陽", orb: 0.5 },
        study: {
          horizon: 20,
          statistics: {
            sampleSize: 6,
            positiveCount: 3,
            zeroCount: 0,
            medianReturn: 1.2,
            q1Return: -2.1,
            q3Return: 3.4,
          },
        },
      })),
    },
    ...overrides,
  };
}

test("only exposes a complete public five-item research summary", () => {
  const payload = buildPublicDailyResearch([edition()]);
  assert.equal(payload?.items.length, 5);
  assert.equal(payload?.items[0].study.negativeCount, 3);
  assert.equal(payload?.selectionPolicy, "neutral-editorial-salience");
  assert.equal(JSON.stringify(payload).includes("cases"), false);
});

test("does not expose ready, private, or incomplete editions", () => {
  assert.equal(buildPublicDailyResearch([edition({ status: "ready" }) as never]), null);
  assert.equal(buildPublicDailyResearch([edition({ actualVisibility: "private" }) as never]), null);
  assert.equal(buildPublicDailyResearch([edition({ manifest: { stocks: [] } })]), null);
});
