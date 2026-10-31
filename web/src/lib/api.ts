import { get, set } from "idb-keyval";
import type { MatchPayload } from "./types";

/**
 * Worker 位址。優先用 build-time 的 VITE_API_BASE，
 * 其次允許用 ?api=https://xxx.workers.dev 臨時覆寫（會記在 localStorage）。
 */
const FALLBACK_API_BASE = "";

function readOverride(): string {
  try {
    const q = new URLSearchParams(location.search).get("api");
    if (q) {
      localStorage.setItem("rta:api", q);
      return q;
    }
    return localStorage.getItem("rta:api") ?? "";
  } catch {
    return "";
  }
}

export const API_BASE = (
  import.meta.env.VITE_API_BASE ||
  readOverride() ||
  FALLBACK_API_BASE
).replace(/\/+$/, "");

const cacheKey = (player: number, season: number) => `rta:${player}:${season}`;

export async function loadCache(player: number, season: number): Promise<MatchPayload | null> {
  try {
    return (await get<MatchPayload>(cacheKey(player, season))) ?? null;
  } catch {
    return null;
  }
}

export async function saveCache(payload: MatchPayload): Promise<void> {
  try {
    await set(cacheKey(payload.player.id, payload.season), payload);
  } catch {
    /* 無痕模式 / 空間不足 → 忽略，只是下次要重新抓 */
  }
}

export async function fetchPlayer(
  player: number,
  season: number,
  opts: { refresh?: boolean } = {},
): Promise<MatchPayload> {
  const url =
    `${API_BASE}/api/player?player=${encodeURIComponent(player)}` +
    `&season=${encodeURIComponent(season)}` +
    (opts.refresh ? "&refresh=1" : "");

  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    throw new Error(
      API_BASE
        ? `連不到 API（${API_BASE}），可能是網路或 Worker 未部署`
        : "尚未設定 API 位址",
    );
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error ?? "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `API 回應 ${res.status}`);
  }

  return (await res.json()) as MatchPayload;
}

export async function fetchSample(): Promise<MatchPayload> {
  const res = await fetch(`${import.meta.env.BASE_URL}sample-matches.json`);
  if (!res.ok) throw new Error("示範資料載入失敗");
  return (await res.json()) as MatchPayload;
}
