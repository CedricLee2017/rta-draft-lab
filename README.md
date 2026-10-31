# RTA Draft Lab

魔靈召喚（Sky Arena）RTA 對戰紀錄與 BP 分析。
**線上使用：<https://rta-draft-lab.pages.dev>**　｜　**原始碼：<https://github.com/CedricLee2017/rta-draft-lab>**

- **預設玩家：`221145`（xXLaVarXx）** ← 打開網站直接看這位
- 每天只自動抓 1 次（cron，給 `221145`）；平常不主動抓，避免用掉免費額度
- 額度用完時仍可看已快取的資料（橫幅會標示「顯示快取資料」）

輸入玩家 ID → 雲端自動抓取本季全部對戰 → 選角率、被 ban 率、對位勝率、首搶優勢、雙人組合、對手戰績。
資料在瀏覽器端分析，帳號資料不上傳；對戰紀錄快取在 IndexedDB，回訪幾乎零等待。
找過的玩家會自動記在「最近查看」清單（存在瀏覽器 localStorage），下次點一下就能切回去。

---

## 架構

```
瀏覽器（Pages 靜態 SPA）
   │  1. IndexedDB 有資料 → 先畫（0 網路請求）
   │  2. 超過 60 分鐘 → 背景呼叫 Worker 更新
   │  3. 最近查看清單 → localStorage（rta:recents）
   ▼
Worker  rta-draft-api
   │  KV 快取 14 天；60 分鐘內直接回（約 200–280ms / 136KB）
   ▼
Cloudflare Browser Rendering（雲端 Chrome）
   │  首次整季 limit=1000（約 3.7 秒）；之後只抓最新 50 筆再合併（約 1.8 秒）
   ▼
api.lucksack.gg
```

### 為什麼一定要 Browser Rendering

`api.lucksack.gg` 的 Cloudflare bot 防護擋的是 **TLS 指紋（JA3）**，不是 IP 或 header：

| 方式 | 結果 |
| --- | --- |
| `curl` / Node `fetch`（含瀏覽器 UA + Referer） | 403 |
| Cloudflare Worker 直接 `fetch` | 403 |
| Python `curl_cffi impersonate="chrome"` | 200 |
| 真瀏覽器（Browser Rendering） | 200 |

Worker 的 `fetch` 無法偽裝 TLS 指紋，所以只有「真的開一個 Chrome」這條路能在 Cloudflare 上跑。

---

## 資料語意（很容易搞錯，統計全靠這個）

lucksack 的欄位命名是「從該玩家的視角」：

| 欄位 | 意思 |
| --- | --- |
| `my_monsters` | 我選進的 5 隻 |
| `my_bans` | **我的 5 隻裡「被對手 ban 掉」的那隻**（一定在 `my_monsters` 內） |
| `opponent_monsters` | 對手選進的 5 隻 |
| `opponent_bans` | **對手的 5 隻裡「被我 ban 掉」的那隻** |

所以：

- 選角率（draft）＝ 出現在 5 隻的次數
- 被 ban 率（ban）＝ `my_bans` 的次數
- 實際出戰（played）＝ 5 隻扣掉被 ban 的那隻（4 隻）
- 勝率只算「實際出戰」的場次，才不會被 ban 場次污染

`won` 是 `true` / `false` / `null`（和局），統計時和局不列入勝率分母。

---

## API

```
GET /api/player?player=174018&season=39[&full=1][&refresh=1]
GET /api/health[?browser=1]
```

- `full=1`：忽略增量基底，整季重抓
- `refresh=1`：忽略 60 分鐘新鮮度，強制重新抓取（仍會用 KV 舊資料當增量基底）
- 抓取失敗但有舊資料時，回舊資料並附 `stale: true` + `warning`

### 429 與額度的處理

瀏覽器額度有兩個限制，搞錯會讓整個站停擺：

