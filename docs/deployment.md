# Deployment

盤勢以標準 Next.js standalone Docker image 發布，容器內使用 Node.js 24、非 root 使用者與 port 3000。

## Build and verify

```bash
npm ci
npm run lint
npx tsc --noEmit --incremental false
npm test
docker build -t panshi .
```

啟動後確認：

```bash
curl --fail http://127.0.0.1:3000/api/health
```

## Runtime configuration

| Variable | Required | Purpose |
|---|---:|---|
| `SITE_URL` | production | Canonical public URL and social-card origin |
| `PORT` | no | Container port; defaults to `3000` |
| `MARKET_DB_PATH` | production | SQLite cache file path; defaults to `data/panshi-market.db` |

`SITE_URL` 不是秘密。不需要外部 API key；公司與價格資料來自 TWSE + TPEx 公開市場資料端點。

## 本地價格快取（SQLite）

正式環境把 TWSE(上市) + TPEx(上櫃) 全公司 7 年歷史 OHLCV 快取進本機 SQLite（`node:sqlite` 內建模組，無額外套件），避免每次請求即時打外部 API。

- `MARKET_DB_PATH` 指到的 `.db` 檔案必須是**掛載 volume**、不能只存在 image 裡（容器重建/替換不能丟資料，回填要花約一小時，不该每次部署重跑）。
- 一次性回填：`npm run backfill:market`（可重複執行，已完成的 (market, date) 會跳過，中斷後重跑會從斷點繼續）。
- 每日增量：`npm run update:market`（抓最近幾天，跑在 daily cron/systemd timer，讓快取跟上最新交易日）。
- 兩支 script 都跑在 Next.js bundler 之外（純 Node ESM），import 用 `node --import ./scripts/register-path-alias.mjs <script>`（處理 `@/` alias 與 JSON import-attribute）。
- `lib/market-data.ts` 是唯讀路徑：先讀快取，只在快取有缺口時即時補抓最近幾天（有 wall-clock 上限，絕不會為了補一段深歷史卡住請求）。快取完全空的公司會回傳 `coverage.complete:false`，不是報錯。

## Production route

正式入口為 <https://panshi.nomadsustaintech.com/>（自己的子網域、自己的主機，不是掛在主站底下的路徑）。發布流程必須：

1. 從乾淨來源建立新 image。
2. 用 `/api/health` 驗證候選容器。
3. 成功後才切換流量。
4. 保留前一個 image，健康檢查失敗時回滾。

應用在 domain root 運行（`basePath` 為空）。

切換流量後，再用真實瀏覽器確認 hydration、資料載入、圖片與互動：

```bash
PANSHI_URL=https://panshi.nomadsustaintech.com/ npm run test:browser
```
