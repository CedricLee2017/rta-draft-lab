/**
 * 「最近查看的玩家」清單，存在 localStorage。
 *
 * 只存公開的 RTA 資料（玩家 ID、遊戲內名稱、最後查看的賽季），
 * 不涉及任何帳號或個人資料，換裝置不會同步。
 */

export interface RecentPlayer {
  id: number;
  username: string;
  country: string;
  /** 最後查看的賽季 */
  season: number;
  /** 最後查看時間（ms） */
  at: number;
}

const KEY = "rta:recents";
const MAX = 12;

function isRecent(v: unknown): v is RecentPlayer {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.id === "number" &&
    Number.isInteger(r.id) &&
    r.id > 0 &&
    typeof r.season === "number" &&
    Number.isInteger(r.season)
  );
}

export function loadRecents(): RecentPlayer[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .filter(isRecent)
      .map((r) => ({
        id: r.id,
        username: typeof r.username === "string" ? r.username : "",
        country: typeof r.country === "string" ? r.country : "",
        season: r.season,
        at: typeof r.at === "number" ? r.at : 0,
      }))
      .sort((a, b) => b.at - a.at)
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function save(list: RecentPlayer[]): RecentPlayer[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 無痕模式／空間不足 → 只影響下次能不能快速點回來 */
  }
  return list;
}

/** 記錄一次查看：同一玩家只留一筆，移到最前面 */
export function rememberPlayer(
  player: { id: number; username?: string; country?: string },
  season: number,
): RecentPlayer[] {
  if (!Number.isInteger(player.id) || player.id <= 0) return loadRecents();

  const list = loadRecents().filter((r) => r.id !== player.id);
  list.unshift({
    id: player.id,
    username: player.username?.trim() ?? "",
    country: player.country ?? "",
    season,
    at: Date.now(),
  });
  return save(list.slice(0, MAX));
}

export function forgetPlayer(id: number): RecentPlayer[] {
  return save(loadRecents().filter((r) => r.id !== id));
}

export function clearRecents(): RecentPlayer[] {
  return save([]);
}