1. **開新瀏覽器的速率限制**（約每分鐘 1 次）→ 先 `puppeteer.sessions()` 找現有 session 接上去；
   每個請求用獨立的 `createBrowserContext()` 隔離，結束只 `context.close()` + `browser.disconnect()`。
2. **每日瀏覽器分鐘數**（免費 10 分鐘／天）計的是 **session 存活時間**，不是指令時間。
   所以 `keep_alive` 只給 **15 秒**（原本設 10 分鐘，實測一次抓取就把整天額度燒光 → 615 秒）。
3. 開新瀏覽器撞到 429 時，依 `puppeteer.limits().timeUntilNextAllowedBrowserAcquisition` 退避重試。
4. 抓取前先看 `usedBrowserTimeSeconds`，超過 570 秒就**不再開瀏覽器**，直接回 KV 舊資料
   （`stale: true` + 說明），避免無謂的 429。
5. 沒有快取又沒額度時回 HTTP 429 + 中文說明（UTC 00:00 重置）。

實測：冷啟動整季 3.7 秒 → 重用 session 的增量更新 1.8 秒 → KV 命中 0.07–0.3 秒。
以 15 秒 keep-alive 計算，每天 10 分鐘約可抓 30 次以上，日常使用（1–3 次）綽綽有餘。

---

## 抓取策略（重要）

- **平常不主動抓**：只有以下三種情況會開瀏覽器
  1. 每日 cron 預熱 `WARM_PLAYERS`（目前只有 `221145:39`）
  2. 你要看的玩家／賽季在 KV 裡沒有資料
  3. 你按「強制更新」，或資料超過 60 分鐘且你重新載入頁面
- **額度是 10 分鐘／天，UTC 00:00（台灣 08:00）重置**，用完就只回快取資料。
- 額度用完時：已抓過的玩家照常看到（黃色「顯示快取資料」橫幅會寫資料幾分鐘前），
  沒抓過的玩家會顯示「今日額度已用完」，不會卡住或空白。
- 想省額度：不要連續點「強制更新」；一天看 1–2 次就好。

## 自己補資料（不消耗 Cloudflare 額度）

額度用完又急著看某位玩家時，可以在自己電腦上抓一次再寫進 KV，
**完全不會用到 Browser Rendering 的分鐘數**。

```bash
# 1. 安裝依賴（只需一次）
pip install curl_cffi

# 2. 抓資料（在 rta-draft-lab 目錄）
python tools/fetch_player.py 221145 39
#    → 產生 payload.json，並印出 KV key（m:221145:39）

# 3. 寫進 KV（14 天，TTL 1209600 秒）
npx wrangler kv key put --namespace-id 47c4f3e6931c4992b8a743cbdb8aff56 \
    --remote "m:221145:39" --path payload.json --ttl 1209600
```

寫完後重新整理網站就會看到新資料（Worker 60 分鐘內直接回 KV，不會再開瀏覽器）。

回應：

```jsonc
{
  "version": 1,
  "player": { "id": 221145, "username": "xXLaVarXx", "country": "...", "image": "..." },
  "season": 39,
  "fetchedAt": "2026-10-31T04:30:00.000Z",
  "summary": { "rank": 72, "score": 1414, "winRate": 57.3, "total": 356, "daily": [...] },
  "matches": [
    { "battleId": 243036167, "time": "2026-10-30T20:04:32+01:00", "won": true, "firstPick": false,
      "my": [25313, 29111, 16111, 16812, 22614], "myBan": 22614, "myLeader": 25313,
      "opp": [16811, 30512, 33214, 28613, 35814], "oppBan": 28613, "oppLeader": 30512,
      "myScore": 1414, "oppScore": 1406, "oppId": 174625, "oppName": "...",
      "bracket": 16, "oppBracket": 16 }
  ],
  "cached": false
}
```

---

## 專案結構

