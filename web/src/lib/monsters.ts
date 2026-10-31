import raw from "../data/monsters.json";

export interface Monster {
  id: number;
  name: string;
  /** 1=水 2=火 3=風 4=光 5=暗 */
  el: number;
  /** 原生星數 */
  nat: number;
  /** 0=未覺醒原名 1=已覺醒 2=二次覺醒 */
  awk: number;
  icon: string;
  /** 基礎速度 */
  spd: number;
  /** Attack / Defense / Support / HP */
  arch: string;
  /** 速度隊長技能 %（0 = 沒有） */
  sl: number;
}

export const MONSTERS = raw as Monster[];

export const MONSTER_MAP = new Map<number, Monster>(MONSTERS.map((m) => [m.id, m]));

export const ELEMENTS: Record<number, { name: string; cls: string }> = {
  1: { name: "水", cls: "water" },
  2: { name: "火", cls: "fire" },
  3: { name: "風", cls: "wind" },
  4: { name: "光", cls: "light" },
  5: { name: "暗", cls: "dark" },
};

/** 與 sw-tick-lab 使用同一套頭像來源（檔名完全一致） */
export const ICON_BASE = "https://swarfarm.com/static/herders/images/monsters/";

export function monsterOf(id: number): Monster | undefined {
  return MONSTER_MAP.get(id);
}

export function monsterName(id: number): string {
  return MONSTER_MAP.get(id)?.name ?? `#${id}`;
}

export function iconUrl(id: number): string {
  const m = MONSTER_MAP.get(id);
  return m ? ICON_BASE + m.icon : "";
}

export function monsterSpeed(id: number): number {
  return MONSTER_MAP.get(id)?.spd ?? 0;
}

export function monsterArch(id: number): string {
  return MONSTER_MAP.get(id)?.arch ?? "";
}

/** 速度隊長技能 %（0 = 不是速度隊長） */
export function speedLeadPct(id: number): number {
  return MONSTER_MAP.get(id)?.sl ?? 0;
}

/** 搜尋：名稱（不分大小寫）或 ID */
export function searchMonsters(query: string, limit = 60): Monster[] {
  const q = query.trim().toLowerCase();
  if (!q) return MONSTERS.slice(0, limit);

  const out: Monster[] = [];
  for (const m of MONSTERS) {
    if (m.name.toLowerCase().includes(q) || String(m.id).includes(q)) {
      out.push(m);
      if (out.length >= limit) break;
    }
  }
  return out;
}
