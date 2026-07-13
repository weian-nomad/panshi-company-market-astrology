# 今日五盤 Studio

Studio 在每個交易日收盤後產生一支「今日五盤」直式影片，完成內容驗證與影音檢核後自動上傳 YouTube。五檔公司各有不同的入選理由，片中呈現當日組態、完整歷史對照與樣本界線，不產生買賣、目標價、停損或部位指令。

影片使用 AI 虛擬主持人「墨衡」與合成語音；片中、說明欄與 YouTube 中繼資料都保留清楚標示。

## 自動直上

預設設定是完成即公開：

```dotenv
AUTO_PUBLISH=true
YOUTUBE_VISIBILITY=public
```

每日流程：

1. 收盤後確認當日市場資料已入庫。資料尚未到齊時保留可重試狀態；非交易日與休市不會生成。
2. 選出五檔，建立當日組態、歷史樣本與資料覆蓋記錄。
3. 驗證內容中的公司、日期、數字、樣本下限、AI 揭露與用語。
4. 產生語音、異動畫面、直式影片與縮圖，再執行尺寸、編碼、音軌與片長檢核。
5. 通過的交易日批次進入 `ready`；工作程序以原子 claim 取得一批，再立即上傳。
6. YouTube resumable session 只保存在主機的持久化 SQLite。程序中斷後，下一個 worker 先向平台核對已收位元組；若平台已完成影片，直接記錄既有 video ID，不會另建一支。
7. 一般發布錯誤進入 `publish_retry`，預設最多嘗試 5 次並採指數退避。達上限後轉為 `failed`，不會無限重送。內容或影音檢核未通過時不會進入發布佇列。

`YOUTUBE_VISIBILITY` 支援三個值：

- `public`：上傳完成後立即公開，不設排程時間。
- `unlisted`：上傳完成後保留為不公開連結。
- `private`：上傳完成後保留為私人影片。

