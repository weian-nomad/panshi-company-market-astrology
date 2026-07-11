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

`SITE_URL` 不是秘密。此版本不需要資料庫或 API key；公司與價格資料來自公開市場資料端點。

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
