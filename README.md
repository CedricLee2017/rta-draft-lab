# RTA Draft Lab

魔靈召喚（Sky Arena）RTA 對戰紀錄與 BP 分析。
**線上使用：<https://rta-draft-lab-live.pages.dev>**　｜　**原始碼：<https://github.com/CedricLee2017/rta-draft-lab>**　｜　**下載最新版本：<https://github.com/CedricLee2017/rta-draft-lab/archive/refs/heads/main.zip>**

> 舊網址 <https://rta-draft-lab.pages.dev> 會自動 301 轉到新站 <https://rta-draft-lab-live.pages.dev>。

- **預設玩家：`221145`（xXLaVarXx）** ← 打開網站直接看這位
- 可以一次抓一段賽季（例如 37–39），再用「顯示」選單只看 38–39 或單一賽季
- 每天只自動抓 1 次（cron，給 `221145`）；平常不主動抓，避免用掉免費額度
- 抓過的資料存在瀏覽器，可「下載存檔／匯入存檔」帶到手機，也能安裝成 App 離線看
- 「BP 深度」分頁：開場習慣、後手 2 pick 應對、ban 效益、速度線、對手威脅、核心組合
- 「模擬 BP」分頁：你當對手，AI 依目前賽季的紀錄自動選角／ban
- 首頁有 QR code：手機／平板掃描直接開；上方「▦ 手機開啟」隨時可叫出
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

## 對局卡片

每張卡片的排列跟 lucksack 的對局列表一致：

```
勝利／敗北 | 頭像・名稱・分數 | 我方 5 隻（3 欄 × 2 列） | ⚔ | 對手 5 隻（3 欄 × 2 列） | 頭像・名稱・分數
```

- **每一欄 = 一次選秀回合**：首搶方是 `1｜4/5｜8/9`，後手方是 `2/3｜6/7｜10`
- 那一輪只有一隻時（首搶方的第 1 手、後手方的第 10 手），該隻會**垂直置中**、橫跨上下兩排
  （所以後手時，靠近 ⚔ 的兩隻＝我的第 10 手與對方的第 1 手，兩隻都置中）
- 每隻魔靈右下角的數字就是**選秀順位**（1–10），一眼看出誰首搶
- 首搶方的第一隻會標黃色 **1ST**
- 被 ban 的那隻會灰階 + 紅斜線
- 時間顯示相對時間（`11 小時前`／`3 天前`），滑鼠移上去看完整時間
- 頭像：我方用玩家頭像；對手頭像需要新抓的資料才有（舊存檔沒有 `oppImage` 就顯示名稱首字）
- 手機版自動改成三行：結果 → 我方 → 對手

---

## API

```
GET /api/player?player=174018&season=39[&full=1][&refresh=1]
GET /api/health[?browser=1]
```

- `full=1`：忽略增量基底，整季重抓
- `refresh=1`：忽略 60 分鐘新鮮度，強制重新抓取（仍會用 KV 舊資料當增量基底）
- 抓取失敗但有舊資料時，回舊資料並附 `stale: true` + `warning`
- 多賽季由前端**逐季**呼叫這支 API（Worker 不需要改），每季各自快取在 KV
- 已結束的賽季會回 `sealed: true`：Worker 不再重抓、KV 存一年，前端有本機存檔就不再連網

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
  2. 你要看的玩家／賽季在 KV 裡沒有資料，或資料超過 60 分鐘
  3. 你按「強制更新」
