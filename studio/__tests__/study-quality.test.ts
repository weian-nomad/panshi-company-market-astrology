import assert from "node:assert/strict";
import test from "node:test";

import type { InquiryStudy } from "@/lib/inquiry-types";
import { summarizeInquiryCases } from "@/lib/event-study";
import {
  isPublishableStudy,
  selectBestExactActiveStudy,
  studyDirectionCounts,
} from "@/studio/study-quality";

function study(signature: string, returns: number[]): InquiryStudy {
  const status = returns.length === 0
    ? "no-sample"
    : returns.length < 5
      ? "insufficient-sample"
      : "descriptive-only";
  const cases = returns.map((returnPercent, index) => ({
    date: `2024-${String(index + 1).padStart(2, "0")}-02`,
    endDate: `2024-${String(index + 1).padStart(2, "0")}-28`,
    startClose: 100,
    endClose: 100 + returnPercent,
    returnPercent,
    maxAdverseMove: -2 - index,
    orb: 0.5,
  }));
  return {
    matchMode: "exact",
    signature,
    configurationLabel: signature,
    horizon: 20,
    status,
    statusLabel: status === "descriptive-only" ? "僅供描述" : "樣本不足",
    minimumDescriptiveSample: 5,
    statistics: summarizeInquiryCases(cases),
    cases,
  };
}

test("影片研究門檻同時要求描述性樣本與上、下行案例", () => {
  const mixed = study("mixed", [-4, -1, 0, 2, 5]);
  assert.deepEqual(studyDirectionCounts(mixed), { positive: 2, negative: 2, zero: 1 });
  assert.equal(isPublishableStudy(mixed), true);
  assert.equal(isPublishableStudy(study("small", [-1, 2])), false);
  assert.equal(isPublishableStudy(study("one-sided", [1, 2, 3, 4, 5])), false);
  assert.equal(isPublishableStudy(study("up-and-flat", [0, 1, 2, 3, 4])), false);

  const forged = structuredClone(mixed);
  forged.statistics.q1Return = 999;
  assert.equal(isPublishableStudy(forged), false);

  const duplicate = structuredClone(mixed);
  duplicate.cases[1].date = duplicate.cases[0].date;
  assert.equal(isPublishableStudy(duplicate), false);

  const invalidCase = structuredClone(mixed);
  invalidCase.cases[0].returnPercent = Number.NaN;
  assert.equal(isPublishableStudy(invalidCase), false);
});

test("同檔多個當期精確組態只按證據品質、樣本數與 orb 擇優", () => {
  const tightButSmall = study("tight-small", [-1, 2]);
  const supportedFive = study("supported-five", [-4, -1, 0, 2, 5]);
  const supportedEight = study("supported-eight", [-8, -3, -1, 0, 2, 4, 6, 9]);

  assert.equal(selectBestExactActiveStudy([
    { study: tightButSmall, orb: 0.05 },
    { study: supportedFive, orb: 1.2 },
    { study: supportedEight, orb: 2.4 },
  ])?.signature, "supported-eight");

  const sameSizeWider = study("same-size-wider", [-9, -2, 0, 3, 12]);
  assert.equal(selectBestExactActiveStudy([
    { study: sameSizeWider, orb: 1.4 },
    { study: supportedFive, orb: 0.8 },
  ])?.signature, "supported-five");
});
