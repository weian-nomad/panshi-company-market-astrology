import type { Metadata } from "next";
import { cookies } from "next/headers";
import type { YouTubeVisibility } from "@/studio/config";
import { STUDIO_SESSION_COOKIE, verifySessionCookie } from "@/studio/auth";
import { listAudit, listEditions, type StoredEdition } from "@/studio/store";
import { getStudioWebConfig } from "@/studio/web-config";
import styles from "./studio.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "五盤錄監看台",
  robots: { index: false, follow: false, nocache: true },
};

const STATUS_COPY: Record<StoredEdition["status"], { label: string; detail: string }> = {
  drafting: { label: "生成中", detail: "資料、腳本或影音仍在處理。" },
  ready: { label: "待發布", detail: "成片與檢核已完成，等待自動工作程序接手。" },
  approved: { label: "待發布", detail: "舊版佇列已納入自動發布。" },
  uploading: { label: "上傳中", detail: "正在核對上傳進度；中斷時會從已確認的位置續傳。" },
  publish_retry: { label: "稍後續傳", detail: "本次未完成；重試時間到後會自動接續，達上限即停止。" },
  uploaded_private: { label: "已上傳", detail: "YouTube 實際回報為不公開或私人。" },
  scheduled: { label: "已公開", detail: "YouTube 實際回報為公開。" },
  quarantined: { label: "已隔離", detail: "這期不會進入發布佇列。" },
  failed: { label: "已停止", detail: "處理或發布已停止；成片與錯誤紀錄仍保留。" },
  skipped: { label: "本日略過", detail: "非交易日或資料未完成。" },
};

const VISIBILITY_COPY: Record<YouTubeVisibility, string> = {
  public: "公開",
  unlisted: "不公開",
  private: "私人",
};

type ManifestStock = {
  symbol?: string;
  companyName?: string;
  category?: string;
  industry?: string;
  currentConfiguration?: { label?: string; orb?: number };
  study?: {
    statistics?: {
      sampleSize?: number;
      positiveCount?: number;
      medianReturn?: number | null;
      q1Return?: number | null;
      q3Return?: number | null;
    };
  };
};

function manifestStocks(edition: StoredEdition) {
  const value = edition.manifest.stocks;
  return Array.isArray(value) ? (value as ManifestStock[]) : [];
}

