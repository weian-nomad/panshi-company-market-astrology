import {
  buildConfigurationLine,
  buildCoverageLine,
  buildHistoryLine,
  buildHook,
  buildMarketLine,
  buildNarrationLine,
} from "@/studio/script";
import { isEligibleForCategory, signatureForCandidate } from "@/studio/selection";
import {
  hasCompleteDescriptiveStatistics,
  hasConsistentStudyStatistics,
  isPublishableStudy,
  studyDirectionCounts,
} from "@/studio/study-quality";
import {
  EDITORIAL_CATEGORIES,
  EDITORIAL_CATEGORY_LABELS,
  type ContentValidationIssue,
  type ContentValidationOptions,
  type ContentValidationResult,
  type DailyContentPackage,
  type DailyStockFacts,
} from "@/studio/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLAIM_NUMBER = /[+-]?\d+(?:\.\d+)?/g;
const BANNED_ACTIONABLE_TERMS = [
  "必買",
  "必賣",
  "必漲",
  "必跌",
  "買進",
  "買入",
  "賣出",
  "該買",
  "該賣",
  "可以買",
  "可以賣",
  "應該買",
  "應該賣",
  "建議買",
  "建議賣",
  "加碼",
  "減碼",
  "做多",
  "做空",
  "進場",
  "出場",
  "持有",
  "停損",
  "止損",
  "停利",
  "目標價",
  "上看",
  "下看",
  "買點",
  "賣點",
  "看多",
  "看空",
  "推薦",
  "值得買",
  "逢低",
  "追價",
  "佈局",
  "布局",
  "抄底",
  "勝率",
  "準確率",
  "高機率",
  "上漲機率",
  "下跌機率",
  "預測",
  "保證",
  "獲利",
  "精準預測",
  "命定漲跌",
  "保證獲利",
  "財富密碼",
] as const;

function issue(code: string, path: string, message: string): ContentValidationIssue {
  return { code, path, message };
}

function isRealIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function taipeiCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function visibleScriptStrings(content: DailyContentPackage) {
  const script = content.script;
  return [
    script.title,
    script.host.name,
    script.hostDisclosure,
    script.hook,
    script.priceBasisLine,
    ...script.segments.flatMap((segment) => [
      segment.categoryLabel,
      segment.marketLine,
      segment.configurationLine,
      segment.historyLine,
      segment.coverageLine,
      segment.narration,
    ]),
    script.boundaryLine,
    script.ctaLine,
    script.fullNarration,
    script.caption,
    ...script.hashtags,
  ];
}

function addDateNumbers(allowed: Set<string>, value: string | null) {
  if (!value || !ISO_DATE.test(value)) return;
  value.split("-").forEach((part) => allowed.add(String(Number(part))));
}

function addEmbeddedNumbers(allowed: Set<string>, value: string) {
  (value.match(CLAIM_NUMBER) ?? []).forEach((part) => allowed.add(canonicalNumber(part)));
}

function canonicalNumber(value: number | string) {
  const numeric = typeof value === "number" ? value : Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) ? String(numeric) : "";
}

function addNumber(allowed: Set<string>, value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  allowed.add(canonicalNumber(value));
}

/**
 * Add only the representation a script formatter can actually emit for a
 * specific fact. This keeps the claim check fail-closed while allowing an
 * evidenced value such as 9.25% to be presented as +9.3%.
 */
function addPresentedNumber(
  allowed: Set<string>,
  value: number | null | undefined,
  fractionDigits: number,
) {
  if (value === null || value === undefined || !Number.isFinite(value)) return;
  allowed.add(canonicalNumber(value.toFixed(fractionDigits)));
}