- 抓多個賽季時是**逐季**請求（S39 → S38 → S37），前一個完成才抓下一個，
  避免同時開多個瀏覽器撞 429；KV 已新鮮的賽季不會再開瀏覽器。
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
      "bracket": 16, "oppBracket": 16, "myImage": "...", "oppImage": "..." }
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
│  ├─ fetch_player.py     本機抓單一玩家 → payload.json（不耗 Cloudflare 額度）
│  ├─ make_monster_data.py 從 sw-tick-lab 圖鑑產生前端魔靈清單
│  ├─ make_icons.py       產生 PWA 圖示（Pillow）
│  ├─ make_qr.py          產生首頁 QR code（web/public/qr-live.svg）
│  └─ publish.mjs         一鍵 git add / commit / push（npm run publish）
└─ web/
   ├─ src/App.tsx         篩選、分頁、資料載入（stale-while-revalidate）
   ├─ src/lib/stats.ts    純函式統計（選角 / ban / 對位 / 組合 / 首搶）
   ├─ src/lib/bp.ts       BP 深度分析（開場 / 後手應對 / ban 效益 / 速度線 / 威脅 / 核心）
   ├─ src/lib/draft-sim.ts BP 模擬器（歷史選角模型 / 加權抽樣 / ban 模型 / 狀態機）
   ├─ src/lib/api.ts      fetch + IndexedDB 快取
   ├─ src/lib/archive.ts  存檔（列出／匯出／匯入）
   ├─ src/lib/recents.ts  「最近查看」玩家清單（localStorage）
   ├─ src/lib/site.ts     正式站網址（QR／分享連結）
   ├─ src/components/     對局卡、魔靈選單、統計面板、BP 分析、BP 模擬器、QR code、存檔列
   └─ public/
      ├─ manifest.webmanifest  PWA 設定
      ├─ sw.js                service worker（離線開啟）
      ├─ qr-live.svg         首頁 QR code
      ├─ icons/               App 圖示
      └─ sample-matches.json  示範資料（S39 前 120 場）
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

## 多賽季

上方「賽季範圍」可以填一段（例如 `37 – 39`），按載入後會**逐季**抓取（一次一個請求，
避免同時開多個瀏覽器撞 429），每一季各自存進 KV 與瀏覽器。

抓到之後，「顯示」選單可以只看其中一段或單一賽季：

| 載入 | 顯示 | 結果 |
| --- | --- | --- |
| 37–39 | 37–39 | 1399 場（603 + 440 + 356） |
| 37–39 | 38–39 | 796 場 |
| 37–39 | 39 | 356 場（卡片不再顯示賽季標籤） |

- 標題的賽季 chip 會顯示 `S37–39`，卡片右上角多一個 `S38` 標籤（只有在看多個賽季時出現）
- 統計、篩選、下載存檔都以「顯示範圍」為準；下載會包含所有已載入的賽季
- 一次最多 6 個賽季（`to - from ≤ 5`），太多會請你先縮小範圍
- 某個賽季抓不到（沒有資料／額度用完）時，其他賽季照常顯示，上方會列出失敗的賽季
- 顯示範圍只會列出真的抓到資料的賽季；例如 40 還沒開季就不會出現在選單
- **已結束的賽季自動封存**：Worker 回 `sealed: true`、KV 存一年；前端只要本機有存檔就不再連網
  （所以 S37/S38 抓過一次後，之後看 37–39 只會更新 S39）

## 精準條件

每一邊最多可以選 **5 隻**，選完後下方會出現「條件列」，可以逐隻指定位置：

```
我方  [圖示] 任一手▾   [圖示] 任一手▾
對手  [圖示] 任一手▾   [圖示] 首選▾   [圖示] 被 ban▾ …
```

| 位置 | 意思 |
| --- | --- |
| 任一手 | 該方 5 隻裡有這隻就好（選多隻＝全部都要有） |
| 首選 | 這隻必須是該方**第 1 手**（卡片上該隊的第一隻） |
| 被 ban | 這隻必須是該方**被 ban 掉**的那隻 |

- 「首選」「被 ban」每邊各只能有一個：設定新的會自動把舊的取消（避免出現不可能的組合）
- 再配合「首搶方」（全部／我方首搶／對手首搶）、勝負、對手名稱、賽季範圍，**所有條件是 AND**
- 已套用的條件會以標籤顯示在統計條，例如：

```
顯示 1 場  勝率 100.0%  S37–39  [對手首搶] [對手 Haegang、Woosa（首選 Haegang；被 ban Woosa）]
```

