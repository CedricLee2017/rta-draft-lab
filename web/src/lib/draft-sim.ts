/**
 * BP 模擬器：用歷史對局建立「這個玩家常怎麼選」的模型。
 *
 * 重要語意：
 *  - AI 永遠是 `my` 那一邊（目前查看的玩家）。
 *  - 使用者是 `opp` 那一邊。
 *  - AI 的 ban = `oppBan`（對手 5 隻裡被我 ban 掉的那隻）。
 *  - 使用者的 ban = `myBan`（我的 5 隻裡被對手 ban 掉的那隻）。
 *
 * 這不是因果模型，只是從歷史分布做加權抽樣；樣本少的局面會 backoff 到整體習慣。
 */

import { MONSTERS, monsterArch, monsterName, speedLeadPct } from "./monsters";
import type { RtaMatch } from "./types";

export type DraftSide = "ai" | "user";
export type AiStyle = "habit" | "top";

export interface DraftPick {
  side: DraftSide;
  id: number;
  slot: number;
}

export interface SimLogEntry {
  side: DraftSide;
  action: "pick" | "ban";
  id: number;
  slot?: number;
  note?: string;
}

export interface DraftModel {
  matches: number;
  aiPool: Set<number>;
  oppPool: Set<number>;
  overall: Map<number, number>;
  oppOverall: Map<number, number>;
  slot: Map<number, Map<number, number>>;
  slotGames: Map<number, number>;
  openerFirst: Map<number, Map<number, number>>;
  openerSecond: Map<number, Map<number, number>>;
  openerSecondGiven: Map<string, Map<number, number>>;
  openerGames: Map<number, number>;
  aiCo: Map<number, Map<number, number>>;
  oppCo: Map<number, Map<number, number>>;
  ban: Map<number, number>;
  banGames: number;
  oppPlayed: Map<number, number>;
  oppWins: Map<number, number>;
}

export interface PickSuggestion {
  id: number;
  score: number;
  /** 給 UI 顯示的依據，例如「對手首搶 Oliver：46 場」 */
  basis: string;
  contextGames: number;
  /** 這隻在該情境下的歷史比例（0–1）；fallback 時是整體比例 */
  rate: number | null;
  alternatives: { id: number; score: number }[];
}

export interface BanSuggestion {
  id: number;
  score: number;
  basis: string;
  alternatives: { id: number; score: number }[];
}

export const FIRST_SLOTS = [1, 4, 5, 8, 9] as const;
export const SECOND_SLOTS = [2, 3, 6, 7, 10] as const;

const ALL_MONSTER_IDS = MONSTERS.map((m) => m.id);

export function slotsFor(side: DraftSide, aiFirst: boolean): readonly number[] {
  const ai = aiFirst ? FIRST_SLOTS : SECOND_SLOTS;
  if (side === "ai") return ai;
  return aiFirst ? SECOND_SLOTS : FIRST_SLOTS;
}

export function sideForSlot(slot: number, aiFirst: boolean): DraftSide {
  const slots: readonly number[] = aiFirst ? FIRST_SLOTS : SECOND_SLOTS;
  return slots.includes(slot) ? "ai" : "user";
}

export function currentSide(picks: DraftPick[], aiFirst: boolean): DraftSide | null {
  if (picks.length >= 10) return null;
  return sideForSlot(picks.length + 1, aiFirst);
}

function bump(map: Map<number, number>, key: number): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function bumpNested(
  map: Map<number, Map<number, number>>,
  a: number,
  b: number,
): void {
  let inner = map.get(a);
  if (!inner) {
    inner = new Map();
    map.set(a, inner);
  }
  bump(inner, b);
}

function bumpKeyed(
  map: Map<string, Map<number, number>>,
  key: string,
  b: number,
): void {
  let inner = map.get(key);
  if (!inner) {
    inner = new Map();
    map.set(key, inner);
  }
  bump(inner, b);
}

function sumMap(map: Map<number, number> | undefined): number {
  if (!map) return 0;
  let n = 0;
  for (const v of map.values()) n += v;
  return n;
}

