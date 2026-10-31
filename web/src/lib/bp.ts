/**
 * BP 深度分析：全部都是純函式，吃「目前篩選後」的對局，所以可以
 * 「只看 S38–39」「只看對手首搶」再分析。
 *
 * 注意：資料沒有符文與實際速度，只能用「基礎速度 + 速度隊長技能」推估；
 * 也沒有逐手選角順序（用陣列順序近似）。樣本小的列請保守解讀。
 */

import { monsterArch, monsterSpeed, speedLeadPct } from "./monsters";
import { addResult, emptyTally, finishTally, type Tally } from "./stats";
import type { RtaMatch } from "./types";

const decided = (ms: RtaMatch[]) => ms.filter((m) => m.won !== null);

/** 實際出戰的 4 隻（5 隻扣掉被 ban 的） */
export function played(ids: number[], ban: number): number[] {
  return ids.filter((id) => id && id !== ban);
}

// ───────────────────────────── 開場 ─────────────────────────────

export interface OpenerRow {
  id: number;
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

/** 某一方的第一手（my[0] / opp[0]），可再分「我方首搶 / 我方後手」 */
export function openerStats(
  matches: RtaMatch[],
  side: "my" | "opp",
  myFirst: boolean,
): OpenerRow[] {
  const acc = new Map<number, Tally>();
  for (const m of matches) {
    if (m.firstPick !== myFirst) continue;
    const id = (side === "my" ? m.my : m.opp)[0];
    if (!id) continue;
    let t = acc.get(id);
    if (!t) {
      t = emptyTally();
      acc.set(id, t);
    }
    addResult(t, m.won);
  }
  return [...acc.entries()]
    .map(([id, t]) => ({ id, ...finishTally(t) }))
    .sort((a, b) => b.games - a.games);
}

// ───────────────────────────── Ban ─────────────────────────────

export interface BanImpactRow {
  id: number;
  /** 對手在 5 隻裡出現這隻的場數 */
  faced: number;
  banned: number;
  banRate: number;
  banGames: number;
  banWinRate: number | null;
  openGames: number;
  openWinRate: number | null;
  /** ban 後勝率 − 不 ban 勝率（正的 = ban 有效） */
  delta: number | null;
}

/** 對手出過哪些角、我 ban 與不 ban 的勝率差 */
export function banImpact(matches: RtaMatch[], minFaced = 8): BanImpactRow[] {
  const faced = new Map<number, number>();
  const banned = new Map<number, Tally>();
  const open = new Map<number, Tally>();

  for (const m of matches) {
    for (const id of m.opp) {
      if (!id) continue;
      faced.set(id, (faced.get(id) ?? 0) + 1);
      const isBanned = id === m.oppBan;
      const map = isBanned ? banned : open;
      let t = map.get(id);
      if (!t) {
        t = emptyTally();
        map.set(id, t);
      }
      addResult(t, m.won);
    }
  }

  const out: BanImpactRow[] = [];
  for (const [id, count] of faced) {
    if (count < minFaced) continue;
    const b = finishTally(banned.get(id) ?? emptyTally());
    const o = finishTally(open.get(id) ?? emptyTally());
    const delta =
      b.winRate !== null && o.winRate !== null ? b.winRate - o.winRate : null;
    out.push({
      id,
      faced: count,
      banned: b.games,
      banRate: count ? (b.games / count) * 100 : 0,
      banGames: b.games,
      banWinRate: b.winRate,
      openGames: o.games,
      openWinRate: o.winRate,
      delta,
    });
  }
  return out.sort((a, b) => b.faced - a.faced);
}

export interface BannedAgainstRow {
  id: number;
  /** 被對手 ban 掉幾次 */
  banned: number;
  bannedWinRate: number | null;
  /** 實際出戰幾場、勝率 */
  playedGames: number;
  playedWinRate: number | null;
}

/** 我的角色被 ban 時，勝率掉多少 */
export function bannedAgainst(matches: RtaMatch[], minBanned = 5): BannedAgainstRow[] {
  const banTally = new Map<number, Tally>();
  const playTally = new Map<number, Tally>();

  for (const m of matches) {
    if (m.myBan) {
      let t = banTally.get(m.myBan);
      if (!t) {
        t = emptyTally();
        banTally.set(m.myBan, t);
      }
      addResult(t, m.won);
    }
    for (const id of played(m.my, m.myBan)) {
      let t = playTally.get(id);
      if (!t) {
        t = emptyTally();
        playTally.set(id, t);
      }
      addResult(t, m.won);
    }
  }

  const out: BannedAgainstRow[] = [];
  for (const [id, t] of banTally) {
    if (t.games < minBanned) continue;
    const b = finishTally(t);
    const p = finishTally(playTally.get(id) ?? emptyTally());
    out.push({
      id,
      banned: b.games,
      bannedWinRate: b.winRate,
      playedGames: p.games,
      playedWinRate: p.winRate,
    });
  }
  return out.sort((a, b) => b.banned - a.banned);
}

// ───────────────────────────── 速度 ─────────────────────────────

export interface SpeedOf {
  fastest: number;
  top2: number;
}

export function speedOf(ids: number[], ban: number): SpeedOf {
  const speeds = played(ids, ban)
    .map(monsterSpeed)
    .sort((a, b) => b - a);
  if (!speeds.length) return { fastest: 0, top2: 0 };
  const top2 = speeds.length > 1 ? (speeds[0] + speeds[1]) / 2 : speeds[0];
  return { fastest: speeds[0], top2 };
}

export interface SpeedBucket {
  label: string;
  from: number;
  to: number;
  tally: Tally;
}

export interface SpeedStats {
  faster: Tally;
  slower: Tally;
  equal: Tally;
  buckets: SpeedBucket[];
  speedLead: { games: number; tally: Tally };
  nonSpeedLead: { games: number; tally: Tally };
  /** 我方最快速度落後時的配置 */
  behind: {
    games: number;
    withSpeedLead: Tally;
    withoutSpeedLead: Tally;
    supports: { count: number; tally: Tally }[];
  };
}

export function speedStats(matches: RtaMatch[]): SpeedStats {
  const faster = emptyTally();
  const slower = emptyTally();
  const equal = emptyTally();
  const speedLead = emptyTally();
  const nonSpeedLead = emptyTally();
  const behindGames: RtaMatch[] = [];

  const buckets: SpeedBucket[] = [
    { label: "慢 20 以上", from: -999, to: -20, tally: emptyTally() },
    { label: "慢 5–20", from: -20, to: -5, tally: emptyTally() },
    { label: "相差 ±5 內", from: -5, to: 5, tally: emptyTally() },
    { label: "快 5–20", from: 5, to: 20, tally: emptyTally() },
    { label: "快 20 以上", from: 20, to: 999, tally: emptyTally() },
  ];

  for (const m of matches) {
    const mine = speedOf(m.my, m.myBan);
    const theirs = speedOf(m.opp, m.oppBan);

    if (mine.fastest > theirs.fastest) addResult(faster, m.won);
    else if (mine.fastest < theirs.fastest) addResult(slower, m.won);
    else addResult(equal, m.won);

    const diff = mine.top2 - theirs.top2;
    const bucket = buckets.find((b) => diff >= b.from && diff < b.to);
    if (bucket) addResult(bucket.tally, m.won);

    const lead = speedLeadPct(m.myLeader) > 0;
    addResult(lead ? speedLead : nonSpeedLead, m.won);

    if (mine.fastest < theirs.fastest) behindGames.push(m);
  }

  const behind = {
    games: behindGames.length,
    withSpeedLead: emptyTally(),
    withoutSpeedLead: emptyTally(),
    supports: [0, 1, 2, 3, 4].map((count) => ({ count, tally: emptyTally() })),
  };

  for (const m of behindGames) {
    const lead = speedLeadPct(m.myLeader) > 0;
    addResult(lead ? behind.withSpeedLead : behind.withoutSpeedLead, m.won);
    const supports = played(m.my, m.myBan).filter(
      (id) => monsterArch(id) === "Support",
    ).length;
    const slot = behind.supports[Math.min(supports, 4)];
    if (slot) addResult(slot.tally, m.won);
  }

  return {
    faster: finishTally(faster),
    slower: finishTally(slower),
    equal: finishTally(equal),
    buckets: buckets.map((b) => ({ ...b, tally: finishTally(b.tally) })),
    speedLead: { games: speedLead.games, tally: finishTally(speedLead) },
    nonSpeedLead: {
      games: nonSpeedLead.games,
      tally: finishTally(nonSpeedLead),
    },
    behind: {
      games: behind.games,
      withSpeedLead: finishTally(behind.withSpeedLead),
      withoutSpeedLead: finishTally(behind.withoutSpeedLead),
      supports: behind.supports.map((s) => ({
        count: s.count,
        tally: finishTally(s.tally),
      })),
    },
  };
}

// ───────────────────────────── 威脅 / 核心 ─────────────────────────────

export interface ThreatRow {
  id: number;
  games: number;
  winRate: number | null;
}

/** 對手實際出戰（沒被 ban）的魔靈 → 我的勝率（越低＝他越怕） */
export function threatStats(matches: RtaMatch[], minGames = 10): ThreatRow[] {
  const acc = new Map<number, Tally>();
  for (const m of matches) {
    for (const id of played(m.opp, m.oppBan)) {
      let t = acc.get(id);
      if (!t) {
        t = emptyTally();
        acc.set(id, t);
      }
      addResult(t, m.won);
    }
  }
  return [...acc.entries()]
    .filter(([, t]) => t.games >= minGames)
    .map(([id, t]) => ({ id, games: t.games, winRate: finishTally(t).winRate }))
    .sort((a, b) => (a.winRate ?? 100) - (b.winRate ?? 100));
}

export interface CoreRow {
  id: number;
  withGames: number;
  withWinRate: number | null;
  withoutGames: number;
  withoutWinRate: number | null;
  delta: number | null;
}

/** 有帶 / 沒帶這隻的勝率差 */
export function coreStats(matches: RtaMatch[], minWith = 25): CoreRow[] {
  const ids = new Set<number>();
  for (const m of matches) {
    for (const id of played(m.my, m.myBan)) ids.add(id);
  }

  const withMap = new Map<number, Tally>();
  const withoutMap = new Map<number, Tally>();
  for (const id of ids) {
    withMap.set(id, emptyTally());
    withoutMap.set(id, emptyTally());
  }

  for (const m of matches) {
    const picks = played(m.my, m.myBan);
    const set = new Set(picks);
    for (const id of ids) {
      const t = set.has(id) ? withMap.get(id) : withoutMap.get(id);
      if (t) addResult(t, m.won);
    }
  }

  const out: CoreRow[] = [];
  for (const [id, t] of withMap) {
    const w = finishTally(t);
    if (w.games < minWith) continue;
    const o = finishTally(withoutMap.get(id) ?? emptyTally());
    out.push({
      id,
      withGames: w.games,
      withWinRate: w.winRate,
      withoutGames: o.games,
      withoutWinRate: o.winRate,
      delta:
        w.winRate !== null && o.winRate !== null ? w.winRate - o.winRate : null,
    });
  }
  return out.sort((a, b) => b.withGames - a.withGames);
}

// ───────────────────────────── 摘要 ─────────────────────────────

export interface BpSummary {
  total: number;
  decided: number;
  winRate: number | null;
  firstSplit: { first: Tally; second: Tally };
  speedLeadUse: { games: number; pct: number };
}

export function bpSummary(matches: RtaMatch[]): BpSummary {
  const d = decided(matches);
  const first = emptyTally();
  const second = emptyTally();
  let leadGames = 0;

  for (const m of matches) {
    addResult(m.firstPick ? first : second, m.won);
    if (speedLeadPct(m.myLeader) > 0) leadGames++;
  }

  return {
    total: matches.length,
    decided: d.length,
    winRate: d.length ? (d.filter((m) => m.won === true).length / d.length) * 100 : null,
    firstSplit: { first: finishTally(first), second: finishTally(second) },
    speedLeadUse: {
      games: leadGames,
      pct: matches.length ? (leadGames / matches.length) * 100 : 0,
    },
  };
}