常用例子（221145・S37–39 實測）：

| 條件 | 結果 |
| --- | --- |
| 對手首搶 ＋ 對手首選 Haegang | 21 場 |
| 對手首搶 ＋ 對手有 Haegang（不限定第幾手） | 52 場 |
| 對手首搶 ＋ 對手有 Haegang、Woosa ＋ Haegang 首選 ＋ Woosa 被 ban | 1 場（100%） |
| 我的 Sonia 被 ban | 32 場 |
| 我首搶又贏、且對手有 Woosa | 首搶方＝我方首搶 ＋ 勝 ＋ 對手 Woosa |

## BP 深度分析

「BP 深度」分頁（在「對局／統計分析」旁邊）把 BP 習慣拆成六個角度，
**全部跟著目前篩選走**：例如先套用「對手首搶」，再切到 BP 深度，就只分析對手先手的那些場。

| 分頁 | 內容 |
| --- | --- |
| 開場 | 首搶／後手勝率、速度隊長使用率；我方首搶的第一手、我方後手的第一手；對手首搶／後手的第一手對應勝率 |
| 後手應對 | 對手先手時，對手首搶某隻 → 我的第 2、3 手最常怎麼配、佔比與勝率；可點組合看對手接著的 4/5 手、單隻第 2/3 手勝率 |
| Ban 效益 | 對手出過某隻時「ban vs 不 ban」的勝率差（各 ≥10 場，Δ 為正＝ban 有效）；我的角色被 ban 後勝率 vs 有出戰勝率 |
| 速度線 | 我方最快 4 隻 vs 對手、前二平均速度差分佈、速度落後時的隊長／輔助配置勝率 |
| 威脅與核心 | 對手實際出戰的魔靈 → 我的勝率（≥15 場，越低越難打）；有帶／沒帶某隻的勝率差（≥25 場） |
| 組合 | 同時出戰 ≥15 場的雙人組合，依勝率排序 |

### 後手 2 pick 應對

「後手應對」只取 `firstPick = false`（對手先手）的對局，依對手第一手分組：

- **對手首搶 Oliver → 我的第 2、3 手最常出什麼**：直接看「最常應對」與該組合勝率
- 點一列展開：2 pick 組合排行（場數、佔比、勝率、與此開局平均差）、單隻第 2/3 手勝率、對手接著的 4/5 手
- 同時顯示這隻首搶「實際出戰 / 被我 ban」的勝率，避免把 ban 掉與真的打到的場次混在一起
- 「vs 後手平均」可看出這個對手開局你是打得好還是不好
- 例：221145・S37–39，對手首搶 Oliver 46 場、我的勝率 63.0%；最常出 Xing Zhe + Sekhmet（19 場、41%、52.6%），≥3 場中勝率最高是 Megumi Fushiguro + Stark（5 場、100%）

> 注意：資料沒有官方逐手順序，`my[0]`、`my[1]` 是陣列順序近似；不過第 2、3 手是同一個連續選秀區塊，**2 pick 組合本身不受順序影響**。樣本小的組合（<3 場）只看趨勢，不要當成因果。

資料來源：`web/src/data/monsters.json` 現在包含 `spd`（基礎速度）、`arch`（Attack／Support／HP／Defense）、
`sl`（速度隊長技能 %），由 `tools/make_monster_data.py` 從 sw-tick-lab 圖鑑產生。

> 限制：沒有符文與實際速度，速度是「基礎速度＋隊長技能」的推估；也沒有逐手選角順序（用陣列順序近似）；
> ban 是反應而不是隨機分配，所以「ban 後勝率」只能當作线索，不能直接當因果。

## 模擬 BP

「模擬 BP」分頁讓你當對手，AI 當目前查看的玩家（例如 221145），依目前顯示賽季的對局紀錄自動選角／ban。