export function emptyModel(): DraftModel {
  return {
    matches: 0,
    aiPool: new Set(),
    oppPool: new Set(),
    overall: new Map(),
    oppOverall: new Map(),
    slot: new Map(),
    slotGames: new Map(),
    openerFirst: new Map(),
    openerSecond: new Map(),
    openerSecondGiven: new Map(),
    openerGames: new Map(),
    aiCo: new Map(),
    oppCo: new Map(),
    ban: new Map(),
    banGames: 0,
    oppPlayed: new Map(),
    oppWins: new Map(),
  };
}

export function buildDraftModel(matches: RtaMatch[]): DraftModel {
  const model = emptyModel();

  for (const m of matches) {
    const my = m.my.filter((id) => id > 0);
    const opp = m.opp.filter((id) => id > 0);
    if (my.length < 5 || opp.length < 5) continue;

    model.matches++;
    const aiSlots = m.firstPick ? FIRST_SLOTS : SECOND_SLOTS;

    for (let i = 0; i < 5; i++) {
      const id = my[i];
      if (!id) continue;
      const slot = aiSlots[i];
      bump(model.overall, id);
      bumpNested(model.slot, slot, id);
      bump(model.slotGames, slot);
      model.aiPool.add(id);
    }

    for (const id of opp) {
      bump(model.oppOverall, id);
      model.oppPool.add(id);
    }

    // AI 自己的雙人組合（同一隊 5 隻的 co-occurrence）
    for (let i = 0; i < my.length; i++) {
      for (let j = i + 1; j < my.length; j++) {
        bumpNested(model.aiCo, my[i], my[j]);
        bumpNested(model.aiCo, my[j], my[i]);
      }
    }

    // AI 出這隻時，對手陣中有哪些角色
    for (const a of my) {
      for (const b of opp) bumpNested(model.oppCo, a, b);
    }

    // 後手：對手首搶 → 我的第 2、3 手
    if (!m.firstPick && opp[0]) {
      const opener = opp[0];
      bump(model.openerGames, opener);
      bumpNested(model.openerFirst, opener, my[0]);
      bumpNested(model.openerSecond, opener, my[1]);
      bumpKeyed(model.openerSecondGiven, `${opener}:${my[0]}`, my[1]);
    }

    // AI 的 ban（對手 5 隻裡被我 ban 掉的那隻）
    if (m.oppBan && opp.includes(m.oppBan)) {
      bump(model.ban, m.oppBan);
      model.banGames++;
    }

    // 對手角色的威脅度（只看實際出戰、沒被 ban 的）
    for (const id of opp) {
      if (id === m.oppBan) continue;
      bump(model.oppPlayed, id);
      if (m.won === false) bump(model.oppWins, id);
    }
  }

  return model;
}

interface Context {
  map: Map<number, number>;
  games: number;
  kind: "opener" | "opener-ai" | "slot" | "overall";
  weight: number;
  slotWeight: number;
  opener: number | null;
  aiFirstPick: number | null;
  label: string;
}

function pickContext(
  model: DraftModel,
  aiFirst: boolean,
  slot: number,
  aiPicks: DraftPick[],
  userPicks: DraftPick[],
): Context {
  const fallbackSlot = (): Context | null => {
    const map = model.slot.get(slot);
    const games = model.slotGames.get(slot) ?? 0;
    if (!map || games === 0) return null;
    return {
      map,
      games,
      kind: "slot",
      weight: 1.8,
      slotWeight: 0,
      opener: null,
      aiFirstPick: null,
      label: `第 ${slot} 手`,
    };
  };

  if (!aiFirst && slot === 2 && userPicks[0]) {
    const opener = userPicks[0].id;
    const map = model.openerFirst.get(opener);
    const games = model.openerGames.get(opener) ?? 0;
    if (map && games > 0) {
      return {
        map,
        games,
        kind: "opener",
        weight: 2.8,
        slotWeight: 0.6,
        opener,
        aiFirstPick: null,
        label: `對手首搶 ${monsterName(opener)}`,
      };
    }
    return (
      fallbackSlot() ?? {
        map: model.overall,
        games: model.matches,
        kind: "overall",
        weight: 1.2,
        slotWeight: 0,
        opener: null,
        aiFirstPick: null,
        label: "整體選角",
      }
    );
  }

  if (!aiFirst && slot === 3 && userPicks[0] && aiPicks[0]) {
    const opener = userPicks[0].id;
    const aiFirstPick = aiPicks[0].id;
    const given = model.openerSecondGiven.get(`${opener}:${aiFirstPick}`);
    if (given && sumMap(given) > 0) {
      return {
        map: given,
        games: sumMap(given),
        kind: "opener-ai",
        weight: 3,
        slotWeight: 0.4,
        opener,
        aiFirstPick,
        label: `對手首搶 ${monsterName(opener)}、我出 ${monsterName(aiFirstPick)} 後`,
      };
    }
    const map = model.openerSecond.get(opener);
    const games = model.openerGames.get(opener) ?? 0;
    if (map && games > 0) {
      return {
        map,
        games,
        kind: "opener",
        weight: 2.2,
        slotWeight: 0.6,
        opener,
        aiFirstPick: null,
        label: `對手首搶 ${monsterName(opener)}`,
      };
    }
    return (
      fallbackSlot() ?? {
        map: model.overall,
        games: model.matches,
        kind: "overall",
        weight: 1.2,
        slotWeight: 0,
        opener: null,
        aiFirstPick: null,
        label: "整體選角",
      }
    );
  }

  return (
    fallbackSlot() ?? {
      map: model.overall,
      games: model.matches,
      kind: "overall",
      weight: 1.2,
      slotWeight: 0,
      opener: null,
      aiFirstPick: null,
      label: "整體選角",
    }
  );
}

