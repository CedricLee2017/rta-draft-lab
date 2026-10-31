/** BP / 勝率統計：全部是純函式，可在前端 16ms 內重算整季 768 場 */

import type { RtaMatch } from "./types";

export type Side = "my" | "opp";

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null);

export interface Tally {
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
}

export function emptyTally(): Tally {
  return { games: 0, wins: 0, losses: 0, draws: 0, winRate: null };
}

export function addResult(t: Tally, won: boolean | null): void {
  t.games++;
  if (won === true) t.wins++;
  else if (won === false) t.losses++;
  else t.draws++;
}

export function finishTally<T extends Tally>(t: T): T {
  return { ...t, winRate: pct(t.wins, t.wins + t.losses) };
}

export function overview(matches: RtaMatch[]): Tally {
  const t = emptyTally();
  for (const m of matches) addResult(t, m.won);
  return finishTally(t);
}

// ───────────────────────────── 魔靈 ─────────────────────────────

export interface MonsterStat {
  id: number;
  /** 被選進 5 隻的次數 */
  drafted: number;
  /** 被 ban 的次數 */
  banned: number;
  /** 實際出戰（drafted - banned） */
  played: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number | null;
  draftRate: number;
  banRate: number;
  playRate: number;
  /** 這隻被 ban 的場次，最後的勝率（= 少了它還能不能贏） */
  bannedWinRate: number | null;
  bannedGames: number;
  bannedWins: number;
}

interface Acc {
  drafted: number;
  banned: number;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  bg: number;
  bw: number;
}

/**
 * side = "my"  → 我的選角；myBan 是「我被 ban 的那隻」
 * side = "opp" → 對手的選角；oppBan 是「被我 ban 的那隻」
 */
export function monsterStats(matches: RtaMatch[], side: Side): MonsterStat[] {
  const acc = new Map<number, Acc>();
  const n = matches.length;

  for (const m of matches) {
    const list = side === "my" ? m.my : m.opp;
    const ban = side === "my" ? m.myBan : m.oppBan;
    const win = side === "my" ? m.won === true : m.won === false;
    const loss = side === "my" ? m.won === false : m.won === true;
    const draw = m.won === null;

    for (const id of list) {
      if (!id) continue;
      let e = acc.get(id);
      if (!e) {
        e = { drafted: 0, banned: 0, played: 0, wins: 0, losses: 0, draws: 0, bg: 0, bw: 0 };
        acc.set(id, e);
      }
      e.drafted++;

      if (id === ban) {
        e.banned++;
        e.bg++;
        if (win) e.bw++;
        continue;
      }

      e.played++;
      if (win) e.wins++;
      else if (loss) e.losses++;
      else if (draw) e.draws++;
    }
  }

  const out: MonsterStat[] = [];
  for (const [id, e] of acc) {
    out.push({
      id,
      drafted: e.drafted,
      banned: e.banned,
      played: e.played,
      wins: e.wins,
      losses: e.losses,
      draws: e.draws,
      winRate: pct(e.wins, e.wins + e.losses),
      draftRate: pct(e.drafted, n) ?? 0,
      banRate: pct(e.banned, n) ?? 0,
      playRate: pct(e.played, n) ?? 0,
      bannedWinRate: pct(e.bw, e.bg),
      bannedGames: e.bg,
      bannedWins: e.bw,
    });
  }

  out.sort((a, b) => b.drafted - a.drafted || b.played - a.played || a.id - b.id);
  return out;
}

// ───────────────────────────── 對位 ─────────────────────────────

