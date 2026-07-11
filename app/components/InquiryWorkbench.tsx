"use client";

import { APP_BASE_PATH } from "@/lib/app-config";
import type {
  InquiryAnchorKey,
  InquiryHorizon,
  InquiryIntent,
  InquiryPayload,
  SavedInquiry,
} from "@/lib/inquiry-types";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const STORAGE_KEY = "panshi:inquiries:v1";

const INTENT_LABELS: Record<InquiryIntent, string> = {
  consider_buy: "考慮買進",
  consider_sell: "已持有，考慮賣出",
  observe: "只想觀察",
};

const HORIZONS: InquiryHorizon[] = [5, 20, 60];

const dateFormatter = new Intl.DateTimeFormat("zh-TW", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dateTimeFormatter = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function parseDate(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

function formatDate(date: string | null) {
  return date ? dateFormatter.format(parseDate(date)) : "尚無資料";
}

function formatDateTime(date: string) {
  return dateTimeFormatter.format(new Date(date));
}

function formatPercent(value: number | null) {
  if (value === null) return "樣本不足";
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("zh-TW", {
    minimumFractionDigits: value >= 100 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function taipeiToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

function nextWeekday(date: string) {
  let candidate = shiftDate(date, 1);
  while ([0, 6].includes(new Date(`${candidate}T00:00:00Z`).getUTCDay())) {
    candidate = shiftDate(candidate, 1);
  }
  return candidate;
}

function suggestedReviewDate(date: string, horizon: InquiryHorizon) {
  return shiftDate(date, Math.ceil((horizon * 7) / 5) + 2);
}

function configurationReading(payload: InquiryPayload) {
  const primary = payload.symbolic.primary;
  if (!primary) {
    return {
      title: "這一天沒有主要相位",
      body: "3° 門檻內沒有接近精確的主要相位。這次不擴大門檻，也不勉強把普通日說成訊號。",
    };
  }
  const subject = {
    Mars: "動能、競爭與短期波動",
    Jupiter: "擴張、資源與市場想像",
    Saturn: "結構、限制與長期責任",
  }[primary.transitBody] || "外在節奏";
  const relation = {
    flow: "關係較順，但不代表價格上漲",
    focus: "同一主題被集中放大，但不指定方向",
    tension: "調整與摩擦主題較強，但不等於價格下跌",
  }[primary.tone];
  return {
    title: `${primary.transitBodyZh}${primary.aspectZh}本命${primary.natalBodyZh}`,
    body: `${subject}與公司的${primary.natalBodyZh}主題形成主要相位。符號上，${relation}。`,
  };
}

function isSavedInquiry(value: unknown): value is SavedInquiry {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedInquiry>;
  return typeof item.id === "string" &&
    typeof item.savedAt === "string" &&
    typeof item.targetDate === "string" &&
    typeof item.intent === "string" &&
    typeof item.horizon === "number" &&
    Boolean(item.company && typeof item.company.symbol === "string");
}

function readSavedInquiries() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter(isSavedInquiry).slice(0, 50) : [];
  } catch {
    return [];
  }
}

function writeSavedInquiries(items: SavedInquiry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50)));
}

function observationStatus(payload: InquiryPayload) {
  if (!payload.symbolic.primary) return "目標日無主要相位";
  const study = payload.evidence.study;
  if (!study || study.status !== "descriptive-only") return "樣本不足";
  return `僅供描述，${study.statistics.sampleSize} 筆`;
}

