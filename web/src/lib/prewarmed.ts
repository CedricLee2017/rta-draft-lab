/**
 * 已經在本機用 tools/fetch_player.py 抓好、寫進 Worker KV 的玩家。
 *
 * 這些資料**不佔用 Cloudflare Browser Rendering 額度**：
 * 前端按一下只會呼叫 `?cache=1`（唯讀 KV），不會開瀏覽器。
 * 名單可以由 tools/fetch_player.py 隨時替換，或直接在這裡增減。
 */
export interface PrewarmedPlayer {
  id: number;
  name: string;
  /** 給使用者看的類型說明（不是官方資料，只是抓取時的觀察） */
  note: string;
}

export const PREWARMED_SEASON = 39;

export const PREWARMED_PLAYERS: PrewarmedPlayer[] = [
  {
    id: 283652,
    name: "촌극",
    note: "S39 第 1 名・Vanessa / Shi Hou 速度開局",
  },
  {
    id: 234206,
    name: "暗夜捂者",
    note: "S39 前 15・Nephthys / Devaraja / Woonsa 控制",
  },
  {
    id: 251029,
    name: "S⍺⍴⍴yyy",
    note: "S39 前 30・Shi Hou / Vanessa / Sonia 強攻",
  },
  {
    id: 246157,
    name: "十一月的蕭邦",
    note: "S39 約 1000 名・Wedjat / Narsha 循環",
  },
  {
    id: 235236,
    name: "F.I.R.E",
    note: "S39 約 500 名・Pure Vanilla Cookie / Haegang 坦控",
  },
  {
    id: 221145,
    name: "xXLaVarXx",
    note: "預設玩家・Oliver / Ethna / Ramael 混合",
  },
  {
    id: 205427,
    name: "Monagua",
    note: "S39 約 200 名・Vanessa / Stark，常 ban Beelzebub",
  },
  {
    id: 293776,
    name: "家樂福尼亞",
    note: "S39 約 5800 名・Giana / Oliver / Laima 速度",
  },
];