```
rta-draft-lab/
├─ worker/
│  ├─ src/index.ts        API、KV 快取、Browser Rendering、CORS、cron 預熱
│  └─ wrangler.toml       [browser] binding + KV + 每日 cron
├─ tools/
│  └─ fetch_player.py     本機抓單一玩家 → payload.json（不耗 Cloudflare 額度）
└─ web/
   ├─ src/App.tsx         篩選、分頁、資料載入（stale-while-revalidate）
   ├─ src/lib/stats.ts    純函式統計（選角 / ban / 對位 / 組合 / 首搶）
   ├─ src/lib/api.ts      fetch + IndexedDB 快取
   ├─ src/lib/recents.ts  「最近查看」玩家清單（localStorage）
   ├─ src/components/     對局卡、魔靈選單、統計面板
   └─ public/sample-matches.json   示範資料（S39 前 120 場）
```

## 預設玩家

- 前端：`web/src/App.tsx` 的 `DEFAULT_PLAYER`（目前 **221145**）
- 每日預熱：`worker/wrangler.toml` 的 `WARM_PLAYERS`（目前 `"221145:39"`）
- 使用者自己切換過的玩家會存在 `localStorage["rta:player"]`；
  換 `DEFAULT_PLAYER` 時會**自動遷移一次**（`rta:defaultPlayer` 版本標記），
  舊的預設不會一直黏著。

要再加第二位常看的玩家：`WARM_PLAYERS = "221145:39,123456:39"`（每日多花約 4 秒額度）。

## 最近查看

每次成功載入（含從 IndexedDB 快取還原）就會把該玩家記進清單：

- 存在 `localStorage["rta:recents"]`，最多 12 筆，同一玩家只留一筆（記最後看的賽季）
- 顯示在內容區最上方，點一下即切換（會一併更新玩家 ID / 賽季輸入框與 `localStorage`）
- 右側 `×` 可單筆移除；不會同步到其他裝置，也不含任何帳號資料

## 開發與部署

```bash
# 安裝
npm --prefix worker install
npm --prefix web install

# 本機開發（前端）
npm run dev                 # http://localhost:5174

# 本機開發（Worker，需要 wrangler login）
npm run api:dev             # http://localhost:8787

# 型別檢查 + 兩邊一起部署
npm run deploy
```

單獨部署：

```bash
npm run api:deploy          # worker
npm run deploy:web          # Pages
```

`web/.env` 的 `VITE_API_BASE` 指向 Worker；換網域時改這裡再重新 build。

---

## 成本與額度（免費方案）

| 資源 | 免費額度 | 這個站的用量 |
| --- | --- | --- |
| Browser Rendering | 10 分鐘／天（以 session 存活時間計） | 每日 cron 1 次 ≈ 20 秒；手動瀏覽再 0–2 次 |
| Workers | 100,000 請求／天 | 個位數 |
| KV | 100,000 讀／天、1 GB | 個位數 |

每日 cron 只預熱 `WARM_PLAYERS` 清單（`worker/wrangler.toml`，目前 `221145:39`），大約 4 秒瀏覽器時間。
額度接近上限（570 秒）時 Worker 會自動停抓、只回 KV，不會把剩下的額度撞成 429。
真的需要更多：Workers Paid（US$5/月）含更多 Browser Rendering 分鐘。

## 換賽季

1. 前端預設賽季在 `web/src/App.tsx` 的 `DEFAULT_SEASON`（目前 39）。
2. `worker/wrangler.toml` 的 `WARM_PLAYERS` 改成新賽季。
3. 重新 `npm run deploy`。

使用者也可以直接在網頁上改「賽季」欄位，選擇會存在 localStorage。

## 要完全移除

```bash
npx wrangler delete --name rta-draft-api
npx wrangler kv namespace delete --namespace-id 47c4f3e6931c4992b8a743cbdb8aff56
npx wrangler pages project delete rta-draft-lab
```

---

## 備註

- 沒有符文快照：lucksack 不提供符文，所以無法還原「當時那場的配裝」。
- 只有 BP + 勝負 + 分數，不是逐回合 replay。
- 自動化抓取他人網站屬灰色地帶；此站只在需要時抓、有快取、不公開代理其他網站。
