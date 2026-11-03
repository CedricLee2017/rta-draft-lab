import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveBar } from "./components/ArchiveBar";
import { BpAnalysis } from "./components/BpAnalysis";
import { DraftSimulator } from "./components/DraftSimulator";
import { MatchList } from "./components/MatchList";
import { MonsterIcon } from "./components/MonsterIcon";
import { MonsterSelect } from "./components/MonsterSelect";
import { MultiHeader } from "./components/MultiHeader";
import { PlayerHeader } from "./components/PlayerHeader";
import { QrCard } from "./components/QrCard";
import { RosterBar, type RosterEntry } from "./components/RosterBar";
import { StatsPanel } from "./components/StatsPanel";
import { API_BASE, fetchPlayer, fetchSample, loadCache, saveCache } from "./lib/api";
import { listArchives } from "./lib/archive";
import { monsterName } from "./lib/monsters";
import { PREWARMED_PLAYERS, PREWARMED_SEASON } from "./lib/prewarmed";
import { monsterStats, overview } from "./lib/stats";
import type { MatchPayload, RtaMatch } from "./lib/types";

type Tab = "matches" | "stats" | "bp" | "sim";
type ResultFilter = "all" | "win" | "lose" | "draw";
type FirstSide = "all" | "me" | "opp";
type SidePos = "any" | "first" | "banned";

/** 玩家 ID → 賽季 → 該賽季資料 */
type Roster = Record<number, Record<number, MatchPayload>>;

const STORE_PLAYER = "rta:player";
const STORE_FROM = "rta:seasonFrom";
const STORE_TO = "rta:seasonTo";
const STORE_SEASON = "rta:season";
const STORE_DEFAULT = "rta:defaultPlayer";
const STORE_SELECTED = "rta:selectedPlayers";
const DEFAULT_PLAYER = 221145;
const DEFAULT_SEASON = 39;

const RESULT_LABELS: { key: ResultFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "win", label: "勝" },
  { key: "lose", label: "負" },
  { key: "draw", label: "和" },
];

const PICK_LABELS: { key: FirstSide; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "me", label: "我方首搶" },
  { key: "opp", label: "對手首搶" },
];

const POS_LABELS: { key: SidePos; label: string }[] = [
  { key: "any", label: "任一手" },
  { key: "first", label: "首選" },
  { key: "banned", label: "被 ban" },
];

function readNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isInteger(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

function readIds(key: string): number[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    return Array.isArray(list)
      ? list.filter((v): v is number => Number.isInteger(v) && v > 0)
      : [];
  } catch {
    return [];
  }
}

/** [to, to-1, ..., from]（新的賽季先抓） */
function seasonOrder(from: number, to: number): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: number[] = [];
  for (let s = hi; s >= lo; s--) out.push(s);
  return out;
}

/** 賽季已結束（資料不會再變）→ 有存檔就不用再連網路 */
function seasonFinished(p?: MatchPayload | null): boolean {
  const end = p?.summary?.seasonEnd;
  if (!end) return false;
  const t = Date.parse(end);
  return Number.isFinite(t) && t < Date.now();
}

/** 把多筆 payload 併進名單；同一玩家同一賽季保留 fetchedAt 較新的 */
function mergeRoster(prev: Roster, items: MatchPayload[]): Roster {
  if (!items.length) return prev;
  const next: Roster = { ...prev };
  for (const p of items) {
    const id = p.player.id;
    const seasons = { ...(next[id] ?? {}) };
    const old = seasons[p.season];
    if (!old || (Date.parse(p.fetchedAt) || 0) >= (Date.parse(old.fetchedAt) || 0)) {
      seasons[p.season] = p;
    }
    next[id] = seasons;
  }
  return next;
}

function nameOfPlayer(seasons: Record<number, MatchPayload> | undefined, id: number): string {
  if (!seasons) return `#${id}`;
  const list = Object.keys(seasons).map(Number).sort((a, b) => a - b);
  const p = seasons[list[list.length - 1]];
  return p?.summary.username || p?.player.username || `#${id}`;
}

/**
 * 單邊的魔靈條件：
 *  - 選中的每隻都要在該方 5 隻裡（AND）
 *  - 每隻可以再指定位置：首選 = 該方第 1 手、被 ban = 該方被 ban 的那隻
 */
function sideMatch(
  sel: number[],
  pos: Record<number, SidePos>,
  list: number[],
  ban: number,
): boolean {
  if (!sel.length) return true;
  if (!sel.every((id) => list.includes(id))) return false;
  for (const id of sel) {
    const p = pos[id] ?? "any";
    if (p === "first" && list[0] !== id) return false;
    if (p === "banned" && ban !== id) return false;
  }
  return true;
}

/** 只保留還有選中的魔靈的位置設定 */
function prunePos(
  pos: Record<number, SidePos>,
  ids: number[],
): Record<number, SidePos> {
  const next: Record<number, SidePos> = {};
  for (const id of ids) {
    const p = pos[id];
    if (p && p !== "any") next[id] = p;
  }
  return next;
}

