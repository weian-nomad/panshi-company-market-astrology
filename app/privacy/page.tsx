import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "隱私與資料使用",
  description: "盤勢如何處理研究查詢、本機記錄、頻道發布授權與資料刪除。",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <div className={styles.masthead}>
        <Link className={styles.brand} href="/"><b>盤勢</b><small>PANSHI</small></Link>
        <nav className={styles.nav} aria-label="法律資訊">
          <Link href="/privacy" aria-current="page">隱私與資料</Link>
          <Link href="/terms">使用條款</Link>
        </nav>
      </div>

      <article className={styles.article}>
        <aside className={styles.aside}>
          <span className={styles.eyebrow}>DATA PRACTICE</span>
          <span className={styles.updated}>生效日期<br />2026.07.13</span>
        </aside>

        <div className={styles.content}>
          <h1>你留下什麼，<br />我們就說清楚。</h1>
          <p className={styles.lede}>盤勢不要求公開網站使用者註冊，也不販售個人資料。研究頁只處理完成查詢所需的輸入；你主動保存的觀察與決策記錄，留在自己的瀏覽器。</p>

          <section className={styles.section}>
            <h2>公開研究工具處理的資料</h2>
            <p>當你查詢公司或日期問盤時，瀏覽器會把股票代號、日期、命盤基準與觀察期送到伺服器，伺服器據此計算並回傳結果。盤勢不把這些查詢建立成個人帳號紀錄，也不以它們建立廣告側寫。</p>
            <p>為了維持安全與可用性，主機與必要的網路服務可能暫時處理 IP 位址、瀏覽器資訊、請求時間、路徑與錯誤紀錄。這些技術資料只用於防濫用、除錯與服務運作，不用來出售或進行跨站追蹤。</p>
          </section>

          <section className={styles.section}>
            <h2>留在你裝置上的資料</h2>
            <p>收藏公司、收藏日期，以及你在「決策記錄」寫下的理由、反證條件與回看日期，會存進瀏覽器的 localStorage，最多保留最近 50 筆決策記錄。盤勢不會把這些文字同步到伺服器。</p>
            <p>你可以在產品介面刪除個別記錄，或清除本網站的瀏覽器資料，一次移除全部本機內容。清除後無法由盤勢復原。</p>
          </section>

          <section className={styles.section}>
            <h2>影片發布與頻道授權</h2>
            <p>「今日五盤」Studio 是 Nomad 營運人員使用的內部發布工具；公開網站使用者不會被要求連結自己的 Google 或 YouTube 帳號。Studio 只使用頻道讀取與影片上傳授權，核對指定頻道後，發布盤勢製作的影片、縮圖與中繼資料。</p>
            <ul>
              <li>讀取範圍：授權帳號所管理頻道的識別資訊與影片發布狀態。</li>
              <li>寫入範圍：上傳盤勢製作的影片與縮圖，並設定標題、說明、分類及可見度。</li>
              <li>保存方式：更新權杖只存在 Nomad 的私有金鑰庫與短暫工作憑證；Studio 資料庫另保存目標頻道、已發布影片識別碼、可見度、上傳狀態與中斷續傳所需資料。這些內容不送到訪客瀏覽器，也不寫入公開 repository。</li>
              <li>AI 揭露：影片與說明欄會標示 AI 虛擬主持與合成語音；短片連回可查驗完整樣本的研究頁。</li>
            </ul>
            <div className={styles.callout}>
              <p>頻道擁有者可由 Studio 撤銷工具同步終止 Google 授權、刪除更新權杖，以及清除 Studio 內的頻道、影片、續傳與稽核識別資料；本機產生的腳本與成片不是 Google 授權資料，可繼續保留。也可先在 <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google 帳戶連結管理</a>撤銷，再要求 Nomad 在 7 日內完成本地刪除。Google 服務另適用 <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google 隱私權政策</a>與 <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube 服務條款</a>。</p>
            </div>
          </section>

          <section className={styles.section}>
            <h2>資料來源、分享與保存</h2>
            <p>公司與行情資料來自公開市場資料端點。開啟外部來源、Google 或 YouTube 連結後，該網站會依自己的政策處理資料。</p>
            <p>盤勢不出售個人資料。只有維持主機、網路安全與影音發布所必要的服務會在其職責範圍內處理技術資料。營運紀錄只保留到完成安全、除錯或法令要求所需的期間；頻道授權資料則保留到撤銷、失效或不再需要為止。發布 worker 偵測到 Google 授權失效時，會停止待發布批次並清除 Studio 內的授權識別資料。</p>
          </section>

          <section className={styles.section}>
            <h2>刪除、詢問與更新</h2>
            <p>本機決策記錄可由你直接刪除。若要詢問營運紀錄、撤銷頻道授權或要求刪除由 Nomad 控制的資料，可在公開 repository 的 <a href="https://github.com/weian-nomad/panshi-company-market-astrology/issues" target="_blank" rel="noreferrer">Issues</a> 提出不含敏感資訊的請求；需要驗證身分時，我們會改用私下管道處理。</p>
            <p>政策有實質變更時，本頁會更新生效日期。新增資料用途前，我們會先修改說明，不把既有資料悄悄改作不相容的用途。</p>
          </section>
        </div>
      </article>

      <div className={styles.foot}><span>盤勢 · Nomad</span><Link href="/">回到研究頁</Link></div>
    </main>
  );
}
