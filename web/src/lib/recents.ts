/**
 * 「最近查看的玩家」清單，存在 localStorage。
 *
 * 只存公開的 RTA 資料（玩家 ID、遊戲內名稱、最後查看的賽季範圍），
 * 不涉及任何帳號或個人資料，換裝置不會同步。
 */

export interface RecentPlayer {
  id: number;
  username: string;
  country: string;
  /** 最後查看的賽季範圍（from ≤ to） */
  from: number;
  to: number;
  /** 最後查看時間（ms） */
  at: number;
}

const KEY = "rta:recents";
const MAX = 12;

interface LegacyRecent {
  id: number;
  season?: number;
  from?: number;
  to?: number;
  username?: unknown;
  country?: unknown;
  at?: unknown;
}

function normalize(v: unknown): RecentPlayer | null {
  if (!v || typeof v !== "object") return null;
  const r = v as LegacyRecent;
  if (!Number.isInteger(r.id) || r.id <= 0) return null;

  const single = Number(r.season);
  const from = Number(r.from ?? single);
  const to = Number(r.to ?? single ?? r.from);
  if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) return null;

  return {
    id: r.id,
    username: typeof r.username === "string" ? r.username : "",
    country: typeof r.country === "string" ? r.country : "",
    from: Math.min(from, to),
    to: Math.max(from, to),
    at: typeof r.at === "number" ? r.at : 0,
  };
}

export function loadRecents(): RecentPlayer[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list
      .map(normalize)
      .filter((r): r is RecentPlayer => !!r)
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
  from: number,
  to: number,
): RecentPlayer[] {
  if (!Number.isInteger(player.id) || player.id <= 0) return loadRecents();

  const list = loadRecents().filter((r) => r.id !== player.id);
  list.unshift({
    id: player.id,
    username: player.username?.trim() ?? "",
    country: player.country ?? "",
    from: Math.min(from, to),
    to: Math.max(from, to),
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