- 可選 **AI 先手／後手**（預設 AI 後手，你先搶）
- 10 pick + 2 ban（RTA 標準：選完 5 隻後，各 ban 對手 1 隻）
- AI 選角：
  - 後手第 2 手：對手首搶 → 我的 2 pick 分布（直接重用上面的「後手應對」）
  - 第 3 手：對手首搶 + 我第 2 手 → 第 3 手分布
  - 其他手：該手歷史分布 + 雙方陣容 co-occurrence + 速度隊長／輔助組成
  - 樣本不足時 backoff 到整體習慣
- AI 風格：**照習慣（加權抽樣）** 或 **最常出（固定最佳）**
- AI ban：依對手 5 隻的歷史被 ban 率 + 對手勝率 + 出場率
- 每一步 AI 都會在「選秀紀錄 / AI 依據」標示樣本數
- 使用目前顯示賽季的**全部**對局建模，不受上方勝負／魔靈篩選影響；想看更多樣本把「顯示」拉長（例如 37–39），想看近期習慣只留 S39

> 限制：這是習慣模仿，不是最佳解或因果預測。樣本少、或你選了歷史沒出現的組合時，AI 會退回整體習慣。

## 選擇魔靈

篩選列上的「我方／對手」按鈕會開啟選擇視窗，操作方式跟 lucksack 一樣：

- **搜尋**：英文名稱或 ID（例：`Sonia`、`26113`）
- **元素**：全部／水／火／風／光／暗（彩色圓點）
- **胎生星級**：1★–5★
- **只顯示已覺醒**：隱藏未覺醒原名（資料裡的 `awk = 0`，約 837 隻）
- 點圖示加入／移出，最多 5 隻；按 **完成** 才套用，關閉視窗或按 Esc 不會改動原本的篩選
- 底部顯示已選魔靈（點一下可移除）與 `n/5`
- 沒有搜尋／篩選時，清單依「你這季最常出場」排序；有搜尋或篩選時依名稱排序
- 一次最多先渲染 240 隻（1987 隻全畫會卡），上方會提示用條件縮小範圍

## 存檔與離線

抓到的每一份資料都會自動存進瀏覽器（IndexedDB，key 為 `rta:<玩家>:<賽季>`），
所以**抓過一次就不用再抓**；額度用完、斷網、甚至之後換賽季，都還能翻舊資料。

畫面最上方的存檔列：

| 按鈕 | 作用 |
| --- | --- |
| **↓ 下載存檔** | 把這台裝置上所有存檔打包成一個 JSON 下載（手機會存到「檔案」） |
| **↑ 匯入存檔** | 讀回先前下載的 JSON（例如電腦下載 → 手機匯入），不用重新抓 |
| **▣ 安裝 App** | 加到手機主畫面（見下一節） |

- 下載檔名：單筆 `rta-221145-S39-20261031-1401.json`；多筆 `rta-archive-20261031-1401.json`
- 檔案格式：`{ app, version, exportedAt, items: [MatchPayload, ...] }`，內容就是 API 回應，可直接用文字編輯器看
- 存檔只留在自己的裝置，**不會上傳**；換手機或清瀏覽器資料前記得先下載
- 讀不到網路時，App 會自動改用本機存檔並顯示黃色「顯示快取資料」提示

## 安裝成 App（PWA）

`manifest.webmanifest` + `sw.js` 讓網站可以像 App 一樣開啟（全螢幕、有自己的圖示、可離線）：

- **Android（Chrome）**：右上 ⋮ →「安裝應用程式」或「加到主畫面」；
  網站也會自己跳出「安裝 App」按鈕（`beforeinstallprompt`）
- **iPhone / iPad**：**只能用 Safari** → 下方分享 ⤴ →「加入主畫面」（iOS 不支援 Chrome 安裝 PWA）
- **電腦（Chrome / Edge）**：網址列右側的安裝圖示

安裝後的行為：

- 開啟時不顯示瀏覽器網址列（`display: standalone`）
- `sw.js` 會快取 App 外殼，斷網仍可開啟並讀取 IndexedDB 裡的存檔
- 手機桌面長按圖示有捷徑「看 221145」（也就是 `?player=221145&season=39`）