function supportedNumbers(content: DailyContentPackage) {
  const allowed = new Set<string>();
  [1, 3, 5, 20].forEach((value) => addNumber(allowed, value));
  addDateNumbers(allowed, content.selection.date);

  for (const item of content.selection.items) {
    const facts = item.facts;
    addEmbeddedNumbers(allowed, facts.symbol);
    addEmbeddedNumbers(allowed, facts.shortName);
    addDateNumbers(allowed, facts.date);
    addDateNumbers(allowed, facts.session.date);
    addNumber(allowed, facts.session.close);
    addPresentedNumber(allowed, facts.session.close, 2);
    addNumber(allowed, facts.session.dailyChangePercent);
    addPresentedNumber(allowed, facts.session.dailyChangePercent, 1);
    addNumber(allowed, facts.session.volumeRatio20SessionMedian);
    addPresentedNumber(allowed, facts.session.volumeRatio20SessionMedian, 1);
    addNumber(allowed, facts.transits.length);
    facts.transits.forEach((transit) => {
      addDateNumbers(allowed, transit.date);
      addNumber(allowed, transit.orb);
      addPresentedNumber(allowed, transit.orb, 2);
    });

    const coverage = facts.coverage;
    addNumber(allowed, coverage.requestedMonths);
    addNumber(allowed, coverage.receivedMonths);
    addNumber(allowed, coverage.sessions);
    addNumber(allowed, coverage.missingMonths.length);
    addDateNumbers(allowed, coverage.from);
    addDateNumbers(allowed, coverage.to);

    const study = facts.study;
    if (!study) continue;
    addNumber(allowed, study.horizon);
    addNumber(allowed, study.minimumDescriptiveSample);
    Object.values(study.statistics).forEach((value) => addNumber(allowed, value));
    addNumber(allowed, studyDirectionCounts(study).negative);
    [
      study.statistics.medianReturn,
      study.statistics.q1Return,
      study.statistics.q3Return,
      study.statistics.medianAdverseMove,
      study.statistics.worstAdverseMove,
    ].forEach((value) => addPresentedNumber(allowed, value, 1));
    if (study.statistics.q1Return !== null && study.statistics.q3Return !== null) {
      addNumber(allowed, Number((study.statistics.q3Return - study.statistics.q1Return).toFixed(1)));
    }
    study.cases.forEach((sample) => {
      addDateNumbers(allowed, sample.date);
      addDateNumbers(allowed, sample.endDate);
      addNumber(allowed, sample.startClose);
      addNumber(allowed, sample.endClose);
      addNumber(allowed, sample.returnPercent);
      addNumber(allowed, sample.maxAdverseMove);
      addNumber(allowed, sample.orb);
    });
  }
  return allowed;
}

function validateNumericClaims(content: DailyContentPackage, errors: ContentValidationIssue[]) {
  const allowed = supportedNumbers(content);
  const copy = visibleScriptStrings(content)
    .join("\n")
    .replace(/https?:\/\/\S+/g, "");
  const tokens = copy.match(CLAIM_NUMBER) ?? [];
  const unsupported = [...new Set(tokens.filter((token) => !allowed.has(canonicalNumber(token))))];
  if (unsupported.length) {
    errors.push(issue(
      "unsupported-number",
      "script",
      `文案出現事實輸入沒有的數字：${unsupported.join("、")}。`,
    ));
  }
}

