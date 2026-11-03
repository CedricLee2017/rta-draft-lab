/**
 * 已經在本機用 tools/fetch_player.py 抓好、寫進 Worker KV 的玩家。
 *
 * 這些資料**不佔用 Cloudflare Browser Rendering 額度**：
 * 前端按一下只會呼叫 `?cache=1`（唯讀 KV），不會開瀏覽器。
 * 目前只保留使用者指定的三位（S39）。
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
    id: 221145,
    name: "xXLaVarXx",
    note: "S39 1433 分・Oliver / Ethna / Ramael 混合",
  },
  {
    id: 188475,
    name: "빛암은샷건이죠",
    note: "S39 1303 分・Shi Hou / Sekhmet / Pure Vanilla 控制",
  },
  {
    id: 254018,
    name: "MayorBen√",
    note: "S39 1295 分・Shizuka / Vivachel / Hwoarang 核心",
  },
];