新建且尚未通過 YouTube API 稽核的專案，平台會把 API 上傳強制設為私人。
`YOUTUBE_VISIBILITY=public` 會持續表示預期設定，但 worker 只記錄 YouTube 實際回傳的可見度，不會把
私人影片誤報為已公開。通過專案稽核後，每支影片不再需要人工發布；YouTube 仍可能依政策要求定期複審，屆時沿用同一個全域停止與佇列機制。詳見
[YouTube Videos API 說明](https://developers.google.com/youtube/v3/docs/videos)與 [Quota and Compliance Audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)。

Nomad 首次部署若仍在等待這項專案稽核，正式環境先設定 `AUTO_PUBLISH=false`：每日資料、選片與成片照常產生，批次停在 `ready` 佇列，不先上傳成無法自動轉公開的私人影片。稽核通過後只需切回全域開關；既有佇列會依交易日順序直接發布，仍沒有逐片核准流程。申請入口與可能的定期複審規則見 [YouTube Quota and Compliance Audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)。

需要立即停止新影片上傳時，只要切換全域開關：

```dotenv
AUTO_PUBLISH=false
```

停止期間 `ready` 批次留在佇列。恢復 `AUTO_PUBLISH=true` 後，工作程序會繼續取得。單一異常批次可在 Studio 監看台隔離，不影響後續交易日。

YouTube 平台分類以 `YOUTUBE_CATEGORY_NAME=Education` 查找當地可用 category。片內五檔另標示「市場異動、量能異常、相位密集、歷史分歧、稀有組態」等入選分類。這些分類只回答為什麼值得回看，不代表方向、評級或推薦。

新片預設通知訂閱者；需要關閉時明確設定 `YOUTUBE_NOTIFY_SUBSCRIBERS=false`。重試與失效租約可用以下非秘密設定調整，預設值適合每五分鐘執行一次的 worker：

```dotenv
YOUTUBE_NOTIFY_SUBSCRIBERS=true
STUDIO_PUBLISH_MAX_ATTEMPTS=5
STUDIO_PUBLISH_RETRY_BASE_SECONDS=300
STUDIO_UPLOAD_STALE_MINUTES=20
```

## 環境與資料

Studio 使用 Node.js 24、Remotion、Chromium、FFmpeg 與內嵌字型。市場資料庫、Studio 狀態與成片必須放在持久化 volume：

| 路徑 | 用途 |
| --- | --- |
| `/app/runtime-data/panshi-market.db` | 與 Web App 共用的市場快取；Studio 只讀取行情 |
| `/app/runtime-data/panshi-studio.db` | 批次狀態、上傳結果與稽核紀錄 |
| `/app/var/panshi-studio` | 逐字稿、音訊、畫面、縮圖與影片 |

非秘密設定以 [.env.studio.example](../.env.studio.example) 為範本，部署到 `/etc/panshi/studio.env`。金鑰的唯一編輯來源是中央 Nomad vault；部署程式依 allowlist 產生兩個 root-only、mode `600` 的 Docker env 檔：

| 主機憑證檔 | 只能包含 | 使用者 |
| --- | --- | --- |
| `/etc/panshi/credentials/studio-generate.env` | `OPENAI_API_KEY` | 生片 worker |
| `/etc/panshi/credentials/studio-publish.env` | `YOUTUBE_OAUTH_CLIENT_ID`、`YOUTUBE_OAUTH_CLIENT_SECRET`、`YOUTUBE_REFRESH_TOKEN` | 發布 worker |

systemd 透過 `LoadCredential=` 把對應檔案映射到單次 service 的短暫 credentials directory，Docker client 再以 `--env-file %d/...` 讀取；秘密不會進入 service manager environment，也不會出現在 command line。生片與發布檔分開，不讓任一 container 取得不需要的金鑰。監看台若啟用，再把 `STUDIO_REVIEW_TOKEN` 以獨立的 Web secret 提供給 Web container，不寫入上述任一 worker 檔。不要直接 `source` vault，也不要把值放進 repository、Docker image、systemd unit、issue 或執行紀錄。

`/studio` 由主 Web App 提供。Web container 必須讀取與 worker 相同的 Studio DB 與成片 volume，並設定 `STUDIO_DB_PATH`、`STUDIO_OUTPUT_ROOT`；否則監看台不會顯示 worker 產生的批次。Web container 只需要監看台密碼，不需要語音或 YouTube 憑證。

建立 worker image：

```bash
docker build --file Dockerfile.studio --tag panshi-studio:current .
```

本機產生一個交易日批次：

```bash
npm run studio:generate
```

開啟 Remotion Studio 預覽動畫模板：

```bash
npm run studio:preview
```

手動觸發一次自動發布 worker：

```bash
npm run studio:publish
```

當 `AUTO_PUBLISH=false` 或沒有 `ready` 批次時，worker 回報 paused 或 idle，不會建立影片。

## YouTube OAuth

沿用現有 Nomad/Panshi 基礎設施、OAuth client 與 YouTube 頻道，不為 Studio 建立另一個帳號或專案。使用頻道擁有者的 OAuth 同意流程，不使用服務帳號。現有 client 必須支援以下 loopback redirect URI：

```text
http://localhost:53682
```

Studio 使用專屬的 `YOUTUBE_OAUTH_CLIENT_ID` 與
`YOUTUBE_OAUTH_CLIENT_SECRET`，避免覆蓋 Nomad 其他 Google 服務的共用憑證。先確認
vault 已有所需設定；指令會以惰性文字剖析 vault，不會執行其中內容或列印金鑰值：

```bash
npm run studio:oauth -- status
```

接著產生 PKCE S256 授權交接：

```bash
npm run studio:oauth -- url
```

指令會先在 `127.0.0.1:53682` 啟動 loopback listener，再開啟瀏覽器。完成同意後，工具核對已保存的 `state`、回呼 origin 與 PKCE verifier，然後直接交換授權；回呼只綁定 loopback 位址，逾 30 分鐘失效。

如果 loopback listener 無法使用，交接檔會保留在本機 mode `600` 檔案。完成瀏覽器同意後，複製包含 `code` 與 `state` 的完整返回網址，在 30 分鐘內執行手動交換；貼上的內容不會回顯：

```bash
npm run studio:oauth -- exchange
```

交換成功後，工具會保留 vault 內其他內容，以原子方式更新授權資訊，再把檔案權限設回 `600`。終端只顯示「已儲存」，不會顯示 token。

頻道擁有者要停止授權時，可執行：

```bash
npm run studio:oauth -- revoke
```

撤銷指令必須在已掛載正式 Studio 持久卷的營運環境執行，並明確設定 `STUDIO_DB_PATH` 與指向持久、可寫金鑰來源的 `NOMAD_KEY_VAULT`；短暫的 systemd credential 檔不能代替來源 vault。指令會先確認 vault 內的權杖與目前憑證一致，缺少或不一致時直接停止，不會誤報刪除成功。確認後才向 Google 撤銷目前的更新權杖，以原子方式從 Nomad vault 刪除 `YOUTUBE_REFRESH_TOKEN` 與未完成的 OAuth 交接檔，同時清除 Studio DB 內的頻道、影片、續傳與稽核識別資料並隔離待發布批次；本機腳本與成片保留。失效的既有權杖也會完成本地清除。完成後自動發布無法再取得存取權，直到重新走一次同意流程。若先從 Google 帳戶頁撤銷，也應執行此指令清除本地副本。

上傳前設定 `YOUTUBE_CHANNEL_ID`，工具會核對登入帳號實際管理的頻道。預設授權只開啟影片上傳與頻道讀取；不申請留言或帳號管理權限。

## 監看、隔離與失敗處理

`/studio` 是狀態監看台，不是每期核准關卡。它會顯示成片、五檔內容、目標 YouTube 頻道、中繼資料、目前可見度、發布嘗試次數、下次續傳時間、處理狀態與稽核紀錄，但不顯示 resumable session URL 或 worker claim token。尚未開始上傳時，操作者可選擇調整標題、說明與 `public`／`unlisted`／`private`；不操作就沿用自動生成內容與全域預設，worker 不需等待確認。如果某期尚在 `ready`、舊版 `approved`、`publish_retry` 或 `failed` 狀態，可以單獨隔離；仍由 worker 持有有效租約的批次不能重複操作。

自動上傳前的程式檢核包含：

- 資料日期等於最近交易日，五檔名稱與代號可對回 manifest。
- 每個數字都有資料來源；樣本不足時不讀方向。
- 正、負與混合案例都保留；「正變動筆數」不改寫成勝率。
- 片中沒有買、賣、持有、目標價、停損、部位或報酬保證。
- 畫面與說明欄標示 AI 虛擬主持與合成語音。
- 影片是 `1080 × 1920`、H.264/AAC，音軌、字幕與結尾連結完整。
- `YOUTUBE_CHANNEL_ID` 必須存在，批次綁定頻道、OAuth 實際頻道與設定三者必須完全相同。
- 上傳前重新解析 output root 與媒體 realpath，拒絕目錄外檔案、符號連結逸出、缺檔與錯誤副檔名。
- 每次上傳都重新執行 MP4／H.264／AAC／PNG、尺寸、音軌、片長與完整解碼檢查，並重算成片、縮圖、內容 manifest 與 QC 的 SHA-256 綁定；僅改名成 `.mp4` 的任意檔案不會被接受。

## systemd 排程

範例 unit 在 `deploy/systemd/`：

- `panshi-studio-backfill.service`：新環境手動執行一次，建立七年市場快取。
- `panshi-studio-market-update.service`：每次生片前沿 ledger 分批補齊增量行情、修復近期缺口，並更新公司名錄；更新失敗時不進入生片。
- `panshi-studio-generate.timer`：臺北時間週一至週五 16:20 起每 15 分鐘嘗試，至 20:50 為止。成功批次會被冪等略過；國定假日與臨時休市不會生成。
- `panshi-studio-publish.timer`：每五分鐘取得一個 `ready` 批次並依設定直接上傳。舊版 `approved` 狀態也會相容處理。

部署前建立專用 runtime 帳號、由 `PANSHI_DATA_DIR` 與 `PANSHI_STUDIO_DIR` 指定的兩個持久化目錄，以及主機專用的 Studio env 檔。持久化目錄要讓 container 內的 UID/GID `1001:1001` 讀寫。主機需使用支援 `LoadCredential=` 的 systemd（v247 以上）。部署程序從中央 vault allowlist 最小權限的 secrets，原子寫入 `/etc/panshi/credentials/` 下的兩個 root-only env 檔；runtime 帳號不直接讀取 vault 或憑證來源檔，只在 service 執行期間讀取 systemd 建立的短暫副本。該帳號需能使用 Docker。Web container 另取監看台密碼，不與 worker 共用憑證檔。

兩個 credential env 檔使用 Docker `--env-file` 格式：每行只放一個 `KEY=value`，不加 `export`，不放空白佔位值。部署完成後驗證目錄 mode `700`、檔案 mode `600` 與正確擁有者，再啟動 unit。

```bash
sudo cp deploy/systemd/panshi-studio-*.service /etc/systemd/system/
sudo cp deploy/systemd/panshi-studio-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start panshi-studio-backfill.service
sudo systemctl enable --now panshi-studio-generate.timer
sudo systemctl enable --now panshi-studio-publish.timer
systemctl list-timers 'panshi-studio-*'
```

新的部署環境先以一次性 service 建立七年市場快取。工作可中斷後重跑，已完成的交易日會自動略過；確認回填完成後再讓每日生片流程接手：

```bash
journalctl --unit panshi-studio-backfill.service --follow
```

生片 container 預留 `1 GiB` shared memory 給 Chromium，並以 `REMOTION_CONCURRENCY=1` 在小型主機上穩定渲染。增加平行度前，先以正式尺寸完成一支全片渲染與影音檢核。

更新 image 後可各手動觸發一次，再確認 timer 狀態：

```bash
sudo systemctl start panshi-studio-generate.service
sudo systemctl start panshi-studio-publish.service
journalctl --unit 'panshi-studio-*' --since today
```

日誌只記錄狀態、交易日、版本與錯誤類型。不輸出 OAuth code、token、API key、resumable session URL、claim token、完整請求內容或尚未公開的成片網址。這些敏感欄位也不會寫入稽核 details 或 Studio 畫面。