function validateStudy(facts: DailyStockFacts, index: number, errors: ContentValidationIssue[]) {
  const path = `selection.items[${index}].facts.study`;
  const study = facts.study;
  if (!study) {
    errors.push(issue("missing-study", path, "今日五盤每檔都必須附上同組態事件研究。"));
    return;
  }
  if (!facts.transits.some((transit) => transit.signature === study.signature)) {
    errors.push(issue("study-signature-mismatch", path, "歷史對照簽章與當日相位不一致。"));
  }
  const stats = study.statistics;
  if (stats.sampleSize !== study.cases.length) {
    errors.push(issue("sample-count-mismatch", path, "樣本數與案例數量不一致。"));
  }
  const positiveCount = study.cases.filter((sample) => sample.returnPercent > 0).length;
  const zeroCount = study.cases.filter((sample) => sample.returnPercent === 0).length;
  if (stats.positiveCount !== positiveCount || stats.zeroCount !== zeroCount) {
    errors.push(issue("sample-direction-mismatch", path, "正變動或零變動筆數與案例不一致。"));
  }
  const expectedStatus = stats.sampleSize === 0
    ? "no-sample"
    : stats.sampleSize < study.minimumDescriptiveSample
      ? "insufficient-sample"
      : "descriptive-only";
  if (study.status !== expectedStatus) {
    errors.push(issue("study-status-mismatch", path, "樣本狀態與實際樣本數不一致。"));
  }
  if (study.status === "descriptive-only") {
    if (!hasCompleteDescriptiveStatistics(study)) {
      errors.push(issue("incomplete-descriptive-statistics", path, "達描述門檻時，中位數、四分位與不利變動不能缺值。"));
    }
  }
  if (!hasConsistentStudyStatistics(study)) {
    errors.push(issue("study-statistics-mismatch", path, "歷史案例與中位數、四分位或不利變動統計不一致。"));
  }
  if (study.status !== "descriptive-only" || stats.sampleSize < study.minimumDescriptiveSample) {
    errors.push(issue("insufficient-publishable-study", path, "每日影片只接受達描述門檻的歷史研究。"));
  } else {
    const directions = studyDirectionCounts(study);
    if (directions.positive === 0 || directions.negative === 0) {
      errors.push(issue("one-sided-publishable-study", path, "每日影片的歷史樣本必須同時包含上行與下行案例。"));
    }
    if (!isPublishableStudy(study)) {
      errors.push(issue("invalid-publishable-study", path, "每日影片的樣本、方向計數與描述統計必須完整一致。"));
    }
  }
  if (facts.coverage.from && facts.coverage.to) {
    const outOfRange = study.cases.some((sample) => (
      sample.date < (facts.coverage.from as string)
      || sample.endDate > (facts.coverage.to as string)
      || sample.endDate < sample.date
    ));
    if (outOfRange) errors.push(issue("case-outside-coverage", path, "歷史案例超出宣告的價格涵蓋範圍。"));
  }
}

function validateCoverage(facts: DailyStockFacts, index: number, errors: ContentValidationIssue[]) {
  const path = `selection.items[${index}].facts.coverage`;
  const coverage = facts.coverage;
  if (coverage.basis !== "raw-unadjusted-close") {
    errors.push(issue("wrong-price-basis", `${path}.basis`, "今日五盤只允許未還原收盤價基準。"));
  }
  if (
    coverage.requestedMonths <= 0
    || coverage.receivedMonths <= 0
    || coverage.receivedMonths > coverage.requestedMonths
    || coverage.sessions <= 0
  ) {
    errors.push(issue("invalid-coverage-counts", path, "歷史價格月數或交易日數不合理。"));
  }
  if (!coverage.from || !coverage.to || !isRealIsoDate(coverage.from) || !isRealIsoDate(coverage.to)) {
    errors.push(issue("invalid-coverage-dates", path, "歷史價格必須有明確的起訖日期。"));
  } else {
    if (coverage.from > coverage.to) errors.push(issue("reversed-coverage", path, "歷史價格起日不能晚於訖日。"));
    if (coverage.to !== facts.session.date) errors.push(issue("stale-coverage", path, "價格涵蓋訖日必須與本次收盤日一致。"));
  }
  if (coverage.complete && (
    coverage.missingMonths.length > 0
    || coverage.receivedMonths !== coverage.requestedMonths
  )) {
    errors.push(issue("false-complete-coverage", path, "涵蓋標示完整時，不能同時有缺月或少月。"));
  }
  if (!coverage.complete && coverage.missingMonths.length === 0) {
    errors.push(issue("undisclosed-coverage-gap", path, "涵蓋不完整時，必須列出缺口。"));
  }
}