export default function App() {
  const [playerInput, setPlayerInput] = useState(String(DEFAULT_PLAYER));
  const [fromInput, setFromInput] = useState(String(DEFAULT_SEASON));
  const [toInput, setToInput] = useState(String(DEFAULT_SEASON));

  /** 這台裝置上所有抓過的玩家（開啟網站只讀本機，不連網） */
  const [roster, setRoster] = useState<Roster>({});
  /** 要合併分析的玩家（可只選其中幾位） */
  const [selectedIds, setSelectedIds] = useState<number[]>(() => readIds(STORE_SELECTED));

  /** 目前要顯示的賽季範圍（可以比已抓到的範圍窄） */
  const [viewFrom, setViewFrom] = useState(DEFAULT_SEASON);
  const [viewTo, setViewTo] = useState(DEFAULT_SEASON);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("matches");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [result, setResult] = useState<ResultFilter>("all");
  const [firstSide, setFirstSide] = useState<FirstSide>("all");
  const [mySel, setMySel] = useState<number[]>([]);
  const [oppSel, setOppSel] = useState<number[]>([]);
  const [myPos, setMyPos] = useState<Record<number, SidePos>>({});
  const [oppPos, setOppPos] = useState<Record<number, SidePos>>({});
  const [oppQuery, setOppQuery] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [archiveVersion, setArchiveVersion] = useState(0);

  const runRef = useRef(0);

  /**
   * 載入某位玩家的賽季範圍。
   *
   * opts.fetch = false → 只讀這台裝置的存檔（0 網路請求）
   * opts.fetch = true  → 呼叫 Worker；cacheOnly 時只讀雲端 KV（不開瀏覽器）
   *                       只有「線上抓取」才會真的開瀏覽器抓新資料
   *
   * 開網站時不會呼叫這個函式去抓資料，只會從 IndexedDB 還原已存的玩家。
   */
  const loadRange = useCallback(
    async (
      player: number,
      from: number,
      to: number,
      opts: { force?: boolean; silent?: boolean; fetch?: boolean; cacheOnly?: boolean } = {},
    ) => {
      const run = ++runRef.current;
      const shouldFetch = opts.fetch !== false;
      if (opts.silent) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const seasons = seasonOrder(from, to);
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);

      setViewFrom(lo);
      setViewTo(hi);

      try {
        // 1) 先讀本機存檔（就算額度用完也看得到）
        const local: MatchPayload[] = [];
        await Promise.all(
          seasons.map(async (s) => {
            const c = await Promise.race([
              loadCache(player, s),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
            ]);
            if (c && c.matches?.length) local.push(c);
          }),
        );
        if (run !== runRef.current) return;
        if (local.length) {
          setRoster((prev) => mergeRoster(prev, local));
          setNotice(`本機存檔・${local.length} 個賽季`);
        }

        if (!shouldFetch) {
          if (local.length) {
            setSelectedIds((prev) => (prev.includes(player) ? prev : [...prev, player]));
            const list = local.map((p) => p.season).sort((a, b) => a - b);
            setViewFrom(list[0]);
            setViewTo(list[list.length - 1]);
          } else {
            setError(`本機沒有 #${player} 的存檔；按「讀取雲端」或「線上抓取」下載。`);
          }
          return;
        }

        // 2) 手動抓取：逐季請求（一次一個，避免同時開多個瀏覽器撞 429）
        const failures: { season: number; message: string }[] = [];
        const fetched: MatchPayload[] = [];
        let staleMsg: string | null = null;

        for (let i = 0; i < seasons.length; i++) {
          const s = seasons[i];
          if (run !== runRef.current) return;

          // 已結束的賽季資料不會再變：本機已有就直接用，不再連網路
          const cachedSeason = local.find((p) => p.season === s);
          if (cachedSeason && seasonFinished(cachedSeason) && !opts.force) {
            fetched.push(cachedSeason);
            continue;
          }

          setNotice(
            seasons.length > 1
              ? `抓取 S${s}…（${i + 1}/${seasons.length}）`
              : `抓取 S${s}…`,
          );

          try {
            const p = await fetchPlayer(player, s, {
              refresh: opts.force,
              cacheOnly: opts.cacheOnly,
            });
            if (run !== runRef.current) return;

            fetched.push(p);
            setRoster((prev) => mergeRoster(prev, [p]));
            await Promise.race([
              saveCache(p),
              new Promise((resolve) => setTimeout(resolve, 1500)),
            ]);
            if (run !== runRef.current) return;
            setArchiveVersion((v) => v + 1);

            if (p.stale) {
              const mins = Math.round((p.ageSeconds ?? 0) / 60);
              staleMsg = `S${s}：${p.warning ?? "使用快取資料"}（約 ${mins} 分鐘前）`;
            }
            setNotice(
              `S${s} ${p.cached ? "KV 快取" : "即時抓取"}・` +
                new Date().toLocaleTimeString("zh-TW", { hour12: false }),
            );
          } catch (e) {
            failures.push({ season: s, message: (e as Error).message });
          }
        }

        if (run !== runRef.current) return;
        setStaleNote(staleMsg);

        const got = [...new Map([...local, ...fetched].map((p) => [p.season, p])).values()];
        if (got.length) {
          setSelectedIds((prev) => (prev.includes(player) ? prev : [...prev, player]));
          const list = got.map((p) => p.season).sort((a, b) => a - b);
          setViewFrom(list[0]);
          setViewTo(list[list.length - 1]);
        }

        if (failures.length) {
          const list = failures.map((f) => `S${f.season}`).join("、");
          const tail = failures.length < seasons.length ? "（其他賽季仍可查看）" : "";
          setError(`${list} 抓取失敗：${failures[0].message}${tail}`);
        }
      } finally {
        if (run === runRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  // 開啟網站：只還原本機存檔，完全不連網（不會自動抓）
  useEffect(() => {
    let alive = true;

    (async () => {
      const items = await listArchives();
      if (!alive) return;

      const restored = mergeRoster({}, items);
      setRoster(restored);
      const cachedIds = Object.keys(restored).map(Number);

      let player = readNum(STORE_PLAYER, DEFAULT_PLAYER);
      try {
        if (localStorage.getItem(STORE_DEFAULT) !== String(DEFAULT_PLAYER)) {
          player = DEFAULT_PLAYER;
          localStorage.setItem(STORE_DEFAULT, String(DEFAULT_PLAYER));
          localStorage.setItem(STORE_PLAYER, String(DEFAULT_PLAYER));
        }
      } catch {
        /* ignore */
      }

      // 舊版只存單一賽季，沒有 from/to 就沿用它
      const legacy = readNum(STORE_SEASON, DEFAULT_SEASON);
      let from = readNum(STORE_FROM, 0) || legacy;
      let to = readNum(STORE_TO, 0) || legacy;

      // 支援 ?player=221145&from=37&to=39（PWA 捷徑、分享連結；也接受單一 season）
      let queryPlayer: number | null = null;
      try {
        const q = new URLSearchParams(location.search);
        const qp = Number(q.get("player"));
        const qs = Number(q.get("season"));
        const qf = Number(q.get("from"));
        const qt = Number(q.get("to"));
        if (Number.isInteger(qp) && qp > 0) queryPlayer = qp;
        if (Number.isInteger(qs) && qs > 0) {
          from = qs;
          to = qs;
        }
        if (Number.isInteger(qf) && qf > 0) from = qf;
        if (Number.isInteger(qt) && qt > 0) to = qt;
        if (from > to) [from, to] = [to, from];

        if (q.get("player") || q.get("season") || q.get("from") || q.get("to")) {
          localStorage.setItem(STORE_PLAYER, String(queryPlayer ?? player));
          localStorage.setItem(STORE_FROM, String(from));
          localStorage.setItem(STORE_TO, String(to));
        }
      } catch {
        /* ignore */
      }

      if (queryPlayer) player = queryPlayer;
      setPlayerInput(String(player));
      setFromInput(String(from));
      setToInput(String(to));

      // 還原上次勾選的玩家；第一次使用就選預設玩家（或最近抓過的那位）
      let selected = readIds(STORE_SELECTED).filter((id) => !!restored[id]);
      if (queryPlayer && restored[queryPlayer]) selected = [queryPlayer];
      if (!selected.length) {
        selected = restored[player] ? [player] : cachedIds.slice(0, 1);
      }
      selected = selected.filter((id) => !!restored[id]);
      setSelectedIds(selected);

      // 顯示範圍：沿用上次的賽季範圍，並夾到目前有資料的賽季
      const allSeasons = [...new Set(items.map((p) => p.season))].sort((a, b) => a - b);
      if (allSeasons.length) {
        const lo = allSeasons[0];
        const hi = allSeasons[allSeasons.length - 1];
        let vf = Math.min(Math.max(from, lo), hi);
        let vt = Math.min(Math.max(to, lo), hi);
        if (vf > vt) [vf, vt] = [vt, vf];
        setViewFrom(vf);
        setViewTo(vt);
      }

      if (!items.length) {
        setNotice("開網站不會自動抓取；輸入玩家 ID 後按「讀取雲端」或「線上抓取」。");
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // 記住勾選的玩家（下次開啟網站不用重選）
  useEffect(() => {
    try {
      localStorage.setItem(STORE_SELECTED, JSON.stringify(selectedIds));
    } catch {
      /* ignore */
    }
  }, [selectedIds]);

  const allPlayerIds = useMemo(() => Object.keys(roster).map(Number), [roster]);

  /** 名單摘要（每位玩家的場數、勝率、賽季範圍） */
  const rosterEntries = useMemo<RosterEntry[]>(() => {
    const out: RosterEntry[] = [];
    for (const id of allPlayerIds) {
      const seasonsMap = roster[id];
      const seasons = Object.keys(seasonsMap).map(Number).sort((a, b) => a - b);
      if (!seasons.length) continue;
      const payloads = seasons.map((s) => seasonsMap[s]);
      const latest = payloads.reduce((a, b) =>
        (Date.parse(b.fetchedAt) || 0) >= (Date.parse(a.fetchedAt) || 0) ? b : a,
      );

      let matches = 0;
      let wins = 0;
      let losses = 0;
      let lastSeen = "";
      for (const p of payloads) {
        matches += p.matches.length;
        for (const m of p.matches) {
          if (m.won === true) wins++;
          else if (m.won === false) losses++;
          if (m.time > lastSeen) lastSeen = m.time;
        }
      }

      out.push({
        id,
        name: latest.summary.username || latest.player.username || `#${id}`,
        image: latest.summary.image || latest.player.image,
        country: latest.summary.country || latest.player.country,
        seasons,
        from: seasons[0],
        to: seasons[seasons.length - 1],
        matches,
        winRate: wins + losses ? (wins / (wins + losses)) * 100 : null,
        fetchedAt: latest.fetchedAt,
        lastSeen,
      });
    }
    return out.sort((a, b) => (Date.parse(b.fetchedAt) || 0) - (Date.parse(a.fetchedAt) || 0));
  }, [roster, allPlayerIds]);

  const selectedEntries = useMemo(
    () => rosterEntries.filter((e) => selectedIds.includes(e.id)),
    [rosterEntries, selectedIds],
  );

  /** 雲端已備好、但這台裝置還沒抓過的玩家（點一下只需要讀 KV） */
  const cloudPlayers = useMemo(
    () => PREWARMED_PLAYERS.filter((p) => !roster[p.id]),
    [roster],
  );

  /** 只分析勾選的玩家；沒勾就顯示提示，不會偷偷把全部玩家算進去 */
  const activeIds = useMemo(
    () => selectedIds.filter((id) => !!roster[id]),
    [selectedIds, roster],
  );

  const available = useMemo(() => {
    const set = new Set<number>();
    for (const id of activeIds) {
      for (const s of Object.keys(roster[id] ?? {})) set.add(Number(s));
    }
    return [...set].sort((a, b) => a - b);
  }, [activeIds, roster]);

  // 勾選改變後，把顯示範圍夾回真的有資料的賽季
  useEffect(() => {
    if (!available.length) return;
    const lo = available[0];
    const hi = available[available.length - 1];
    setViewFrom((v) => (available.includes(v) ? v : lo));
    setViewTo((v) => (available.includes(v) ? v : hi));
  }, [available]);

  const viewSeasons = useMemo(() => {
    const lo = Math.min(viewFrom, viewTo);
    const hi = Math.max(viewFrom, viewTo);
    return available.filter((s) => s >= lo && s <= hi);
  }, [available, viewFrom, viewTo]);

  const primary = useMemo(() => {
    for (const id of activeIds) {
      const seasons = roster[id];
      if (!seasons) continue;
      const list = Object.keys(seasons)
        .map(Number)
        .filter((s) => viewSeasons.includes(s))
        .sort((a, b) => a - b);
      if (list.length) return seasons[list[list.length - 1]];
    }
    for (const id of activeIds) {
      const seasons = roster[id];
      if (!seasons) continue;
      const list = Object.keys(seasons).map(Number).sort((a, b) => a - b);
      if (list.length) return seasons[list[list.length - 1]];
    }
    return null;
  }, [roster, activeIds, viewSeasons]);

  /**
   * 把勾選玩家的選定賽季合併成一份對局清單。
   * 每場都標上 ownerId / ownerName，統計時「我方」就是該場紀錄的主人。
   */
  const merged = useMemo(() => {
    const out: RtaMatch[] = [];
    for (const id of activeIds) {
      const seasons = roster[id];
      if (!seasons) continue;
      const ownerName = nameOfPlayer(seasons, id);
      for (const s of viewSeasons) {
        const p = seasons[s];
        if (!p) continue;
        for (const m of p.matches) {
          out.push({ ...m, season: s, ownerId: id, ownerName });
        }
      }
    }
    out.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
    return out;
  }, [roster, activeIds, viewSeasons]);

  const seasonLabel = useMemo(() => {
    const list = viewSeasons.length ? viewSeasons : available;
    if (!list.length) return "";
    const lo = list[0];
    const hi = list[list.length - 1];
    return lo === hi ? `S${hi}` : `S${lo}–${hi}`;
  }, [viewSeasons, available]);

  function togglePlayer(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  /** 匯入存檔後：併進名單，並勾選檔案裡的玩家 */
  function handleImported(items: MatchPayload[]) {
    if (!items.length) return;
    const ids = [...new Set(items.map((i) => i.player.id))];

    setRoster((prev) => mergeRoster(prev, items));
    setSelectedIds((prev) => [...new Set([...prev, ...ids])]);

    const seasons = [...new Set(items.map((i) => i.season))].sort((a, b) => a - b);
    setViewFrom(seasons[0]);
    setViewTo(seasons[seasons.length - 1]);
    setFromInput(String(seasons[0]));
    setToInput(String(seasons[seasons.length - 1]));

    setPlayerInput(String(ids[0]));
    try {
      localStorage.setItem(STORE_PLAYER, String(ids[0]));
      localStorage.setItem(STORE_FROM, String(seasons[0]));
      localStorage.setItem(STORE_TO, String(seasons[seasons.length - 1]));
    } catch {
      /* ignore */
    }

    setMySel([]);
    setOppSel([]);
    setMyPos({});
    setOppPos({});
    setFirstSide("all");
    setOppQuery("");
    setArchiveVersion((v) => v + 1);
  }

  /** 讀輸入框並驗證；回傳正規化後的玩家與賽季範圍 */
  function readInputs(): { player: number; from: number; to: number } | null {
    const player = Number(playerInput);
    let from = Number(fromInput || DEFAULT_SEASON);
    let to = Number(toInput || from);

    if (!Number.isInteger(player) || player <= 0) {
      setError("玩家 ID 必須是正整數");
      return null;
    }
    if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
      setError("賽季必須是正整數");
      return null;
    }
    if (from > to) [from, to] = [to, from];
    if (to - from > 5) {
      setError("一次最多抓 6 個賽季，請縮小範圍");
      return null;
    }
    return { player, from, to };
  }

  /** 讀取雲端快取（cacheOnly，不消耗額度）；「線上抓取」才會開瀏覽器 */
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const input = readInputs();
    if (!input) return;
    const { player, from, to } = input;

    try {
      localStorage.setItem(STORE_PLAYER, String(player));
      localStorage.setItem(STORE_FROM, String(from));
      localStorage.setItem(STORE_TO, String(to));
    } catch {
      /* ignore */
    }

    setFromInput(String(from));
    setToInput(String(to));
    resetSideFilters();
    void loadRange(player, from, to, { fetch: true, cacheOnly: true });
  }

  /** 只讀本機存檔（不連網、不消耗額度） */
  function loadLocal() {
    const input = readInputs();
    if (!input) return;
    const { player, from, to } = input;
    resetSideFilters();
    void loadRange(player, from, to, { fetch: false });
  }

  /** 從「雲端已備好」清單加入一位玩家：只讀 KV，不開瀏覽器 */
  function loadCloud(id: number) {
    setPlayerInput(String(id));
    setFromInput(String(PREWARMED_SEASON));
    setToInput(String(PREWARMED_SEASON));
    resetSideFilters();
    void loadRange(id, PREWARMED_SEASON, PREWARMED_SEASON, {
      fetch: true,
      cacheOnly: true,
    });
  }

  function resetSideFilters() {
    setMySel([]);
    setOppSel([]);
    setMyPos({});
    setOppPos({});
    setFirstSide("all");
    setOppQuery("");
  }

  async function loadSample() {
    setLoading(true);
    setError(null);
    try {
      const sample = await fetchSample();
      setRoster({ [sample.player.id]: { [sample.season]: sample } });
      setSelectedIds([sample.player.id]);
      setViewFrom(sample.season);
      setViewTo(sample.season);
      setFromInput(String(sample.season));
      setToInput(String(sample.season));
      setPlayerInput(String(sample.player.id));
      setNotice("示範資料（120 場，非即時）");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setResult("all");
    setFirstSide("all");
    setMySel([]);
    setOppSel([]);
    setMyPos({});
    setOppPos({});
    setOppQuery("");
    setNewestFirst(true);
    if (available.length) {
      setViewFrom(available[0]);
      setViewTo(available[available.length - 1]);
    }
  }

  /** 切換分頁時回到頁首，手機上不用再往上滑 */
  function changeTab(next: Tab) {
    setTab(next);
    window.scrollTo(0, 0);
  }

  const filtered = useMemo(() => {
    let arr = merged;

    if (result !== "all") {
      arr = arr.filter((m) =>
        result === "win" ? m.won === true : result === "lose" ? m.won === false : m.won === null,
      );
    }
    if (firstSide !== "all") {
      arr = arr.filter((m) => (firstSide === "me" ? m.firstPick : !m.firstPick));
    }
    if (mySel.length || oppSel.length) {
      arr = arr.filter(
        (m) =>
          sideMatch(mySel, myPos, m.my, m.myBan) && sideMatch(oppSel, oppPos, m.opp, m.oppBan),
      );
    }
    const q = oppQuery.trim().toLowerCase();
    if (q) {
      arr = arr.filter((m) => m.oppName.toLowerCase().includes(q) || String(m.oppId ?? "").includes(q));
    }

    return newestFirst ? arr : [...arr].reverse();
  }, [merged, result, firstSide, mySel, oppSel, myPos, oppPos, oppQuery, newestFirst]);

  const tally = useMemo(() => overview(filtered), [filtered]);

  // 選單最前面放觀看範圍內最常出場的魔靈
  const myPinned = useMemo(
    () => monsterStats(merged, "my").slice(0, 30).map((s) => s.id),
    [merged],
  );
  const oppPinned = useMemo(
    () => monsterStats(merged, "opp").slice(0, 30).map((s) => s.id),
    [merged],
  );

  const viewNarrower =
    available.length > 0 &&
    (Math.min(viewFrom, viewTo) !== available[0] ||
      Math.max(viewFrom, viewTo) !== available[available.length - 1]);

  const filterActive =
    result !== "all" ||
    firstSide !== "all" ||
    mySel.length > 0 ||
    oppSel.length > 0 ||
    oppQuery.trim() !== "" ||
    viewNarrower;

  /** 顯示目前已套用的條件（給 summary bar 用） */
  const conditionChips = useMemo(() => {
    const chips: string[] = [];
    if (firstSide !== "all") chips.push(firstSide === "me" ? "我方首搶" : "對手首搶");

    const describe = (sel: number[], pos: Record<number, SidePos>, side: string) => {
      if (!sel.length) return;
      const names = sel.map((id) => monsterName(id));
      const shown =
        names.length > 3 ? `${names.slice(0, 3).join("、")} 等 ${names.length} 隻` : names.join("、");
      const detail: string[] = [];
      const first = sel.find((id) => pos[id] === "first");
      const banned = sel.find((id) => pos[id] === "banned");
      if (first !== undefined) detail.push(`首選 ${monsterName(first)}`);
      if (banned !== undefined) detail.push(`被 ban ${monsterName(banned)}`);
      chips.push(`${side} ${shown}${detail.length ? `（${detail.join("；")}）` : ""}`);
    };

    describe(mySel, myPos, "我方");
    describe(oppSel, oppPos, "對手");
    return chips;
  }, [firstSide, mySel, oppSel, myPos, oppPos]);

  /** 設定某隻魔靈的位置；「首選」「被 ban」每邊各只能有一個 */
  function setSidePos(side: "my" | "opp", id: number, pos: SidePos) {
    const apply = (prev: Record<number, SidePos>) => {
      const next: Record<number, SidePos> = { ...prev };
      if (pos === "first" || pos === "banned") {
        for (const k of Object.keys(next)) {
          const key = Number(k);
          if (key !== id && next[key] === pos) next[key] = "any";
        }
      }
      next[id] = pos;
      return next;
    };
    if (side === "my") setMyPos(apply);
    else setOppPos(apply);
  }

  useEffect(() => {
    setPage(1);
  }, [result, firstSide, mySel, oppSel, myPos, oppPos, oppQuery, newestFirst, merged, viewFrom, viewTo]);

  const multi = selectedEntries.length > 1;

  return (
    <div className={`app${tab === "sim" ? " sim-view" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            ◆
          </span>
          <div className="brand-text">
            <strong>RTA Draft Lab</strong>
            <small>對戰紀錄・BP 分析</small>
          </div>
        </div>

        <form className="controls" onSubmit={submit}>
          <label className="field">
            <span>玩家 ID</span>
            <input
              value={playerInput}
              onChange={(e) => setPlayerInput(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="221145"
              aria-label="玩家 ID"
            />
          </label>

          <label className="field">
            <span>賽季範圍</span>
            <span className="range">
              <input
                value={fromInput}
                onChange={(e) => setFromInput(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="37"
                aria-label="起始賽季"
              />
              <i aria-hidden>–</i>
              <input
                value={toInput}
                onChange={(e) => setToInput(e.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="39"
                aria-label="結束賽季"
              />
            </span>
          </label>

          <button
            type="submit"
            className="btn primary"
            disabled={loading}
            title="讀取雲端快取（不開瀏覽器、不消耗額度）；雲端沒有資料時請按「線上抓取」"
          >
            {loading ? "載入中…" : "讀取雲端"}
          </button>

          <button
            type="button"
            className="btn ghost"
            disabled={loading || refreshing}
            onClick={loadLocal}
            title="只讀這台裝置的存檔，不連網、不消耗額度"
          >
            只看本機
          </button>

          <button
            type="button"
            className="btn ghost"
            disabled={loading || refreshing}
            onClick={() => {
              const input = readInputs();
              if (!input) return;
              void loadRange(input.player, input.from, input.to, { force: true });
            }}
            title="用雲端瀏覽器重新抓取最新資料（會消耗每日額度，請確定需要再按）"
          >
            {refreshing ? "抓取中…" : "線上抓取"}
          </button>
        </form>
      </header>

      {error && (
        <div className="banner error" role="alert">
          <strong>載入失敗</strong>
          <span>{error}</span>
          <button type="button" className="link" onClick={() => setError(null)}>
            關閉
          </button>
        </div>
      )}

      {staleNote && (
        <div className="banner warn" role="status">
          <strong>顯示快取資料</strong>
          <span>{staleNote}</span>
          <button type="button" className="link" onClick={() => setStaleNote(null)}>
            關閉
          </button>
        </div>
      )}

      <main className="container">
        <ArchiveBar
          payload={primary}
          version={archiveVersion}
          onImported={handleImported}
          onNotice={setNotice}
          onError={setError}
        />

        <RosterBar
          entries={rosterEntries}
          selected={selectedIds}
          onToggle={togglePlayer}
          onAll={() => setSelectedIds(rosterEntries.map((e) => e.id))}
          onNone={() => setSelectedIds([])}
          cloud={cloudPlayers}
          onLoadCloud={loadCloud}
        />

        {!primary && !loading && rosterEntries.length > 0 && (
          <section className="hero">
            <h1>勾選玩家後開始分析</h1>
            <p>
              上方「玩家名單」已經有 {rosterEntries.length} 位玩家。勾選 1 位以上，
              就會顯示他們的對局、選角與 ban 統計；勾 2 位以上就是合併分析。
            </p>
          </section>
        )}

        {!primary && !loading && rosterEntries.length === 0 && (
          <section className="hero">
            <h1>選角、被 ban、對位，一次看清</h1>
            <p>
              輸入 RTA 玩家 ID 與賽季範圍（例如 37–39），按「讀取雲端」下載已備好的對戰紀錄，
              或按「線上抓取」用雲端瀏覽器抓取。抓過的玩家會留在「玩家名單」，
              勾選其中幾位就能只看他們的合併數據。
            </p>
            <p className="hero-note">
              開啟網站不會自動抓取；「讀取雲端」與「只看本機」都不會消耗每日額度。
            </p>
            <div className="hero-actions">
              <button type="button" className="btn primary" onClick={() => document.querySelector<HTMLInputElement>(".field input")?.focus()}>
                輸入玩家 ID
              </button>
              <button type="button" className="btn ghost" onClick={loadSample}>
                載入示範資料
              </button>
            </div>
            <QrCard className="hero-qr" size={132} />
            {!API_BASE && (
              <p className="hero-hint">
                尚未設定 API 位址：可在網址加上 <code>?api=https://你的-worker.workers.dev</code> 後重新載入。
              </p>
            )}
          </section>
        )}

        {loading && !primary && (
          <section className="hero">
            <div className="spinner" aria-hidden />
            <p>{notice ?? "正在雲端開瀏覽器抓取對戰紀錄…（每個賽季約 2–4 秒）"}</p>
          </section>
        )}

        {primary && (
          <>
            {multi ? (
              <MultiHeader
                entries={selectedEntries}
                tally={tally}
                matchCount={merged.length}
                seasonLabel={seasonLabel}
              />
            ) : (
              <PlayerHeader
                payload={primary}
                tally={tally}
                matchCount={merged.length}
                seasonLabel={seasonLabel}
              />
            )}

            <nav className="tabs" aria-label="檢視">
              <button type="button" className={tab === "matches" ? "on" : ""} onClick={() => changeTab("matches")}>
                對局 <em>{filtered.length}</em>
              </button>
              <button type="button" className={tab === "stats" ? "on" : ""} onClick={() => changeTab("stats")}>
                統計分析
              </button>
              <button type="button" className={tab === "bp" ? "on" : ""} onClick={() => changeTab("bp")}>
                BP 深度
              </button>
              <button type="button" className={tab === "sim" ? "on" : ""} onClick={() => changeTab("sim")}>
                模擬 BP
              </button>
              <span className="tabs-status">
                {refreshing ? "背景更新中…" : notice}
                {primary.sample && "・示範資料"}
              </span>
            </nav>

            {(refreshing || notice || primary.sample) && (
              <div className="mobile-status" role="status">
                {refreshing ? "背景更新中…" : notice}
                {primary.sample && "・示範資料"}
              </div>
            )}

            <button
              type="button"
              className={`mobile-filter-toggle${filtersOpen ? " open" : ""}`}
              onClick={() => setFiltersOpen((v) => !v)}
              aria-expanded={filtersOpen}
              aria-controls="filters-panel"
            >
              <span>篩選與顯示</span>
              <em>{filterActive ? "已套用" : "全部"}</em>
              <span className="mft-caret" aria-hidden>
                {filtersOpen ? "▴" : "▾"}
              </span>
            </button>

            <div id="filters-panel" className={`filters${filtersOpen ? " open" : ""}`}>
              <div className="seg" role="group" aria-label="勝負">
                {RESULT_LABELS.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    className={result === r.key ? "on" : ""}
                    onClick={() => setResult(r.key)}
                  >
                    {r.label}
                  </button>
                ))}
              </div>

              <div className="seg" role="group" aria-label="首搶方">
                {PICK_LABELS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={firstSide === p.key ? "on" : ""}
                    onClick={() => setFirstSide(p.key)}
                    title={p.key === "me" ? "只看我方首搶的對局" : p.key === "opp" ? "只看對手首搶的對局" : undefined}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <MonsterSelect
                label="我方"
                value={mySel}
                onChange={(ids) => {
                  setMySel(ids);
                  setMyPos((prev) => prunePos(prev, ids));
                }}
                pinned={myPinned}
              />

              <MonsterSelect
                label="對手"
                value={oppSel}
                onChange={(ids) => {
                  setOppSel(ids);
                  setOppPos((prev) => prunePos(prev, ids));
                }}
                pinned={oppPinned}
              />

              <input
                className="text"
                value={oppQuery}
                onChange={(e) => setOppQuery(e.target.value)}
                placeholder="搜尋對手名稱 / ID…"
                aria-label="搜尋對手"
              />

              {available.length > 1 && (
                <div className="season-view" role="group" aria-label="顯示賽季範圍">
                  <span className="season-view-label">顯示</span>
                  <select
                    value={viewFrom}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setViewFrom(v);
                      if (v > viewTo) setViewTo(v);
                    }}
                    aria-label="顯示起始賽季"
                  >
                    {available.map((s) => (
                      <option key={s} value={s}>
                        S{s}
                      </option>
                    ))}
                  </select>
                  <i aria-hidden>–</i>
                  <select
                    value={viewTo}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setViewTo(v);
                      if (v < viewFrom) setViewFrom(v);
                    }}
                    aria-label="顯示結束賽季"
                  >
                    {available.map((s) => (
                      <option key={s} value={s}>
                        S{s}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button type="button" className="link" onClick={() => setNewestFirst((v) => !v)}>
                {newestFirst ? "最新→舊" : "舊→最新"}
              </button>

              {filterActive && (
                <button type="button" className="link danger" onClick={resetFilters}>
                  重設篩選
                </button>
              )}
            </div>

            {(mySel.length > 0 || oppSel.length > 0) && (
              <div className="condbar">
                {mySel.length > 0 && (
                  <div className="condbar-side">
                    <span className="condbar-label">我方</span>
                    {mySel.map((id) => (
                      <span className="cond-item" key={id}>
                        <MonsterIcon id={id} size={26} />
                        <select
                          className="pos-select"
                          value={myPos[id] ?? "any"}
                          onChange={(e) => setSidePos("my", id, e.target.value as SidePos)}
                          aria-label={`${monsterName(id)} 的位置`}
                          title="首選 = 我方第 1 手；被 ban = 被對手 ban 掉"
                        >
                          {POS_LABELS.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </span>
                    ))}
                  </div>
                )}

                {oppSel.length > 0 && (
                  <div className="condbar-side">
                    <span className="condbar-label">對手</span>
                    {oppSel.map((id) => (
                      <span className="cond-item" key={id}>
                        <MonsterIcon id={id} size={26} />
                        <select
                          className="pos-select"
                          value={oppPos[id] ?? "any"}
                          onChange={(e) => setSidePos("opp", id, e.target.value as SidePos)}
                          aria-label={`${monsterName(id)} 的位置`}
                          title="首選 = 對手第 1 手；被 ban = 被我 ban 掉"
                        >
                          {POS_LABELS.map((p) => (
                            <option key={p.key} value={p.key}>
                              {p.label}
                            </option>
                          ))}
                        </select>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="summary-bar">
              <span>
                顯示 <b>{filtered.length}</b> 場
              </span>
              <span>
                勝率 <b>{tally.winRate === null ? "–" : `${tally.winRate.toFixed(1)}%`}</b>
              </span>
              <span>
                {tally.wins}勝 {tally.losses}負{tally.draws ? ` ${tally.draws}和` : ""}
              </span>
              {multi && <span className="tag">{selectedEntries.length} 位玩家合併</span>}
              {viewSeasons.length > 1 && <span className="tag">{seasonLabel}</span>}
              {conditionChips.map((c) => (
                <span key={c} className="tag cond">
                  {c}
                </span>
              ))}
              {filterActive && <span className="tag">已套用篩選</span>}
            </div>

            {tab === "matches" ? (
              <MatchList
                matches={filtered}
                page={page}
                onPage={setPage}
                me={primary.player}
                showSeason={viewSeasons.length > 1}
              />
            ) : tab === "stats" ? (
              <StatsPanel matches={filtered} tally={tally} />
            ) : tab === "bp" ? (
              <BpAnalysis matches={filtered} />
            ) : (
              <DraftSimulator
                matches={merged}
                player={
                  multi
                    ? { ...primary.player, username: `${selectedEntries.length} 位玩家合併` }
                    : primary.player
                }
                seasonLabel={seasonLabel}
              />
            )}

            <nav className="mobile-nav" aria-label="頁面切換">
              <button
                type="button"
                className={tab === "matches" ? "on" : ""}
                onClick={() => changeTab("matches")}
                aria-label="對局"
                aria-current={tab === "matches" ? "page" : undefined}
              >
                <span className="mn-icon" aria-hidden>
                  ⚔
                </span>
                <span className="mn-label">對局</span>
                <em>{filtered.length}</em>
              </button>
              <button
                type="button"
                className={tab === "stats" ? "on" : ""}
                onClick={() => changeTab("stats")}
                aria-label="統計分析"
                aria-current={tab === "stats" ? "page" : undefined}
              >
                <span className="mn-icon" aria-hidden>
                  ▤
                </span>
                <span className="mn-label">統計</span>
              </button>
              <button
                type="button"
                className={tab === "bp" ? "on" : ""}
                onClick={() => changeTab("bp")}
                aria-label="BP 深度"
                aria-current={tab === "bp" ? "page" : undefined}
              >
                <span className="mn-icon" aria-hidden>
                  ◈
                </span>
                <span className="mn-label">BP</span>
              </button>
              <button
                type="button"
                className={tab === "sim" ? "on" : ""}
                onClick={() => changeTab("sim")}
                aria-label="模擬 BP"
                aria-current={tab === "sim" ? "page" : undefined}
              >
                <span className="mn-icon" aria-hidden>
                  ▷
                </span>
                <span className="mn-label">模擬</span>
              </button>
            </nav>
          </>
        )}
      </main>

      <footer className="footer">
        <span>
          資料來源 <a href="https://lucksack.gg" target="_blank" rel="noreferrer noopener">lucksack.gg</a>
          ・只在瀏覽器端分析，不上傳任何個人資料
        </span>
        <span>
          配裝與配隊請用{" "}
          <a href="https://sw-tick-lab.pages.dev" target="_blank" rel="noreferrer noopener">
            SW Tick Lab
          </a>
        </span>
      </footer>
    </div>
  );
}