function formatDateTime(value: string | null) {
  if (!value) return "尚未設定";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function SignIn({ configured }: { configured: boolean }) {
  return (
    <main className={styles.loginShell}>
      <section className={styles.loginPanel} aria-labelledby="studio-login-title">
        <p className={styles.kicker}>盤勢內容工作台</p>
        <h1 id="studio-login-title">監看今天的五盤錄</h1>
        <p>
          交易日成片會自動發布。這裡集中顯示五檔內容、影片狀態與執行紀錄，異常批次可直接隔離。
        </p>
        {configured ? (
          <form action="/api/studio/session" method="post" className={styles.loginForm}>
            <label htmlFor="studio-token">工作台密碼</label>
            <input
              id="studio-token"
              name="token"
              type="password"
              autoComplete="current-password"
              required
            />
            <button type="submit">進入監看台</button>
          </form>
        ) : (
          <p className={styles.blockingMessage} role="alert">
            監看台尚未設定密碼。請先在執行環境加入 STUDIO_REVIEW_TOKEN，再重新載入。
          </p>
        )}
      </section>
    </main>
  );
}

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; notice?: string }>;
}) {
  const config = getStudioWebConfig();
  const cookieStore = await cookies();
  const authorized = verifySessionCookie(cookieStore.get(STUDIO_SESSION_COOKIE)?.value);
  if (!authorized) return <SignIn configured={config.reviewTokenConfigured} />;

  const params = await searchParams;
  const editions = listEditions(30);
  const selected = editions.find((edition) => edition.tradeDate === params.date) || editions[0] || null;
  const stocks = selected ? manifestStocks(selected) : [];
  const audit = selected ? listAudit(selected.tradeDate).slice(0, 8) : [];
  const requestedVisibility = selected?.requestedVisibility
    ?? selected?.visibilityOverride
    ?? config.youtubeVisibility;
  const requestedVisibilitySource = selected?.requestedVisibility
    ? "上傳時設定"
    : selected?.visibilityOverride
      ? "本期設定"
      : "全域預設";
  const actualVisibility = selected?.actualVisibility ?? null;
  const canEditPublishingControls = Boolean(
    selected
      && (selected.status === "ready" || selected.status === "approved")
      && selected.publishAttempts === 0
      && !selected.youtubeVideoId
      && !selected.uploadSessionUrl,
  );

  return (
    <main className={styles.shell}>
      <a className="skip-link" href="#studio-edition">跳到本期內容</a>
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>盤勢內容工作台</p>
          <h1>五盤錄監看台</h1>
        </div>
        <div className={styles.headerMeta}>
          <span>自動發布：{config.autoPublish ? "運作中" : "已暫停"}・{VISIBILITY_COPY[config.youtubeVisibility]}</span>
          <form action="/api/studio/logout" method="post">
            <button className={styles.textButton} type="submit">離開監看台</button>
          </form>
        </div>
      </header>

      {params.notice === "quarantined" && (
        <p className={styles.notice} role="status">本期已隔離，不會進入發布佇列。</p>
      )}
      {params.notice === "settings-saved" && (
        <p className={styles.notice} role="status">YouTube 標題、說明與可見度已更新；自動發布排程不變。</p>
      )}
      {params.notice === "error" && (
        <p className={styles.errorNotice} role="alert">操作沒有完成。內容仍保留，請重新檢查後再試。</p>
      )}

      <div className={styles.workspace}>
        <aside className={styles.editionRail} aria-label="內容批次">
          <h2>最近批次</h2>
          {editions.length === 0 ? (
            <p className={styles.empty}>尚無成片。每日引擎完成後，內容會出現在這裡。</p>
          ) : (
            <nav>
              {editions.map((edition) => (
                <a
                  key={edition.tradeDate}
                  href={`/studio?date=${edition.tradeDate}`}
                  aria-current={selected?.tradeDate === edition.tradeDate ? "page" : undefined}
                  className={selected?.tradeDate === edition.tradeDate ? styles.currentEdition : undefined}
                >
                  <span>{edition.tradeDate}</span>
                  <small>{STATUS_COPY[edition.status].label}</small>
                </a>
              ))}
            </nav>
          )}
        </aside>

        <section id="studio-edition" className={styles.edition}>
          {!selected ? (
            <div className={styles.emptyEdition}>
              <h2>等待第一期五盤錄</h2>
              <p>交易日資料完整入庫後，引擎才會選取五檔並產生成片。</p>
            </div>
          ) : (
            <>
              <div className={styles.editionHeading}>
                <div>
                  <p className={styles.date}>{selected.tradeDate}</p>
                  <h2>{selected.title}</h2>
                </div>
                <div className={styles.statusBlock} data-status={selected.status}>
                  <strong>{STATUS_COPY[selected.status].label}</strong>
                  <span>{STATUS_COPY[selected.status].detail}</span>
                </div>
              </div>

              <div className={styles.reviewGrid}>
                <section className={styles.preview} aria-labelledby="preview-title">
                  <h3 id="preview-title">成片預覽</h3>
                  {selected.videoPath ? (
                    <video
                      controls
                      preload="metadata"
                      poster={selected.thumbnailPath
                        ? `/api/studio/media?date=${selected.tradeDate}&asset=thumbnail&hash=${selected.contentHash}`
                        : undefined}
                    >
                      <source
                        src={`/api/studio/media?date=${selected.tradeDate}&asset=video&hash=${selected.contentHash}`}
                        type="video/mp4"
                      />
                      瀏覽器無法播放這支影片，請改用下載後檢查。
                    </video>
                  ) : (
                    <p className={styles.empty}>影片尚未完成。資料與腳本不會因此遺失。</p>
                  )}
                </section>

                <section className={styles.publishFacts} aria-labelledby="publish-title">
                  <h3 id="publish-title">發布設定</h3>
                  <dl>
                    <div><dt>頻道</dt><dd>{config.channelId || "尚未連結 YouTube 頻道"}</dd></div>
                    <div><dt>自動發布</dt><dd>{config.autoPublish ? "開啟，成片完成後直接上傳" : "已暫停，佇列原地保留"}</dd></div>
                    <div>
                      <dt>送出可見度</dt>
                      <dd>{VISIBILITY_COPY[requestedVisibility]}（{requestedVisibilitySource}）</dd>
                    </div>
                    <div>
                      <dt>YouTube 實際可見度</dt>
                      <dd>
                        {actualVisibility
                          ? `${VISIBILITY_COPY[actualVisibility]}${actualVisibility !== requestedVisibility ? "（與送出設定不同）" : ""}`
                          : "尚未取得平台回報"}
                      </dd>
                    </div>
                    <div><dt>平台分類</dt><dd>{config.youtubeCategoryName}</dd></div>
                    <div><dt>AI 內容</dt><dd>已標示虛擬主持與合成媒體</dd></div>
                    <div><dt>兒少內容</dt><dd>否</dd></div>
                    <div><dt>發布時機</dt><dd>交易日資料與成片檢核通過後</dd></div>
                    <div><dt>發布嘗試</dt><dd>{selected.publishAttempts} / {config.publishMaxAttempts}</dd></div>
                    <div><dt>下次續傳</dt><dd>{selected.publishRetryAt ? formatDateTime(selected.publishRetryAt) : "目前沒有排定重試"}</dd></div>
                  </dl>
                </section>
              </div>

              <section className={styles.stockSection} aria-labelledby="stock-title">
                <div className={styles.sectionHeading}>
                  <h3 id="stock-title">五檔內容摘要</h3>
                  <p>分類描述資訊狀態，不代表預期漲跌。</p>
                </div>
                <div className={styles.stockGrid}>
                  {stocks.map((stock) => {
                    const stats = stock.study?.statistics;
                    return (
                      <article key={stock.symbol} className={styles.stockItem}>
                        <header>
                          <span>{stock.category || "未分類"}</span>
                          <strong>{stock.companyName || "未知公司"} {stock.symbol}</strong>
                        </header>
                        <p>{stock.currentConfiguration?.label || "3° 內無主要相位"}</p>
                        <dl>
                          <div><dt>樣本</dt><dd>{stats?.sampleSize ?? "未計算"}</dd></div>
                          <div><dt>正變動</dt><dd>{stats ? `${stats.positiveCount}/${stats.sampleSize}` : "未計算"}</dd></div>
                          <div><dt>中位數</dt><dd>{stats?.medianReturn == null ? "不顯示" : `${stats.medianReturn}%`}</dd></div>
                          <div><dt>四分位</dt><dd>{stats?.q1Return == null || stats?.q3Return == null ? "不顯示" : `${stats.q1Return}% 至 ${stats.q3Return}%`}</dd></div>
                        </dl>
                      </article>
                    );
                  })}
                </div>
              </section>

              <section className={styles.metadataSection} aria-labelledby="metadata-title">
                <div className={styles.sectionHeading}>
                  <h3 id="metadata-title">YouTube 發布設定</h3>
                  <p>可選擇調整；儲存不是逐片核准，預設仍由 worker 自動接手。</p>
                </div>
                <form action="/api/studio/settings" method="post" className={styles.metadataForm}>
                  <input type="hidden" name="trade_date" value={selected.tradeDate} />
                  <label>
                    目標頻道
                    <input readOnly value={config.channelId || "尚未連結 YouTube 頻道"} />
                  </label>
                  <label>
                    標題
                    <textarea
                      name="title"
                      rows={2}
                      maxLength={100}
                      defaultValue={selected.title}
                      readOnly={!canEditPublishingControls}
                      required
                    />
                  </label>
                  <label>
                    說明
                    <textarea
                      name="description"
                      rows={12}
                      maxLength={5_000}
                      defaultValue={selected.description}
                      readOnly={!canEditPublishingControls}
                      required
                    />
                  </label>
                  <label>
                    送出可見度
                    <select
                      name="visibility"
                      defaultValue={requestedVisibility}
                      disabled={!canEditPublishingControls}
                    >
                      <option value="public">公開</option>
                      <option value="unlisted">不公開</option>
                      <option value="private">私人</option>
                    </select>
                  </label>
                  {canEditPublishingControls ? (
                    <button type="submit">儲存發布設定</button>
                  ) : (
                    <p className={styles.disabledAction}>這期已進入發布流程，設定已鎖定。</p>
                  )}
                </form>
              </section>

              <section className={styles.approvalSection} aria-labelledby="approval-title">
                <div>
                  <h3 id="approval-title">自動發布控制</h3>
                  <p>
                    引擎只接手當日市場資料完整、內容驗證與影音檢核通過的交易日批次。
                  </p>
                  {!config.autoPublish && (
                    <p className={styles.legalLock}>
                      全域停止開關已開啟。待 AUTO_PUBLISH 恢復為 true，尚在佇列的批次才會繼續發布。
                    </p>
                  )}
                </div>

                {(["ready", "approved", "publish_retry", "failed"] as StoredEdition["status"][]).includes(selected.status) && (
                  <form action="/api/studio/quarantine" method="post" className={styles.quarantineForm}>
                    <input type="hidden" name="trade_date" value={selected.tradeDate} />
                    <label htmlFor="quarantine-reason">隔離原因</label>
                    <input
                      id="quarantine-reason"
                      name="reason"
                      minLength={4}
                      required
                      placeholder="例如：資料日期不完整"
                    />
                    <button type="submit">隔離這期</button>
                  </form>
                )}
              </section>

              <section className={styles.auditSection} aria-labelledby="audit-title">
                <h3 id="audit-title">最近稽核紀錄</h3>
                {audit.length === 0 ? (
                  <p className={styles.empty}>尚無紀錄。</p>
                ) : (
                  <ol>
                    {audit.map((item, index) => (
                      <li key={`${item.created_at}-${index}`}>
                        <time>{formatDateTime(item.created_at)}</time>
                        <strong>{item.action}</strong>
                        <span>{item.actor}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