function validateScriptStructure(content: DailyContentPackage, errors: ContentValidationIssue[]) {
  const { selection, script } = content;
  if (script.date !== selection.date) errors.push(issue("script-date-mismatch", "script.date", "腳本日期與選片日期不一致。"));
  if (script.series !== "今日五盤") errors.push(issue("wrong-series", "script.series", "每個交易日只發布一支「今日五盤」。"));
  if (script.contentClassification !== "財經文化研究") {
    errors.push(issue("wrong-content-classification", "script.contentClassification", "內容必須標示為財經文化研究。"));
  }
  if (!script.host.isAi || !/AI/i.test(script.hostDisclosure) || !script.hostDisclosure.includes("虛擬")) {
    errors.push(issue("missing-ai-disclosure", "script.hostDisclosure", "開場必須清楚說明主持人是 AI 虛擬角色。"));
  }
  if (!script.priceBasisLine.includes("未還原收盤價")) {
    errors.push(issue("missing-price-basis", "script.priceBasisLine", "腳本必須說明價格採未還原收盤價。"));
  }
  if (!script.boundaryLine.includes("不是投資建議") || !script.boundaryLine.includes("不提供買賣訊號")) {
    errors.push(issue("missing-investment-boundary", "script.boundaryLine", "結尾必須清楚說明非投資建議且不提供買賣訊號。"));
  }
  const expectedHook = buildHook(selection);
  if (script.hook !== expectedHook) {
    errors.push(issue("hook-fact-mismatch", "script.hook", "開場鉤子必須逐字對應本期選片與正確期間。"));
  }
  if (!script.fullNarration.includes(script.hook)) {
    errors.push(issue("missing-hook", "script.fullNarration", "完整旁白必須包含本期開場鉤子。"));
  }
  if (script.fullNarration.length >= 900) {
    errors.push(issue("voiceover-too-long", "script.fullNarration", "精簡口播必須少於 900 字元；完整涵蓋與統計保留在審稿欄位與貼文。"));
  }
  if (!/^https?:\/\//m.test(script.ctaLine.match(/https?:\/\/\S+/)?.[0] ?? "")) {
    errors.push(issue("missing-cta", "script.ctaLine", "行動文案必須導回完整研究頁。"));
  }
  for (const required of [script.hostDisclosure, script.priceBasisLine, script.boundaryLine, script.ctaLine]) {
    if (!script.fullNarration.includes(required)) {
      errors.push(issue("incomplete-full-narration", "script.fullNarration", "完整旁白缺少必要揭露或行動文案。"));
      break;
    }
  }
  for (const required of [script.hostDisclosure, script.priceBasisLine, script.boundaryLine, script.ctaLine]) {
    if (!script.caption.includes(required)) {
      errors.push(issue("incomplete-caption", "script.caption", "貼文說明缺少 AI、價格基準、風險邊界或完整頁連結。"));
      break;
    }
  }

  script.segments.forEach((segment, index) => {
    const item = selection.items[index];
    const path = `script.segments[${index}]`;
    if (!item || segment.symbol !== item.facts.symbol || segment.category !== item.category) {
      errors.push(issue("segment-selection-mismatch", path, "腳本段落與選片順序不一致。"));
      return;
    }
    if (segment.categoryLabel !== EDITORIAL_CATEGORY_LABELS[item.category]) {
      errors.push(issue("category-label-mismatch", `${path}.categoryLabel`, "分類名稱不正確。"));
    }
    const expectedLines = {
      marketLine: buildMarketLine(item),
      configurationLine: buildConfigurationLine(item),
      historyLine: buildHistoryLine(item.facts.study),
      coverageLine: buildCoverageLine(item),
    };
    for (const [key, expected] of Object.entries(expectedLines)) {
      if (segment[key as keyof typeof expectedLines] !== expected) {
        errors.push(issue("fact-copy-mismatch", `${path}.${key}`, "文案不符對應的行情、相位或歷史事實。"));
      }
    }
    if (segment.narration !== buildNarrationLine(item)) {
      errors.push(issue("fact-copy-mismatch", `${path}.narration`, "精簡口播不符對應的行情、相位或歷史事實。"));
    }
    if (!script.fullNarration.includes(segment.narration)) {
      errors.push(issue("missing-segment", "script.fullNarration", `完整旁白漏掉 ${segment.symbol} 段落。`));
    }
    if (!script.caption.includes(segment.coverageLine)) {
      errors.push(issue("missing-caption-coverage", "script.caption", `${segment.symbol} 的資料涵蓋沒有放入貼文說明。`));
    }
  });
}