function EvidenceCases({ payload }: { payload: InquiryPayload }) {
  const study = payload.evidence.study;
  if (!study?.cases.length) return null;
  return (
    <details className="inquiry-cases">
      <summary>查看全部 {study.cases.length} 筆案例</summary>
      <div className="inquiry-case-list">
        {study.cases.map((item) => (
          <article key={`${item.date}-${item.endDate}`}>
            <div>
              <time dateTime={item.date}>{formatDate(item.date)}</time>
              <span>至 {formatDate(item.endDate)}</span>
            </div>
            <dl>
              <div><dt>起始收盤</dt><dd>NT$ {formatPrice(item.startClose)}</dd></div>
              <div><dt>期末收盤</dt><dd>NT$ {formatPrice(item.endClose)}</dd></div>
              <div><dt>區間收盤價變動</dt><dd>{formatPercent(item.returnPercent)}</dd></div>
              <div><dt>期間最低偏離</dt><dd>{formatPercent(item.maxAdverseMove)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </details>
  );
}

function SavedInquiryHistory({
  items,
  onRestore,
  onReview,
  onDelete,
}: {
  items: SavedInquiry[];
  onRestore: (item: SavedInquiry) => void;
  onReview: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <details className="inquiry-history">
      <summary>查看這家公司過往記錄{items.length ? `（${items.length}）` : ""}</summary>
      {items.length ? (
        <div>
          {items.map((item) => (
            <article key={item.id}>
              <header>
                <b>{item.company.symbol} {item.company.shortName}</b>
                <time dateTime={item.savedAt}>{formatDate(item.savedAt.slice(0, 10))}</time>
              </header>
              <p>{formatDate(item.targetDate)}，{INTENT_LABELS[item.intent]}，歷史對照 {item.horizon} 個交易日</p>
              <dl>
                <div><dt>當時狀態</dt><dd>{item.observationStatus}</dd></div>
                <div><dt>資料截至</dt><dd>{formatDate(item.dataAsOf)}</dd></div>
                <div><dt>回看日期</dt><dd>{formatDate(item.reviewDate)}</dd></div>
              </dl>
              <div className="inquiry-history-notes">
                <p><b>當時理由</b>{item.reason || "未留下理由"}</p>
                <p><b>改變看法的條件</b>{item.disconfirmingEvidence || "未留下條件"}</p>
              </div>
              <div className="inquiry-history-actions">
                <button type="button" onClick={() => onRestore(item)}>沿用情境</button>
                <button type="button" disabled={Boolean(item.reviewedAt)} onClick={() => onReview(item.id)}>
                  {item.reviewedAt ? "已回看" : "標為已回看"}
                </button>
                <button type="button" onClick={() => onDelete(item.id)}>刪除</button>
              </div>
            </article>
          ))}
          <p className="inquiry-history-boundary">保存的是問盤摘要與你的文字，不含完整歷史案例。清除網站資料也會刪除這些記錄。</p>
        </div>
      ) : <p>還沒有記錄。完成上方三個欄位後，就能留下第一筆。</p>}
    </details>
  );
}

export function InquiryWorkbench({
  symbol,
  anchorKey,
  anchorLabel,
  anchorDate,
  anchorPrecisionLabel,
  onJournalDirtyChange,
}: {
  symbol: string;
  anchorKey: InquiryAnchorKey;
  anchorLabel: string;
  anchorDate: string;
  anchorPrecisionLabel: string;
  onJournalDirtyChange: (dirty: boolean) => void;
}) {
  const [dateBounds] = useState(() => {
    const today = taipeiToday();
    return {
      minimum: today,
      maximum: shiftDate(today, 366),
      initial: nextWeekday(today),
    };
  });
  const [targetDate, setTargetDate] = useState(dateBounds.initial);
  const [intent, setIntent] = useState<InquiryIntent>("observe");
  const [horizon, setHorizon] = useState<InquiryHorizon>(20);
  const [submitted, setSubmitted] = useState<{
    targetDate: string;
    intent: InquiryIntent;
    horizon: InquiryHorizon;
  } | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [result, setResult] = useState<InquiryPayload | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [disconfirmingEvidence, setDisconfirmingEvidence] = useState("");
  const [reviewDate, setReviewDate] = useState("");
  const [saved, setSaved] = useState<SavedInquiry[]>([]);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [journalSaved, setJournalSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => setSaved(readSavedInquiries()), 0);
    return () => {
      window.clearTimeout(loadTimer);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (status === "ready") resultRef.current?.focus();
  }, [status]);

  const reading = useMemo(() => result ? configurationReading(result) : null, [result]);
  const study = result?.evidence.study || null;
  const hasUnsavedJournal = !journalSaved && Boolean(
    reason.trim() || disconfirmingEvidence.trim(),
  );
  const contextSaved = useMemo(
    () => saved.filter((item) => item.company.symbol === symbol && item.anchor === anchorKey),
    [saved, symbol, anchorKey],
  );

  useEffect(() => {
    onJournalDirtyChange(hasUnsavedJournal);
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedJournal) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => {
      window.removeEventListener("beforeunload", protectDraft);
      onJournalDirtyChange(false);
    };
  }, [hasUnsavedJournal, onJournalDirtyChange]);

  const confirmJournalDiscard = () => !hasUnsavedJournal || window.confirm(
    "這份決策記錄尚未儲存。繼續會清空目前文字，要繼續嗎？",
  );

  const submitInquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!targetDate) {
      setError("請先選擇目標日期。");
      setStatus("error");
      return;
    }
    if (result && !confirmJournalDiscard()) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const draft = { targetDate, intent, horizon };
    setSubmitted(draft);
    setStatus("loading");
    setError("");
    setResult(null);
    setSaveFeedback("");

    try {
      const params = new URLSearchParams({
        symbol,
        date: targetDate,
        anchor: anchorKey,
        horizon: String(horizon),
      });
      const response = await fetch(`${APP_BASE_PATH}/api/inquiry?${params.toString()}`, {
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null) as InquiryPayload | { error?: string } | null;
      if (!response.ok || !data || !("question" in data)) {
        throw new Error((data && "error" in data && data.error) || "問盤資料暫時無法取得");
      }
      setResult(data);
      setReason("");
      setDisconfirmingEvidence("");
      setReviewDate(suggestedReviewDate(data.tradingSession.effectiveDate, horizon));
      setJournalSaved(false);
      setStatus("ready");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "問盤資料暫時無法取得");
      setStatus("error");
    }
  };

  const saveInquiry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!result || !submitted) return;
    if (
      saved.length >= 50 &&
      !window.confirm("本機記錄已達 50 筆。要刪除最舊一筆並保存這次問盤嗎？")
    ) return;
    const record: SavedInquiry = {
      id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${symbol}`,
      savedAt: new Date().toISOString(),
      company: result.company,
      anchor: anchorKey,
      targetDate: submitted.targetDate,
      effectiveDate: result.tradingSession.effectiveDate,
      intent: submitted.intent,
      horizon: submitted.horizon,
      observationStatus: observationStatus(result),
      dataAsOf: result.evidence.coverage.to,
      reason: reason.trim(),
      disconfirmingEvidence: disconfirmingEvidence.trim(),
      reviewDate,
      reviewedAt: null,
    };
    const next = [record, ...saved].slice(0, 50);
    try {
      writeSavedInquiries(next);
      setSaved(next);
      setJournalSaved(true);
      setSaveFeedback("這次問盤已記下，回看時會保留當時的資料日期。");
    } catch {
      setSaveFeedback("瀏覽器沒有開放本機儲存。你仍可手動留下這次筆記。");
    }
  };

  const persistSaved = (next: SavedInquiry[], feedback: string) => {
    try {
      writeSavedInquiries(next);
      setSaved(next);
      setSaveFeedback(feedback);
    } catch {
      setSaveFeedback("本機記錄沒有更新。請確認瀏覽器是否開放網站儲存。");
    }
  };

  const restoreInquiry = (item: SavedInquiry) => {
    if (!confirmJournalDiscard()) return;
    if (item.company.symbol !== symbol || item.anchor !== anchorKey) {
      setSaveFeedback("這筆記錄使用不同公司或命盤基準，請先切換到相同設定。");
      return;
    }
    const nextDate = nextWeekday(taipeiToday());
    setTargetDate(nextDate);
    setIntent(item.intent);
    setHorizon(item.horizon);
    setSubmitted(null);
    setResult(null);
    setStatus("idle");
    setError("");
    setReason("");
    setDisconfirmingEvidence("");
    setReviewDate("");
    setJournalSaved(false);
    setSaveFeedback(`已沿用情境與歷史對照期。目標日改為 ${formatDate(nextDate)}，請確認後重新問盤。`);
    window.requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>("#inquiry-target-date");
      input?.scrollIntoView({ block: "center" });
      input?.focus();
    });
  };

  const markInquiryReviewed = (id: string) => {
    const next = saved.map((item) => item.id === id
      ? { ...item, reviewedAt: new Date().toISOString() }
      : item);
    persistSaved(next, "已標為回看完成。");
  };

  const deleteInquiry = (id: string) => {
    if (!window.confirm("刪除這筆本機問盤記錄？此動作無法復原。")) return;
    persistSaved(saved.filter((item) => item.id !== id), "這筆本機記錄已刪除。");
  };

  return (
    <section className="inquiry-workbench" id="inquiry" aria-labelledby="inquiry-title">
      <div className="inquiry-intro">
        <div className="inquiry-seal" aria-hidden="true"><span>問</span></div>
        <div>
          <span className="inquiry-label">問盤</span>
          <h3 id="inquiry-title">問一個有日期的問題</h3>
          <p>盤勢不告訴你該買什麼。它把象徵、歷史證據與資料缺口拆開，列出做決定前仍需核對的資料與反例。</p>
          <p className="inquiry-anchor-context"><b>目前命盤基準</b>{anchorLabel}，{formatDate(anchorDate)}，{anchorPrecisionLabel}</p>
        </div>
      </div>

      <form className="inquiry-form" onSubmit={submitInquiry}>
        <div className="inquiry-date-field">
          <label htmlFor="inquiry-target-date">目標日期</label>
          <input
            id="inquiry-target-date"
            type="date"
            value={targetDate}
            min={dateBounds.minimum}
            max={dateBounds.maximum}
            required
            onChange={(event) => setTargetDate(event.target.value)}
          />
          <small>若遇休市，結果會明示並順延到下一個可確認或推定的交易日。</small>
        </div>

        <fieldset className="inquiry-choice-field inquiry-choice-field--intent">
          <legend>你現在的情境</legend>
          <small>情境只會寫進記錄，不會改變證據計算。</small>
          <div>
            {(Object.keys(INTENT_LABELS) as InquiryIntent[]).map((key) => (
              <label key={key}>
                <input
                  type="radio"
                  name="inquiry-intent"
                  value={key}
                  checked={intent === key}
                  onChange={() => setIntent(key)}
                />
                <span>{INTENT_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="inquiry-choice-field inquiry-choice-field--horizon">
          <legend>歷史對照期</legend>
          <small>比較過去同組態在 5、20 或 60 個交易日後的收盤價變動。</small>
          <div>
            {HORIZONS.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="inquiry-horizon"
                  value={value}
                  checked={horizon === value}
                  onChange={() => setHorizon(value)}
                />
                <span><b>{value}</b> 個交易日</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="inquiry-submit">
          <button type="submit" disabled={status === "loading"}>
            {status === "loading" ? "正在整理證據" : "開始問盤"}
            <span aria-hidden="true">↗</span>
          </button>
          <small>不產生買賣、目標價或部位建議。</small>
        </div>
      </form>

      <div className="inquiry-live" aria-live="polite">
        {status === "loading" ? (
          <div className="inquiry-loading" aria-busy="true">
            <span className="inquiry-loading-mark" aria-hidden="true">◎</span>
            <div><b>正在對齊交易日與同組態歷史</b><p>最長拉回七年資料，通常需要幾秒。</p></div>
          </div>
        ) : null}
        {status === "error" && error ? (
          <div className="inquiry-error" role="alert">
            <div><b>這次問盤沒有完成</b><p>{error}</p></div>
            <button type="button" onClick={() => setStatus("idle")}>回到設定</button>
          </div>
        ) : null}
      </div>

      {status !== "ready" && saveFeedback ? (
        <p className="inquiry-general-feedback" role="status">{saveFeedback}</p>
      ) : null}

      {status !== "ready" && contextSaved.length ? (
        <div className="inquiry-idle-history">
          <SavedInquiryHistory
            items={contextSaved}
            onRestore={restoreInquiry}
            onReview={markInquiryReviewed}
            onDelete={deleteInquiry}
          />
        </div>
      ) : null}

      {status === "ready" && result && submitted && reading ? (
        <div className="inquiry-result" role="region" aria-labelledby="inquiry-result-title">
          <header className="inquiry-result-header">
            <div>
              <span>問盤結果</span>
              <h3 id="inquiry-result-title" ref={resultRef} tabIndex={-1}>{result.company.symbol} {result.company.shortName}</h3>
              <small>命盤基準：{anchorLabel}，{formatDate(anchorDate)}</small>
              <small>結果產生：{formatDateTime(result.sources.generatedAt)}</small>
            </div>
            <dl>
              <div><dt>目標日</dt><dd>{formatDate(submitted.targetDate)}</dd></div>
              <div><dt>情境</dt><dd>{INTENT_LABELS[submitted.intent]}</dd></div>
              <div><dt>歷史對照期</dt><dd>{submitted.horizon} 個交易日</dd></div>
            </dl>
            <strong className={`inquiry-observation inquiry-observation--${study?.status || "no-aspect"}`}>
              觀測狀態：{observationStatus(result)}
            </strong>
          </header>

          <div className={`trading-date-note${result.tradingSession.adjusted ? " is-adjusted" : ""}`}>
            <b>{result.tradingSession.adjusted ? "已校正觀測日" : "交易日核對"}</b>
            <p>
              {result.tradingSession.adjusted
                ? `你選的 ${formatDate(result.tradingSession.requestedDate)} 不是交易日。${result.tradingSession.reason}，本次改看 ${formatDate(result.tradingSession.effectiveDate)}。${result.tradingSession.calendarBasis === "official" ? "" : " 本次只依平日規則推定，尚未取得官方日曆確認。"}`
                : result.tradingSession.calendarBasis === "official"
                  ? `依證交所已公告日曆，${formatDate(result.tradingSession.effectiveDate)} 預計開市。當日仍需重查臨時休市。`
                  : `${formatDate(result.tradingSession.effectiveDate)} 目前只依平日規則推定，尚未取得官方日曆確認。`}
            </p>
          </div>

          <div className="inquiry-result-layout">
            <div className="inquiry-ledger">
              <section className="inquiry-layer inquiry-layer--symbolic" aria-labelledby="inquiry-symbolic-title">
                <span className="inquiry-layer-mark" aria-hidden="true">象</span>
                <div>
                  <header><span>時間質地</span><h4 id="inquiry-symbolic-title">{reading.title}</h4></header>
                  {result.symbolic.primary ? (
                    <div className="inquiry-symbolic-reading">
                      <strong aria-hidden="true">
                        {result.symbolic.primary.transitGlyph}
                        {result.symbolic.primary.aspectGlyph}
                        {result.symbolic.primary.natalGlyph}
                      </strong>
                      <div><p>{reading.body}</p><small>容許度 {result.symbolic.primary.orb.toFixed(2)}°，只描述結構，不判斷價格方向。</small></div>
                    </div>
                  ) : <p>{reading.body}</p>}
                  {result.symbolic.configurations.length > 1 ? (
                    <details className="inquiry-nearby-configurations">
                      <summary>查看另外 {result.symbolic.configurations.length - 1} 組主要相位</summary>
                      <ul>
                        {result.symbolic.configurations.slice(1).map((item) => (
                          <li key={item.id}>
                            <span aria-hidden="true">{item.transitGlyph}{item.aspectGlyph}{item.natalGlyph}</span>
                            <b>{item.transitBodyZh}{item.aspectZh}本命{item.natalBodyZh}</b>
                            <small>{item.orb.toFixed(2)}°</small>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              </section>

              <section className="inquiry-layer inquiry-layer--evidence" aria-labelledby="inquiry-evidence-title">
                <span className="inquiry-layer-mark" aria-hidden="true">證</span>
                <div>
                  <header><span>同組態研究</span><h4 id="inquiry-evidence-title">過去實際走成什麼樣子</h4></header>
                  {study ? (
                    <>
                      <p className="inquiry-study-definition">
                        目標日以 3° 初篩；歷史只比對「{study.configurationLabel}」在 1.25° 內的同組態窗口。每段連續窗口只取容許度最小的交易日，再向後看 {study.horizon} 個交易日。
                      </p>
                      <p className="inquiry-price-basis">價格是未還原收盤價。以下只描述收盤價變動，不含現金股利，除權息可能造成失真。</p>
                      <div className="inquiry-evidence-stats">
                        <div><span>完整樣本</span><strong>{study.statistics.sampleSize}</strong><small>筆</small></div>
                        <div><span>收盤價變動中位數</span><strong>{formatPercent(study.statistics.medianReturn)}</strong></div>
                        <div><span>中間 50% 範圍</span><strong>{study.statistics.q1Return === null ? "樣本不足" : `${formatPercent(study.statistics.q1Return)} 至 ${formatPercent(study.statistics.q3Return)}`}</strong></div>
                        <div><span>正變動案例</span><strong>{study.statistics.positiveCount} / {study.statistics.sampleSize}</strong></div>
                        <div><span>期間最低偏離中位數</span><strong>{formatPercent(study.statistics.medianAdverseMove)}</strong></div>
                        <div><span>最深期間最低偏離</span><strong>{formatPercent(study.statistics.worstAdverseMove)}</strong></div>
                      </div>
                      {study.status !== "descriptive-only" ? (
                        <div className="sample-boundary">
                          <b>樣本不足</b>
                          <p>少於 {study.minimumDescriptiveSample} 筆，不做方向歸納。現有案例仍列出，供你檢查差異與反例。</p>
                        </div>
                      ) : (
                        <div className="sample-boundary sample-boundary--descriptive">
                          <b>僅供描述</b>
                          <p>樣本達到介面顯示門檻，但不代表統計有效，也不代表這次會重演。</p>
                        </div>
                      )}
                      <EvidenceCases payload={result} />
                    </>
                  ) : (
                    <div className="inquiry-empty-evidence">
                      <b>這次沒有可比的精確組態</b>
                      <p>目標日不在 3° 內的主要相位窗口，所以不擴大門檻拼湊案例。</p>
                    </div>
                  )}
                  <p className="inquiry-coverage">
                    歷史涵蓋 {formatDate(result.evidence.coverage.from)} 至 {formatDate(result.evidence.coverage.to)}，共 {result.evidence.coverage.sessions} 個交易日。成功取得 {result.evidence.coverage.receivedMonths} / {result.evidence.coverage.requestedMonths} 個月份。
                    {result.evidence.coverage.complete ? "" : ` 缺少 ${result.evidence.coverage.missingMonths.length} 個月份，跨缺口案例已排除。`}
                  </p>
                </div>
              </section>

              <section className="inquiry-layer inquiry-layer--events" aria-labelledby="inquiry-events-title">
                <span className="inquiry-layer-mark" aria-hidden="true">事</span>
                <div>
                  <header><span>事件核對</span><h4 id="inquiry-events-title">別讓日期遮住真正的消息</h4></header>
                  {result.events.items.length ? (
                    <div className="inquiry-event-items">
                      {result.events.items.map((item, index) => (
                        <article key={`${item.date}-${item.category}-${index}`}>
                          <time dateTime={item.date}>{formatDate(item.date)}</time>
                          <b>{item.category}</b>
                          <p>{item.title}</p>
                        </article>
                      ))}
                    </div>
                  ) : null}
                  <div className="inquiry-checks">
                    {result.events.checks.map((check) => (
                      <div key={check.label} data-state={check.state}>
                        <b>{check.label}</b><p>{check.detail}</p>
                      </div>
                    ))}
                  </div>
                  <p className="inquiry-source-links">
                    <a href={result.sources.events} target="_blank" rel="noreferrer">公司事件來源 ↗</a>
                    <a href={result.sources.calendar} target="_blank" rel="noreferrer">開休市來源 ↗</a>
                  </p>
                  <small className="inquiry-event-freshness">{result.events.freshnessNote}</small>
                </div>
              </section>

              <section className="inquiry-layer inquiry-layer--boundaries" aria-labelledby="inquiry-boundaries-title">
                <span className="inquiry-layer-mark" aria-hidden="true">界</span>
                <div>
                  <header><span>資料界線</span><h4 id="inquiry-boundaries-title">這次不能回答什麼</h4></header>
                  <ul>
                    <li>{result.boundaries.chartPrecision}</li>
                    {result.boundaries.statements.map((statement) => <li key={statement}>{statement}</li>)}
                  </ul>
                  <p>這份結果不構成投資建議，也不提供買賣、目標價、停損或部位結論。</p>
                </div>
              </section>
            </div>

            <aside className="inquiry-journal" aria-labelledby="inquiry-journal-title">
              <div className="inquiry-journal-heading">
                <span className="inquiry-layer-mark" aria-hidden="true">記</span>
                <div><span>決策記錄</span><h4 id="inquiry-journal-title">把現在的理由留給未來的你</h4></div>
              </div>
              <form onSubmit={saveInquiry}>
                <label htmlFor="inquiry-reason">我為什麼想採取這個動作？</label>
                <textarea
                  id="inquiry-reason"
                  value={reason}
                  required
                  rows={4}
                  placeholder="寫下可被驗證的理由，不只是一種感覺。"
                  onChange={(event) => {
                    setReason(event.target.value);
                    setJournalSaved(false);
                  }}
                />
                <label htmlFor="inquiry-disconfirming">哪個事實出現時，我會改變看法？</label>
                <textarea
                  id="inquiry-disconfirming"
                  value={disconfirmingEvidence}
                  required
                  rows={4}
                  placeholder="例如營收、法說內容或價格條件。"
                  onChange={(event) => {
                    setDisconfirmingEvidence(event.target.value);
                    setJournalSaved(false);
                  }}
                />
                <label htmlFor="inquiry-review-date">回看日期</label>
                <input
                  id="inquiry-review-date"
                  type="date"
                  value={reviewDate}
                  min={result.tradingSession.effectiveDate}
                  required
                  onChange={(event) => {
                    setReviewDate(event.target.value);
                    setJournalSaved(false);
                  }}
                />
                <small className="inquiry-review-note">建議日依日曆天粗估，只記錄日期，不會發送提醒。</small>
                <button type="submit">記下這次問盤</button>
                <small className="inquiry-local-note">記錄只存於這個瀏覽器，不會上傳。保存摘要與你的文字，最多 50 筆。</small>
                <p className="inquiry-save-feedback" role="status">{saveFeedback}</p>
              </form>

              <SavedInquiryHistory
                items={contextSaved}
                onRestore={restoreInquiry}
                onReview={markInquiryReviewed}
                onDelete={deleteInquiry}
              />
            </aside>
          </div>
        </div>
      ) : null}
    </section>
  );
}