> 換版後若手機仍開到舊畫面：關掉 App 再開一次即可（`sw.js` 改版時會自動換新快取）。
> service worker 只在 production build 註冊，本機 `npm run dev` 不會被快取。

## 首頁 QR code

首頁 hero 與上方工具列都有 QR code，手機／平板掃描後直接開正式站：

- 首頁 hero：`QrCard`（桌機／平板顯示）
- 工具列：**▦ 手機開啟** → 彈出同一個 QR code（預設玩家載入後仍可用）
- 手機版會隱藏 QR，避免自己掃自己的螢幕

QR 圖檔是 `web/public/qr-live.svg`，由 `tools/make_qr.py` 產生，**不依賴外部 QR 服務**，離線也能顯示。

換網址時：

```bash
# 1. 改 web/src/lib/site.ts 的 SITE_URL
# 2. 重新產生 QR（需要 pip install segno）
python tools/make_qr.py
```

（也可以直接指定網址：`python tools/make_qr.py https://你的新網址`）

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
npm run deploy:web          # Pages（rta-draft-lab-live；平常 push 會自動部署）
```

`web/.env` 的 `VITE_API_BASE` 指向 Worker；換網域時改這裡再重新 build。

---

## 自動上傳與最新版本

| 用途 | 網址 |
| --- | --- |
| GitHub 原始碼 | <https://github.com/CedricLee2017/rta-draft-lab> |
| 最新版本 ZIP | <https://github.com/CedricLee2017/rta-draft-lab/archive/refs/heads/main.zip> |
| 版本紀錄 | <https://github.com/CedricLee2017/rta-draft-lab/commits/main> |
| 線上網站（自動部署） | <https://rta-draft-lab-live.pages.dev> |
| 舊網址（301 轉址） | <https://rta-draft-lab.pages.dev> |

### 平常更新：一行指令

```powershell
npm run publish -- "這次改了什麼"
```

`tools/publish.mjs` 會依序：

1. `git add -A`
2. 有變更才 `git commit -m "..."`（沒有變更就跳過）
3. `git push origin main`
4. 印出 GitHub、最新 ZIP、線上網站網址

### push 之後會發生什麼

- GitHub 立即保存原始碼（這就是「最新版本」的來源）
- Cloudflare Pages 專案 `rta-draft-lab-live` 已接上 GitHub：push 到 `main` 會**自動 build `web/` 並部署**
- 約 1–3 分鐘後 <https://rta-draft-lab-live.pages.dev> 更新
- 舊網址 <https://rta-draft-lab.pages.dev> 會 301 轉到新站
- 手機 App 若還開到舊版：關掉再開一次

> 如果你之前把舊網址安裝成手機 App，建議用新網址 <https://rta-draft-lab-live.pages.dev>
> 重新「加到主畫面」一次；舊 App 會轉到新站，但獨立視窗要用新網址安裝。

### 下載最新版本

- 直接下載 ZIP：<https://github.com/CedricLee2017/rta-draft-lab/archive/refs/heads/main.zip>
- 或到 GitHub 專案首頁 → 綠色 **Code** → **Download ZIP**
- 想看每次改了什麼：<https://github.com/CedricLee2017/rta-draft-lab/commits/main>

> `rta-draft-lab`（舊 Pages 專案）現在只放轉址頁，不要再把完整網站部署到那裡；
> 完整網站請部署到 `rta-draft-lab-live`（push 會自動處理）。

### Worker 要另外部署

Cloudflare Pages 只負責前端。改到 `worker/`（API、KV、Browser Rendering）時，還是要手動：

```powershell
npm run api:deploy
```

只改前端（`web/`）時，`npm run publish` 就夠了，不需要再跑 `deploy`。

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

使用者也可以直接在網頁上改賽季範圍，選擇會存在 localStorage（`rta:seasonFrom` / `rta:seasonTo`）。
新訪客預設只抓當前賽季；想看舊賽季把「賽季範圍」改成 `37 – 39` 即可，之後會自動沿用。

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