export interface PairStat {
  myId: number;
  oppId: number;
  games: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

/** 只計算「雙方實際出戰」的 4v4 組合 */
export function matchupStats(matches: RtaMatch[]): PairStat[] {
  const acc = new Map<string, { games: number; wins: number; losses: number }>();

  for (const m of matches) {
    const mine = m.my.filter((id) => id && id !== m.myBan);
    const theirs = m.opp.filter((id) => id && id !== m.oppBan);
    const win = m.won === true;
    const loss = m.won === false;

    for (const a of mine) {
      for (const b of theirs) {
        const key = `${a}:${b}`;
        let e = acc.get(key);
        if (!e) {
          e = { games: 0, wins: 0, losses: 0 };
          acc.set(key, e);
        }
        e.games++;
        if (win) e.wins++;
        else if (loss) e.losses++;
      }
    }
  }

  const out: PairStat[] = [];
  for (const [key, e] of acc) {
    const [a, b] = key.split(":");
    out.push({
      myId: Number(a),
      oppId: Number(b),
      games: e.games,
      wins: e.wins,
      losses: e.losses,
      winRate: pct(e.wins, e.wins + e.losses),
    });
  }
  return out;
}

// ───────────────────────────── 首搶 ─────────────────────────────

export function firstPickSplit(matches: RtaMatch[]): { first: Tally; second: Tally } {
  const first = emptyTally();
  const second = emptyTally();
  for (const m of matches) addResult(m.firstPick ? first : second, m.won);
  return { first: finishTally(first), second: finishTally(second) };
}

// ───────────────────────────── 對手 ─────────────────────────────

export interface OppStat extends Tally {
  id: number;
  name: string;
  lastSeen: string;
  score: number | null;
  bracket: number | null;
}

export function opponentStats(matches: RtaMatch[]): OppStat[] {
  const acc = new Map<number, OppStat>();

  for (const m of matches) {
    if (!m.oppId) continue;
    let e = acc.get(m.oppId);
    if (!e) {
      e = {
        id: m.oppId,
        name: m.oppName,
        lastSeen: m.time,
        score: m.oppScore,
        bracket: m.oppBracket,
        ...emptyTally(),
      };
      acc.set(m.oppId, e);
    }
    e.games++;
    if (m.won === true) e.wins++;
    else if (m.won === false) e.losses++;
    else e.draws++;

    if (Date.parse(m.time) > Date.parse(e.lastSeen)) {
      e.lastSeen = m.time;
      e.name = m.oppName || e.name;
      e.score = m.oppScore;
      e.bracket = m.oppBracket;
    }
  }

  const out = [...acc.values()].map(finishTally);
  out.sort((a, b) => b.games - a.games || (a.winRate ?? 100) - (b.winRate ?? 100));
  return out;
}

// ───────────────────────────── 組合 ─────────────────────────────

export interface ComboStat extends Tally {
  a: number;
  b: number;
}

/** 我方「同時實際出戰」的雙人組合 */
export function comboStats(matches: RtaMatch[], minGames = 6): ComboStat[] {
  const acc = new Map<string, Tally & { a: number; b: number }>();

  for (const m of matches) {
    const mine = m.my.filter((id) => id && id !== m.myBan).sort((x, y) => x - y);
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        const key = `${mine[i]}:${mine[j]}`;
        let e = acc.get(key);
        if (!e) {
          e = { a: mine[i], b: mine[j], ...emptyTally() };
          acc.set(key, e);
        }
        addResult(e, m.won);
      }
    }
  }

  const out: ComboStat[] = [];
  for (const e of acc.values()) {
    if (e.games >= minGames) out.push(finishTally(e));
  }
  out.sort((a, b) => b.games - a.games || (b.winRate ?? 0) - (a.winRate ?? 0));
  return out;
}

// ───────────────────────────── 隊長 ─────────────────────────────

export interface LeaderStat extends Tally {
  id: number;
}

export function leaderStats(matches: RtaMatch[]): LeaderStat[] {
  const acc = new Map<number, Tally>();
  for (const m of matches) {
    if (!m.myLeader) continue;
    let e = acc.get(m.myLeader);
    if (!e) {
      e = emptyTally();
      acc.set(m.myLeader, e);
    }
    addResult(e, m.won);
  }
  return [...acc.entries()]
    .map(([id, t]) => ({ id, ...finishTally(t) }))
    .sort((a, b) => b.games - a.games);
}
