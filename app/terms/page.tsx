import type { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "使用條款",
  description: "盤勢的研究用途、資料界線、使用責任與服務條件。",
};

export default function TermsPage() {
  return (
    <main className={styles.page}>
      <div className={styles.masthead}>
        <Link className={styles.brand} href="/"><b>盤勢</b><small>PANSHI</small></Link>
        <nav className={styles.nav} aria-label="法律資訊">
          <Link href="/privacy">隱私與資料</Link>
          <Link href="/terms" aria-current="page">使用條款</Link>
        </nav>
      </div>

      <article className={styles.article}>
        <aside className={styles.aside}>
          <span className={styles.eyebrow}>TERMS OF USE</span>
          <span className={styles.updated}>生效日期<br />2026.07.13</span>
        </aside>

        <div className={styles.content}>
          <h1>象徵可以參考，<br />決定仍由你負責。</h1>
          <p className={styles.lede}>盤勢把企業命盤當成時間索引，把歷史價格當成可檢查的對照。使用本服務，代表你理解它是文化研究與資料探索工具，不是投資顧問、交易訊號或報酬承諾。</p>

          <section className={styles.section}>
            <h2>服務內容</h2>
            <p>盤勢依公司成立日或首日交易建立象徵性命盤，並把特定日期的組態與公開市場歷史資料對齊。網站與「今日五盤」影片可能呈現統計分布、反例、公司事件、資料缺口與文化解讀。</p>
            <p>星象重合不代表因果。歷史案例也不是獨立實驗，無法保證未來重演。</p>
          </section>

          <section className={styles.section}>
            <h2>不是投資建議</h2>
            <p>盤勢不提供買進、賣出、持有、目標價、停損、槓桿或部位建議，也不評估你的財務狀況、風險承受度或投資目標。任何交易決定、損益、稅務與法令義務都由你自行承擔；需要個人化意見時，請諮詢合格專業人士。</p>
          </section>

          <section className={styles.section}>
            <h2>資料與計算界線</h2>
            <ul>
              <li>價格預設為未還原收盤價；除權息可能讓期間變動失真。</li>
              <li>公司成立時間若只有日期，不延伸解讀月亮與宮位；首日交易時間以交易所開盤作為代理值。</li>
              <li>公開資料可能延遲、缺漏、修正或暫時無法取得；畫面會盡量標示資料截至日與缺口。</li>
              <li>樣本數、中位數與分布是過去的描述，不是勝率、預測或因果證明。</li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2>可接受的使用方式</h2>
            <p>你可以為個人研究、教育、評論與合法的開發用途使用公開服務。不得干擾服務、繞過存取限制、散布惡意程式、批量濫用端點，或把盤勢內容改寫成保證獲利、假冒背書或誤導性投資招攬。</p>
            <p>程式碼若有個別標示授權，依該授權使用；品牌、原創視覺、文字與未另行授權的素材，仍受適用的智慧財產規範保護。</p>
          </section>

          <section className={styles.section}>
            <h2>可用性與責任</h2>
            <p>我們會盡力維持服務與資料品質，但不保證不中斷、無錯誤、符合特定目的，或任何資料永遠即時完整。在法律允許的範圍內，Nomad 不對依賴象徵解讀、歷史對照或第三方資料所造成的交易損失、間接損害或機會損失負責。</p>
            <p>必要時，我們可以調整、暫停或終止部分功能，並以合理方式保護服務與使用者。條款若有實質變更，會更新本頁日期；變更後繼續使用服務，即表示接受新版條款。</p>
          </section>

          <section className={styles.section}>
            <h2>聯絡方式</h2>
            <p>對條款、資料或公開程式有疑問，可到 repository 的 <a href="https://github.com/weian-nomad/panshi-company-market-astrology/issues" target="_blank" rel="noreferrer">Issues</a> 提出不含帳號、憑證或其他敏感資訊的問題。</p>
          </section>
        </div>
      </article>

      <div className={styles.foot}><span>盤勢 · Nomad</span><Link href="/">回到研究頁</Link></div>
    </main>
  );
}