function compositionBonus(id: number, aiPicks: DraftPick[]): number {
  const hasSpeedLead = aiPicks.some((p) => speedLeadPct(p.id) > 0);
  const supports = aiPicks.filter((p) => monsterArch(p.id) === "Support").length;
  const attacks = aiPicks.filter((p) => monsterArch(p.id) === "Attack").length;
  const arch = monsterArch(id);

  let bonus = 0;
  if (!hasSpeedLead && speedLeadPct(id) > 0) bonus += 0.05;
  if (supports === 0 && arch === "Support") bonus += 0.03;
  if (supports >= 3 && arch === "Support") bonus -= 0.04;
  if (attacks === 0 && arch === "Attack") bonus += 0.02;
  return bonus;
}

function sampleTop(
  scored: { id: number; score: number }[],
  style: AiStyle,
  temperature: number,
): { id: number; score: number } | null {
  if (!scored.length) return null;
  if (style === "top") return scored[0];

  const top = scored.slice(0, 12);
  const max = top[0].score;
  const weights = top.map((x) => Math.exp((x.score - max) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < top.length; i++) {
    r -= weights[i];
    if (r <= 0) return top[i];
  }
  return top[0];
}

export function suggestAiPick(
  model: DraftModel,
  aiFirst: boolean,
  picks: DraftPick[],
  style: AiStyle,
): PickSuggestion | null {
  if (picks.length >= 10) return null;
  const slot = picks.length + 1;
  const used = new Set(picks.map((p) => p.id));
  const aiPicks = picks
    .filter((p) => p.side === "ai")
    .sort((a, b) => a.slot - b.slot);
  const userPicks = picks
    .filter((p) => p.side === "user")
    .sort((a, b) => a.slot - b.slot);

  const context = pickContext(model, aiFirst, slot, aiPicks, userPicks);
  const slotMap = model.slot.get(slot);
  const slotGames = model.slotGames.get(slot) ?? 0;
  const total = Math.max(1, model.matches);

  let candidates = [...model.aiPool].filter((id) => !used.has(id));
  if (candidates.length === 0) {
    candidates = [...new Set([...model.oppPool, ...ALL_MONSTER_IDS])].filter(
      (id) => !used.has(id),
    );
  }

  const scored = candidates
    .map((id) => {
      const contextRate = (context.map.get(id) ?? 0) / Math.max(1, context.games);
      const slotRate = slotGames ? (slotMap?.get(id) ?? 0) / slotGames : 0;
      const overallRate = (model.overall.get(id) ?? 0) / total;
      const aiCoRate = aiPicks.length
        ? aiPicks.reduce(
            (sum, p) => sum + (model.aiCo.get(id)?.get(p.id) ?? 0),
            0,
          ) / total
        : 0;
      const oppCoRate = userPicks.length
        ? userPicks.reduce(
            (sum, p) => sum + (model.oppCo.get(id)?.get(p.id) ?? 0),
            0,
          ) / total
        : 0;

      const score =
        contextRate * context.weight +
        slotRate * context.slotWeight +
        overallRate * 0.5 +
        aiCoRate * 3 +
        oppCoRate * 2 +
        compositionBonus(id, aiPicks);

      return { id, score };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);

  const chosen = sampleTop(scored, style, 0.12);
  if (!chosen) return null;

  const rate =
    context.games > 0 ? (context.map.get(chosen.id) ?? 0) / context.games : null;

  return {
    id: chosen.id,
    score: chosen.score,
    basis: `${context.label}：${context.games} 場`,
    contextGames: context.games,
    rate,
    alternatives: scored.slice(0, 3).map((x) => ({ id: x.id, score: x.score })),
  };
}

export function suggestAiBan(
  model: DraftModel,
  userPicks: DraftPick[],
  style: AiStyle,
): BanSuggestion | null {
  if (!userPicks.length) return null;
  const total = Math.max(1, model.matches);
  const banTotal = Math.max(1, model.banGames);

  const scored = userPicks
    .map((p) => {
      const banRate = (model.ban.get(p.id) ?? 0) / banTotal;
      const played = model.oppPlayed.get(p.id) ?? 0;
      const winRate = played > 0 ? (model.oppWins.get(p.id) ?? 0) / played : 0.5;
      const pickRate = (model.oppOverall.get(p.id) ?? 0) / total;
      // 以「這個玩家 historically ban 誰」為主；對手勝率／出場率只當微小 tiebreaker。
      const score = banRate * 3 + winRate * 0.1 + pickRate * 0.1;
      return { id: p.id, score, banRate, winRate, pickRate };
    })
    .sort((a, b) => b.score - a.score || a.id - b.id);

  const chosen = sampleTop(scored, style, 0.1);
  if (!chosen) return null;

  const detail = scored.find((x) => x.id === chosen.id);
  const basis = detail
    ? `歷史 ban 率 ${(detail.banRate * 100).toFixed(0)}%・對手出這隻勝率 ${(detail.winRate * 100).toFixed(0)}%`
    : "依歷史 ban 率與對手威脅";

  return {
    id: chosen.id,
    score: chosen.score,
    basis,
    alternatives: scored.slice(0, 3).map((x) => ({ id: x.id, score: x.score })),
  };
}

// ───────────────────────────── 狀態機 ─────────────────────────────

export interface SimState {
  picks: DraftPick[];
  userBan: number | null;
  aiBan: number | null;
  log: SimLogEntry[];
}

export type SimAction =
  | { type: "reset" }
  | {
      type: "pick";
      side: DraftSide;
      id: number;
      slot: number;
      aiFirst: boolean;
      note?: string;
    }
  | { type: "bans"; userBan: number; aiBan: number; note: string };

export function initialSimState(): SimState {
  return { picks: [], userBan: null, aiBan: null, log: [] };
}

export function simReducer(state: SimState, action: SimAction): SimState {
  if (action.type === "reset") return initialSimState();

  if (action.type === "pick") {
    if (state.picks.length >= 10 || state.userBan !== null) return state;
    const slot = state.picks.length + 1;
    if (action.slot !== slot) return state;
    if (sideForSlot(slot, action.aiFirst) !== action.side) return state;
    if (state.picks.some((p) => p.id === action.id)) return state;

    return {
      ...state,
      picks: [...state.picks, { side: action.side, id: action.id, slot }],
      log: [
        ...state.log,
        {
          side: action.side,
          action: "pick",
          id: action.id,
          slot,
          note: action.note,
        },
      ],
    };
  }

  if (state.picks.length < 10 || state.userBan !== null) return state;
  if (!state.picks.some((p) => p.side === "ai" && p.id === action.userBan)) {
    return state;
  }
  if (!state.picks.some((p) => p.side === "user" && p.id === action.aiBan)) {
    return state;
  }

  return {
    ...state,
    userBan: action.userBan,
    aiBan: action.aiBan,
    log: [
      ...state.log,
      { side: "user", action: "ban", id: action.userBan },
      { side: "ai", action: "ban", id: action.aiBan, note: action.note },
    ],
  };
}
