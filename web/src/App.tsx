import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveBar } from "./components/ArchiveBar";
import { MatchList } from "./components/MatchList";
import { MonsterIcon } from "./components/MonsterIcon";
import { MonsterSelect } from "./components/MonsterSelect";
import { PlayerHeader } from "./components/PlayerHeader";
import { StatsPanel } from "./components/StatsPanel";
import { API_BASE, fetchPlayer, fetchSample, loadCache, saveCache } from "./lib/api";
import { monsterName } from "./lib/monsters";
import { forgetPlayer, loadRecents, rememberPlayer, type RecentPlayer } from "./lib/recents";
import { monsterStats, overview } from "./lib/stats";
import type { MatchPayload, RtaMatch } from "./lib/types";

type Tab = "matches" | "stats";
type ResultFilter = "all" | "win" | "lose" | "draw";
type FirstSide = "all" | "me" | "opp";
type SidePos = "any" | "first" | "banned";

const STORE_PLAYER = "rta:player";
const STORE_FROM = "rta:seasonFrom";
const STORE_TO = "rta:seasonTo";
const STORE_SEASON = "rta:season";
const STORE_DEFAULT = "rta:defaultPlayer";
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

  /** 已載入的賽季資料（key = 賽季） */
  const [data, setData] = useState<Record<number, MatchPayload>>({});
  const [playerId, setPlayerId] = useState<number | null>(null);
  /** 目前要顯示的賽季範圍（可以比已抓到的範圍窄） */
  const [viewFrom, setViewFrom] = useState(DEFAULT_SEASON);
  const [viewTo, setViewTo] = useState(DEFAULT_SEASON);

  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("matches");
  const [result, setResult] = useState<ResultFilter>("all");
  const [firstSide, setFirstSide] = useState<FirstSide>("all");
  const [mySel, setMySel] = useState<number[]>([]);
  const [oppSel, setOppSel] = useState<number[]>([]);
  const [myPos, setMyPos] = useState<Record<number, SidePos>>({});
  const [oppPos, setOppPos] = useState<Record<number, SidePos>>({});
  const [oppQuery, setOppQuery] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [recents, setRecents] = useState<RecentPlayer[]>(() => loadRecents());
  const [archiveVersion, setArchiveVersion] = useState(0);

  const runRef = useRef(0);
  const playerRef = useRef<number | null>(null);

  const loadRange = useCallback(
    async (
      player: number,
      from: number,
      to: number,
      opts: { force?: boolean; silent?: boolean } = {},
    ) => {
      const run = ++runRef.current;
      if (opts.silent) setRefreshing(true);
      else setLoading(true);
      setError(null);

      const seasons = seasonOrder(from, to);
      const lo = Math.min(from, to);
      const hi = Math.max(from, to);

      if (playerRef.current !== player) {
        playerRef.current = player;
        setData({});
        setPlayerId(player);
      }
      setViewFrom(lo);
      setViewTo(hi);

      try {
        // 1) 先畫本機存檔（0 網路請求、就算額度用完也看得到）
        const cachedEntries: [number, MatchPayload][] = [];
        await Promise.all(
          seasons.map(async (s) => {
            const c = await Promise.race([
              loadCache(player, s),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
            ]);
            if (c && c.matches?.length) cachedEntries.push([s, c]);
          }),
        );
        if (run !== runRef.current) return;
        if (cachedEntries.length) {
          setData((prev) => ({
            ...prev,
            ...Object.fromEntries(cachedEntries),
          }));
          setNotice(`本機存檔・${cachedEntries.length} 個賽季`);
        }

        // 2) 逐季抓（一次一個，避免同時開多個瀏覽器撞 429）
        const failures: { season: number; message: string }[] = [];
        const loaded = new Set<number>(cachedEntries.map(([s]) => s));
        let staleMsg: string | null = null;

        for (let i = 0; i < seasons.length; i++) {
          const s = seasons[i];
          if (run !== runRef.current) return;

          // 已結束的賽季資料不會再變：本機已有就直接用，不再連網路
          const cachedSeason = cachedEntries.find(([cs]) => cs === s)?.[1];
          if (cachedSeason && seasonFinished(cachedSeason) && !opts.force) {
            loaded.add(s);
            continue;
          }

          setNotice(
            seasons.length > 1
              ? `抓取 S${s}…（${i + 1}/${seasons.length}）`
              : `抓取 S${s}…`,
          );

          try {
            const p = await fetchPlayer(player, s, { refresh: opts.force });
            if (run !== runRef.current) return;

            setData((prev) => ({ ...prev, [s]: p }));
            loaded.add(s);
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

        // 有些賽季抓不到（沒資料／額度用完）就把「顯示範圍」縮到真的有資料的賽季
        if (loaded.size) {
          const list = [...loaded].sort((a, b) => a - b);
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

  // 首次載入：本機存檔先畫，再逐季更新
  useEffect(() => {
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
    try {
      const q = new URLSearchParams(location.search);
      const qp = Number(q.get("player"));
      const qs = Number(q.get("season"));
      const qf = Number(q.get("from"));
      const qt = Number(q.get("to"));
      if (Number.isInteger(qp) && qp > 0) player = qp;
      if (Number.isInteger(qs) && qs > 0) {
        from = qs;
        to = qs;
      }
      if (Number.isInteger(qf) && qf > 0) from = qf;
      if (Number.isInteger(qt) && qt > 0) to = qt;
      if (from > to) [from, to] = [to, from];

      if (q.get("player") || q.get("season") || q.get("from") || q.get("to")) {
        localStorage.setItem(STORE_PLAYER, String(player));
        localStorage.setItem(STORE_FROM, String(from));
        localStorage.setItem(STORE_TO, String(to));
      }
    } catch {
      /* ignore */
    }

    setPlayerInput(String(player));
    setFromInput(String(from));
    setToInput(String(to));
    void loadRange(player, from, to);
  }, [loadRange]);

  useEffect(() => {
    setPage(1);
  }, [result, firstSide, mySel, oppSel, myPos, oppPos, oppQuery, newestFirst, data, viewFrom, viewTo]);

  // 有資料就把玩家記進「最近查看」（記最後看的賽季範圍）
  useEffect(() => {
    if (!playerId) return;
    const sample = Object.values(data).some((p) => p.sample);
    if (sample) return;
    const p = data[Math.max(viewFrom, viewTo)] ?? Object.values(data)[0];
    if (!p) return;
    setRecents(
      rememberPlayer(
        {
          id: p.player.id,
          username: p.player.username || p.summary.username,
          country: p.player.country,
        },
        Math.min(viewFrom, viewTo),
        Math.max(viewFrom, viewTo),
      ),
    );
  }, [playerId, data, viewFrom, viewTo]);

  const available = useMemo(
    () =>
      Object.keys(data)
        .map(Number)
        .filter((s) => (data[s]?.matches.length ?? 0) > 0)
        .sort((a, b) => a - b),
    [data],
  );

  const viewSeasons = useMemo(() => {
    const lo = Math.min(viewFrom, viewTo);
    const hi = Math.max(viewFrom, viewTo);
    return available.filter((s) => s >= lo && s <= hi);
  }, [available, viewFrom, viewTo]);

  const primary = useMemo(() => {
    const list = viewSeasons.length ? viewSeasons : available;
    const s = list[list.length - 1];
    return s !== undefined ? data[s] : null;
  }, [data, viewSeasons, available]);

  /** 把選定範圍的賽季合併成一份對局清單（每場標上賽季） */
  const merged = useMemo(() => {
    const out: RtaMatch[] = [];
    for (const s of viewSeasons) {
      for (const m of data[s].matches) out.push({ ...m, season: s });
    }
    out.sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
    return out;
  }, [data, viewSeasons]);

  const seasonLabel = useMemo(() => {
    const list = viewSeasons.length ? viewSeasons : available;
    if (!list.length) return "";
    const lo = list[0];
    const hi = list[list.length - 1];
    return lo === hi ? `S${hi}` : `S${lo}–${hi}`;
  }, [viewSeasons, available]);

  function openRecent(r: RecentPlayer) {
    setPlayerInput(String(r.id));
    setFromInput(String(r.from));
    setToInput(String(r.to));
    try {
      localStorage.setItem(STORE_PLAYER, String(r.id));
      localStorage.setItem(STORE_FROM, String(r.from));
      localStorage.setItem(STORE_TO, String(r.to));
    } catch {
      /* ignore */
    }
    setMySel([]);
    setOppSel([]);
    setMyPos({});
    setOppPos({});
    setFirstSide("all");
    setOppQuery("");
    void loadRange(r.id, r.from, r.to);
  }

  function dropRecent(id: number) {
    setRecents(forgetPlayer(id));
  }

  /** 匯入存檔後：優先顯示目前玩家，否則顯示檔案裡第一位 */
  function handleImported(items: MatchPayload[]) {
    if (!items.length) return;
    const pid =
      playerId && items.some((i) => i.player.id === playerId) ? playerId : items[0].player.id;
    const map: Record<number, MatchPayload> = {};
    for (const it of items) if (it.player.id === pid) map[it.season] = it;
    const seasons = Object.keys(map).map(Number).sort((a, b) => a - b);
    if (!seasons.length) return;

    playerRef.current = pid;
    setPlayerId(pid);
    setData(map);
    setPlayerInput(String(pid));
    setViewFrom(seasons[0]);
    setViewTo(seasons[seasons.length - 1]);
    setFromInput(String(seasons[0]));
    setToInput(String(seasons[seasons.length - 1]));
    try {
      localStorage.setItem(STORE_PLAYER, String(pid));
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
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const player = Number(playerInput);
    let from = Number(fromInput || DEFAULT_SEASON);
    let to = Number(toInput || from);

    if (!Number.isInteger(player) || player <= 0) {
      setError("玩家 ID 必須是正整數");
      return;
    }
    if (!Number.isInteger(from) || from <= 0 || !Number.isInteger(to) || to <= 0) {
      setError("賽季必須是正整數");
      return;
    }
    if (from > to) [from, to] = [to, from];
    if (to - from > 5) {
      setError("一次最多抓 6 個賽季，請縮小範圍");
      return;
    }

    try {
      localStorage.setItem(STORE_PLAYER, String(player));
      localStorage.setItem(STORE_FROM, String(from));
      localStorage.setItem(STORE_TO, String(to));
    } catch {
      /* ignore */
    }

    setFromInput(String(from));
    setToInput(String(to));
    setMySel([]);
    setOppSel([]);
    setMyPos({});
    setOppPos({});
    setFirstSide("all");
    setOppQuery("");
    void loadRange(player, from, to);
  }

  async function loadSample() {
    setLoading(true);
    setError(null);
    try {
      const sample = await fetchSample();
      playerRef.current = sample.player.id;
      setPlayerId(sample.player.id);
      setData({ [sample.season]: sample });
      setViewFrom(sample.season);
      setViewTo(sample.season);
      setFromInput(String(sample.season));
      setToInput(String(sample.season));
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

  return (
    <div className="app">
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

          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "載入中…" : "載入"}
          </button>

          {primary && !primary.sample && (
            <button
              type="button"
              className="btn ghost"
              disabled={loading || refreshing}
              onClick={() => {
                const p = Number(playerInput);
                let f = Number(fromInput || DEFAULT_SEASON);
                let t = Number(toInput || f);
                if (f > t) [f, t] = [t, f];
                void loadRange(p, f, t, { force: true });
              }}
            >
              {refreshing ? "更新中…" : "強制更新"}
            </button>
          )}
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

        {recents.length > 0 && (
          <section className="recents" aria-label="最近查看的玩家">
            <span className="recents-label">最近查看</span>
            <div className="recents-list">
              {recents.map((r) => {
                const active = !!playerId && playerId === r.id;
                const name = r.username || `#${r.id}`;
                const range = r.from === r.to ? `S${r.to}` : `S${r.from}–${r.to}`;
                return (
                  <div key={r.id} className={`recent${active ? " on" : ""}`}>
                    <button
                      type="button"
                      className="recent-btn"
                      onClick={() => openRecent(r)}
                      title={`${name}（ID ${r.id}・${range}）`}
                      aria-current={active ? "true" : undefined}
                    >
                      <span className="recent-avatar" aria-hidden>
                        {name.replace(/^#/, "").slice(0, 1)}
                      </span>
                      <span className="recent-text">
                        <span className="recent-name">{name}</span>
                        <span className="recent-id">
                          #{r.id}・{range}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="recent-x"
                      onClick={() => dropRecent(r.id)}
                      aria-label={`移除 ${name}`}
                      title="從清單移除"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {!primary && !loading && (
          <section className="hero">
            <h1>選角、被 ban、對位，一次看清</h1>
            <p>
              輸入 RTA 玩家 ID 與賽季範圍（例如 37–39），雲端會抓取每個賽季的對戰紀錄，
              再用「顯示」選單自由只看 38–39 或單一賽季。
            </p>
            <div className="hero-actions">
              <button type="button" className="btn primary" onClick={() => document.querySelector<HTMLInputElement>(".field input")?.focus()}>
                輸入玩家 ID
              </button>
              <button type="button" className="btn ghost" onClick={loadSample}>
                載入示範資料
              </button>
            </div>
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
            <PlayerHeader
              payload={primary}
              tally={tally}
              matchCount={merged.length}
              seasonLabel={seasonLabel}
            />

            <nav className="tabs" aria-label="檢視">
              <button type="button" className={tab === "matches" ? "on" : ""} onClick={() => setTab("matches")}>
                對局 <em>{filtered.length}</em>
              </button>
              <button type="button" className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>
                統計分析
              </button>
              <span className="tabs-status">
                {refreshing ? "背景更新中…" : notice}
                {primary.sample && "・示範資料"}
              </span>
            </nav>

            <div className="filters">
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
            ) : (
              <StatsPanel matches={filtered} tally={tally} />
            )}
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
