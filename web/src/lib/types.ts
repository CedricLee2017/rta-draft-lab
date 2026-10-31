/** 對戰紀錄的資料模型（Worker 與前端共用同一份格式） */

export interface RtaMatch {
  battleId: number;
  /** ISO 時間字串（含時區） */
  time: string;
  /** true = 勝、false = 負、null = 和局 */
  won: boolean | null;
  /** 我是否首搶 */
  firstPick: boolean;
  /** 我的 5 隻選角 */
  my: number[];
  /** 我的 5 隻裡「被對手 ban 掉」的那隻 */
  myBan: number;
  /** 我的隊長 */
  myLeader: number;
  myScore: number | null;
  /** 對手的 5 隻選角 */
  opp: number[];
  /** 對手的 5 隻裡「被我 ban 掉」的那隻 */
  oppBan: number;
  oppLeader: number;
  oppScore: number | null;
  oppId: number | null;
  oppName: string;
  /** 我方階級（12 = 金 3 … 14 = 金 1） */
  bracket: number | null;
  oppBracket: number | null;
  /** 頭像（lucksack 靜態圖，可能載不到 → 前端顯示名稱首字） */
  myImage?: string;
  oppImage?: string;
}

export interface DailyStat {
  date: string;
  played: number;
  won: number;
}

export interface PlayerSummary {
  username: string;
  country: string;
  image: string;
  rank: number | null;
  score: number | null;
  peak: number | null;
  winRate: number | null;
  total: number | null;
  wins: number | null;
  draws: number | null;
  bestStreak: number | null;
  currentStreak: number | null;
  seasonStart: string | null;
  seasonEnd: string | null;
  daily: DailyStat[];
}

export interface PlayerInfo {
  id: number;
  username: string;
  country?: string;
  image?: string;
}

export interface MatchPayload {
  version: number;
  player: PlayerInfo;
  season: number;
  fetchedAt: string;
  summary: PlayerSummary;
  matches: RtaMatch[];
  total?: number;
  /** 由 Worker 回報：是否為 KV 快取 */
  cached?: boolean;
  ageSeconds?: number;
  /** 抓取失敗、改回舊資料 */
  stale?: boolean;
  warning?: string;
  /** 內建示範資料 */
  sample?: boolean;
}
