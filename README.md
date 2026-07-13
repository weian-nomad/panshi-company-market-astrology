# 盤勢 Panshi

> 把公司的時間，放回股價裡看。

盤勢是一個「企業命盤 × 價格時間線」的文化研究與資料探索工具。它把上市公司的成立日或首日交易當成命盤基準，將主要行運窗口對齊實際歷史收盤價。使用者也能指定一個未來日期，查看同組態歷史、公司事件與資料界線，再留下可回看的決策記錄。

這不是預測工具，不產生買賣訊號。命盤與價格之間的歷史重合不代表因果。

## 現在有什麼

- 不用登入的臺股上市（TWSE）+ 上櫃（TPEx）公司代號搜尋。
- 本機 SQLite 快取全部上市櫃公司 7 年歷史 OHLCV（見「資料快取」），不用每次請求即時打外部 API。
- 「公司成立日」與「首日上市交易」雙命盤基準。
- 日期來源、交易所時區、時間精度與信心等級。
- 行星本命輪、公司「時間質地」與所選行運相位。
- 3M / 6M / 1Y 歷史價格與主要相位標記。
- 相位事件的 D+5 / D+20 實際收盤報酬與中位數。
- 「玄覽」與「驗證」雙鏡閱讀模式。
- 未來 120 天觀察窗口、本機觀察簿與 deep link 分享。
- 「問盤」流程：目標日期、當下情境與 5 / 20 / 60 個交易日歷史對照期。
- 官方開休市日曆校正，非交易日會明示並順延。
- 最長七年的同組態研究：樣本數、收盤價變動中位數、四分位、正變動筆數與期間最低偏離。
- 官方除權息、股東會、當期重大訊息與暫停交易核對，未完整涵蓋處會直接標示。
- 本機決策日誌：行動理由、可推翻條件、回看日期與當時資料日期。
- 「今日五盤」自動內容引擎：每個交易日從五種不同研究理由各選一檔，產生一支 Remotion 直式影片並交由 Nomad 頻道發布。

## 資料與計算

- 公司成立／上市資料：[臺灣證券交易所 OpenAPI](https://openapi.twse.com.tw/)（上市）+ [證券櫃檯買賣中心 OpenAPI](https://www.tpex.org.tw/openapi/) `mopsfin_t187ap03_O`（上櫃）。專案內含精簡快照，避免首次載入要下載整份公司資料表。
- 歷史股價：TWSE 全市場單日行情（`MI_INDEX`）+ TPEx 全市場單日行情（`stk_wn1430_result.php`），逐日整批下載後存進本機 SQLite，目前顯示原始收盤價，未還原除權息。
- 交易日：[臺灣證券交易所市場開休市日期](https://www.twse.com.tw/zh/trading/holiday.html)。公告日曆不包含尚未發生的臨時休市。
- 公司事件：[臺灣證券交易所 OpenAPI](https://openapi.twse.com.tw/)。目前只接入 TWSE 除權息、股東會、當期重大訊息與暫停交易；TPEx 對應事件與法說/財報排程尚未涵蓋。
- 行星黃經：`astronomy-engine`。
- 首日交易盤以 `Asia/Taipei` 09:00 為開盤代理值，明確標記為「推定時間」。
- 成立日通常沒有時分，其他行星以當日中點估算；月亮、上升、宮位與其他時辰敏感結果保持空白。

## 資料快取

正式環境不會每次請求都即時打 TWSE/TPEx API——`lib/market-data.ts` 先讀本機 SQLite 快取，只在快取有缺口時（例如每日排程還沒跑到的最近幾天）才即時補抓，且有 wall-clock 上限，不會為了補歷史資料卡住請求。

```bash
npm run backfill:market   # 一次性回填 7 年資料，可重複執行、可從中斷處繼續
npm run update:market     # 沿 ingest ledger 增量追上最新交易日，並修復近期缺口
```

`MARKET_DB_PATH` 指到的 SQLite 檔案在正式環境必須是掛載 volume，見 [docs/deployment.md](docs/deployment.md)。

## 今日五盤內容引擎

每日引擎先掃描完整市場，再依市場異動、量能異常、相位密集、歷史分歧與今昔反差選出五檔。每檔都必須有達描述門檻、同時包含上行與下行案例的精確歷史組態；不夠就換檔，湊不滿五檔就停止生成。五檔是五種觀察角度，不是排名，也不轉成買賣訊號。

同一檔若當日有多個 3° 內精確組態，Studio 固定依「可發布完整度 → 樣本數 → orb → signature」選出證據最完整的一組，不按報酬幅度挑盤。候選池不足時只會從 60 擴到 100、200 檔，不會放寬樣本門檻。

成片由 Remotion、AI 虛擬觀測員與合成語音組成。資料、口播、字幕、畫面與縮圖共用同一份 fact manifest；通過內容與影音 QC 後，worker 會直接接手上傳。排程、OAuth、監看台、失敗恢復與部署方式見 [docs/STUDIO.md](docs/STUDIO.md)。

## 開發

需要 Node.js 24 以上。

```bash
npm ci
npm run dev
```

建置與檢查：

```bash
npm run lint
npx tsc --noEmit --incremental false
npm test
```

完整瀏覽器旅程檢查：

```bash
PANSHI_URL=http://localhost:3000/ npm run test:browser
```

容器化執行：

```bash
docker build -t panshi .
docker run --rm -p 3000:3000 -e SITE_URL=http://localhost:3000 panshi
```

本機入口：<http://localhost:3000/>

健康檢查：`GET /api/health`。

## 公開版本

- Nomad SustainTech：<https://panshi.nomadsustaintech.com/>（自己的子網域）
- 隱私與資料：<https://panshi.nomadsustaintech.com/privacy>；使用條款：<https://panshi.nomadsustaintech.com/terms>
- 正式環境以非特權、非 root Docker 容器在獨立執行環境中運作。
- `SITE_URL` 用來產生 canonical 與社群分享網址；它不是秘密。

## 產品研究

完整的全球競品、使用者旅程、資訊架構、品牌方向與商業邊界放在 [docs/product-strategy.md](docs/product-strategy.md)。

## 使用界線

本產品用於文化研究、教育與資料探索，不構成投資、法律或財務建議，也不保證任何報酬。問盤不提供買賣、目標價、停損或部位結論。