export function validateDailyPackage(
  content: DailyContentPackage,
  options: ContentValidationOptions = {},
): ContentValidationResult {
  const errors: ContentValidationIssue[] = [];
  const expectedDate = options.expectedDate ?? taipeiCalendarDate(options.now);
  const { selection } = content;

  if (!isRealIsoDate(expectedDate)) errors.push(issue("invalid-expected-date", "options.expectedDate", "預期日期必須是真實的 YYYY-MM-DD。"));
  if (selection.date !== expectedDate) {
    errors.push(issue("not-current-date", "selection.date", `內容日期 ${selection.date} 不是本次交易日 ${expectedDate}。`));
  }
  if (selection.policy !== "neutral-editorial-salience") {
    errors.push(issue("non-neutral-policy", "selection.policy", "選片政策必須是中性編輯顯著性。"));
  }
  if (
    selection.evidencePolicy.studyMatch !== "exact-active-configuration"
    || selection.evidencePolicy.minimumSampleSize !== 5
    || selection.evidencePolicy.requiresUpAndDownCases !== true
    || selection.evidencePolicy.activeStudyPrecedence.join("|")
      !== "publishable-completeness|sample-size|orb|signature"
  ) {
    errors.push(issue("invalid-evidence-policy", "selection.evidencePolicy", "每日影片必須使用固定的精確組態擇優與雙向樣本門檻。"));
  }
  if (selection.items.length !== 5 || content.script.segments.length !== 5) {
    errors.push(issue("wrong-item-count", "selection.items", "每個交易日必須是一支、五檔的今日五盤。"));
  }

  const symbols = selection.items.map((item) => item.facts.symbol);
  if (new Set(symbols).size !== 5) errors.push(issue("duplicate-symbol", "selection.items", "五檔股票代號不得重複。"));
  const categories = selection.items.map((item) => item.category);
  if (
    new Set(categories).size !== 5
    || EDITORIAL_CATEGORIES.some((category) => !categories.includes(category))
  ) {
    errors.push(issue("duplicate-or-missing-category", "selection.items", "五檔必須分屬市場異動、量能異常、相位密集、歷史分歧與今昔反差。"));
  }

  selection.items.forEach((item, index) => {
    const path = `selection.items[${index}]`;
    const facts = item.facts;
    if (item.category !== EDITORIAL_CATEGORIES[index]) {
      errors.push(issue("category-order", `${path}.category`, "分類順序必須固定，才能維持可重現的影片結構。"));
    }
    if (facts.date !== expectedDate || facts.session.date !== expectedDate) {
      errors.push(issue("stale-stock-facts", `${path}.facts.date`, "標的與收盤事實必須屬於本次交易日。"));
    }
    if (facts.transits.some((transit) => transit.date !== expectedDate)) {
      errors.push(issue("stale-transit", `${path}.facts.transits`, "當期相位必須屬於本次交易日。"));
    }
    try {
      const appUrl = new URL(facts.appUrl);
      if (appUrl.protocol !== "https:" || appUrl.searchParams.get("symbol") !== facts.symbol) {
        throw new Error("invalid research URL");
      }
    } catch {
      errors.push(issue("invalid-research-url", `${path}.facts.appUrl`, "完整研究連結必須是對應股票的 HTTPS 網址。"));
    }
    if (!isEligibleForCategory(facts, item.category, expectedDate)) {
      errors.push(issue("category-fact-mismatch", path, "標的事實不符這個編輯分類。"));
    }
    validateCoverage(facts, index, errors);
    validateStudy(facts, index, errors);
  });

  const industries = new Set(selection.items.map((item) => item.facts.industry));
  const signatures = new Set(selection.items.map((item) => signatureForCandidate(item.facts)).filter(Boolean));
  if (industries.size < 3) errors.push(issue("insufficient-industry-variation", "selection.items", "五檔至少需要橫跨三種產業。"));
  if (signatures.size < 3) errors.push(issue("insufficient-signature-variation", "selection.items", "五檔至少需要三種不同的當期組態。"));

  validateScriptStructure(content, errors);

  const fullCopy = visibleScriptStrings(content).join("\n");
  const banned = BANNED_ACTIONABLE_TERMS.filter((term) => fullCopy.includes(term));
  if (banned.length) {
    errors.push(issue("actionable-language", "script", `文案含有方向性或招攬用語：${banned.join("、")}。`));
  }
  validateNumericClaims(content, errors);

  return { valid: errors.length === 0, errors };
}
