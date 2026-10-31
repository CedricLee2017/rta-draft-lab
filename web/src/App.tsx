import { useCallback, useEffect, useMemo, useState } from "react";
import { ArchiveBar } from "./components/ArchiveBar";
import { MatchList } from "./components/MatchList";
import { MonsterSelect } from "./components/MonsterSelect";
import { PlayerHeader } from "./components/PlayerHeader";
import { StatsPanel } from "./components/StatsPanel";
import { API_BASE, fetchPlayer, fetchSample, loadCache, saveCache } from "./lib/api";
import { forgetPlayer, loadRecents, rememberPlayer, type RecentPlayer } from "./lib/recents";
import { overview, monsterStats } from "./lib/stats";
import type { MatchPayload } from "./lib/types";

type Tab = "matches" | "stats";
type ResultFilter = "all" | "win" | "lose" | "draw";
type PickFilter = "all" | "first" | "second";

const STORE_PLAYER = "rta:player";
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

const PICK_LABELS: { key: PickFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "first", label: "首搶" },
  { key: "second", label: "後手" },
];

function readNum(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isInteger(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [playerInput, setPlayerInput] = useState(String(DEFAULT_PLAYER));
  const [seasonInput, setSeasonInput] = useState(String(DEFAULT_SEASON));

  const [payload, setPayload] = useState<MatchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleNote, setStaleNote] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>("matches");
  const [result, setResult] = useState<ResultFilter>("all");
  const [pick, setPick] = useState<PickFilter>("all");
  const [mySel, setMySel] = useState<number[]>([]);
  const [oppSel, setOppSel] = useState<number[]>([]);
  const [oppQuery, setOppQuery] = useState("");
  const [newestFirst, setNewestFirst] = useState(true);
  const [page, setPage] = useState(1);
  const [recents, setRecents] = useState<RecentPlayer[]>(() => loadRecents());
  const [archiveVersion, setArchiveVersion] = useState(0);

  const load = useCallback(
    async (player: number, season: number, opts: { force?: boolean; silent?: boolean } = {}) => {
      if (opts.silent) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const data = await fetchPlayer(player, season, { refresh: opts.force });
        setPayload(data);
        // 存進 IndexedDB（卡住也不要擋住畫面）
        await Promise.race([
          saveCache(data),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ]);
        setArchiveVersion((v) => v + 1);
        if (data.stale) {
          const mins = Math.round((data.ageSeconds ?? 0) / 60);
          setStaleNote(
            `${data.warning ?? "即時更新失敗"}（目前顯示約 ${mins} 分鐘前的資料）`,
          );
        } else {
          setStaleNote(null);
        }
        setNotice(
          `更新於 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}` +
            (data.cached ? "（KV 快取）" : "（即時抓取）"),
        );
      } catch (e) {
        const msg = (e as Error).message;
        // 連不到 API（額度用完／離線）時，改用本機存檔，至少能繼續看舊資料
        const fallback = await loadCache(player, season);
        if (fallback && fallback.matches?.length) {
          setPayload(fallback);
          setStaleNote(`無法取得最新資料（${msg}），顯示本機存檔`);
          setNotice(`本機存檔・${fallback.fetchedAt.slice(0, 16).replace("T", " ")}`);
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [],
  );

  // 首次載入：先畫 IndexedDB 快取（0 網路請求），太舊才背景更新
  useEffect(() => {
    let cancelled = false;
    let player = readNum(STORE_PLAYER, DEFAULT_PLAYER);
    // 預設玩家換人時，只遷移一次：舊的「上次看的玩家」是上一個預設，直接換成新預設
    try {
      if (localStorage.getItem(STORE_DEFAULT) !== String(DEFAULT_PLAYER)) {
        player = DEFAULT_PLAYER;
        localStorage.setItem(STORE_DEFAULT, String(DEFAULT_PLAYER));
        localStorage.setItem(STORE_PLAYER, String(DEFAULT_PLAYER));
      }
    } catch {
      /* ignore */
    }
    // 記住使用者上次看的賽季（包含刻意回顧舊賽季的情況）
    let season = readNum(STORE_SEASON, DEFAULT_SEASON);

    // 支援 ?player=221145&season=39（PWA 捷徑、分享連結）
    try {
      const q = new URLSearchParams(location.search);
      const qp = Number(q.get("player"));
      const qs = Number(q.get("season"));
      if (Number.isInteger(qp) && qp > 0) player = qp;
      if (Number.isInteger(qs) && qs > 0) season = qs;
      if ((Number.isInteger(qp) && qp > 0) || (Number.isInteger(qs) && qs > 0)) {
        localStorage.setItem(STORE_PLAYER, String(player));
        localStorage.setItem(STORE_SEASON, String(season));
      }
    } catch {
      /* ignore */
    }

    setPlayerInput(String(player));
    setSeasonInput(String(season));

    (async () => {
      // IndexedDB 有可能因為被封鎖／損壞而永遠不回應，最多等 1.2 秒就改走網路
      const cached = await Promise.race([
        loadCache(player, season),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1200)),
      ]);
      if (cancelled) return;

      if (cached && cached.matches?.length) {
        setPayload(cached);
        setNotice(`本機快取・${cached.fetchedAt.slice(0, 16).replace("T", " ")}`);
        const age = Date.now() - Date.parse(cached.fetchedAt);
        if (!(age >= 0 && age < 60 * 60 * 1000)) {
          void load(player, season, { silent: true });
        }
      } else {
        void load(player, season);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [result, pick, mySel, oppSel, oppQuery, newestFirst, payload]);

  // 每次成功載入（含本機快取）就把這位玩家記進「最近查看」
  useEffect(() => {
    if (!payload || payload.sample) return;
    setRecents(
      rememberPlayer(
        {
          id: payload.player.id,
          username: payload.player.username || payload.summary.username,
          country: payload.player.country,
        },
        payload.season,
      ),
    );
  }, [payload]);

  function openRecent(r: RecentPlayer) {
    setPlayerInput(String(r.id));
    setSeasonInput(String(r.season));
    try {
      localStorage.setItem(STORE_PLAYER, String(r.id));
      localStorage.setItem(STORE_SEASON, String(r.season));
    } catch {
      /* ignore */
    }
    setMySel([]);
    setOppSel([]);
    setOppQuery("");
    void load(r.id, r.season);
  }

  function dropRecent(id: number) {
    setRecents(forgetPlayer(id));
  }

  /** 匯入存檔後：優先顯示目前這位玩家的版本，否則顯示檔案裡最新的一筆 */
  function handleImported(items: MatchPayload[]) {
    if (!items.length) return;
    const current = payload
      ? items.find((i) => i.player.id === payload.player.id && i.season === payload.season)
      : undefined;
    const pick = current ?? items[0];

    setPayload(pick);
    setPlayerInput(String(pick.player.id));
    setSeasonInput(String(pick.season));
    try {
      localStorage.setItem(STORE_PLAYER, String(pick.player.id));
      localStorage.setItem(STORE_SEASON, String(pick.season));
    } catch {
      /* ignore */
    }
    setMySel([]);
    setOppSel([]);
    setOppQuery("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const player = Number(playerInput);
    const season = Number(seasonInput);

    if (!Number.isInteger(player) || player <= 0) {
      setError("玩家 ID 必須是正整數");
      return;
    }
    if (!Number.isInteger(season) || season <= 0) {
      setError("賽季必須是正整數");
      return;
    }

    try {
      localStorage.setItem(STORE_PLAYER, String(player));
      localStorage.setItem(STORE_SEASON, String(season));
    } catch {
      /* ignore */
    }

    setMySel([]);
    setOppSel([]);
    setOppQuery("");
    void load(player, season);
  }

  async function loadSample() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSample();
      setPayload(data);
      setNotice("示範資料（120 場，非即時）");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function resetFilters() {
    setResult("all");
    setPick("all");
    setMySel([]);
    setOppSel([]);
    setOppQuery("");
    setNewestFirst(true);
  }

  const filtered = useMemo(() => {
    if (!payload) return [];

    let arr = payload.matches;

    if (result !== "all") {
      arr = arr.filter((m) =>
        result === "win" ? m.won === true : result === "lose" ? m.won === false : m.won === null,
      );
    }
    if (pick !== "all") {
      arr = arr.filter((m) => (pick === "first" ? m.firstPick : !m.firstPick));
    }
    if (mySel.length) {
      arr = arr.filter((m) => mySel.every((id) => m.my.includes(id)));
    }
    if (oppSel.length) {
      arr = arr.filter((m) => oppSel.every((id) => m.opp.includes(id)));
    }
    const q = oppQuery.trim().toLowerCase();
    if (q) {
      arr = arr.filter((m) => m.oppName.toLowerCase().includes(q) || String(m.oppId ?? "").includes(q));
    }

    return newestFirst ? arr : [...arr].reverse();
  }, [payload, result, pick, mySel, oppSel, oppQuery, newestFirst]);

  const tally = useMemo(() => overview(filtered), [filtered]);

  // 選單最前面放本季最常出場的魔靈
  const myPinned = useMemo(
    () => (payload ? monsterStats(payload.matches, "my").slice(0, 30).map((s) => s.id) : []),
    [payload],
  );
  const oppPinned = useMemo(
    () => (payload ? monsterStats(payload.matches, "opp").slice(0, 30).map((s) => s.id) : []),
    [payload],
  );

  const filterActive =
    result !== "all" || pick !== "all" || mySel.length > 0 || oppSel.length > 0 || oppQuery.trim() !== "";

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
          <label className="field narrow">
            <span>賽季</span>
            <input
              value={seasonInput}
              onChange={(e) => setSeasonInput(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="39"
              aria-label="賽季"
            />
          </label>
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? "載入中…" : "載入"}
          </button>
          {payload && !payload.sample && (
            <button
              type="button"
              className="btn ghost"
              disabled={loading || refreshing}
              onClick={() => {
                const p = Number(playerInput);
                const s = Number(seasonInput);
                void load(p, s, { force: true });
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
          payload={payload}
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
                const active = !!payload && !payload.sample && payload.player.id === r.id;
                const name = r.username || `#${r.id}`;
                return (
                  <div key={r.id} className={`recent${active ? " on" : ""}`}>
                    <button
                      type="button"
                      className="recent-btn"
                      onClick={() => openRecent(r)}
                      title={`${name}（ID ${r.id}・S${r.season}）`}
                      aria-current={active ? "true" : undefined}
                    >
                      <span className="recent-avatar" aria-hidden>
                        {name.replace(/^#/, "").slice(0, 1)}
                      </span>
                      <span className="recent-text">
                        <span className="recent-name">{name}</span>
                        <span className="recent-id">
                          #{r.id}・S{r.season}
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

        {!payload && !loading && (
          <section className="hero">
            <h1>選角、被 ban、對位，一次看清</h1>
            <p>
              輸入 RTA 玩家 ID，雲端會抓取本季全部對戰紀錄並算出選角率、被 ban 率、對位勝率與首搶優勢。
              資料存在你的瀏覽器，回訪不需要重新下載。
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

        {loading && !payload && (
          <section className="hero">
            <div className="spinner" aria-hidden />
            <p>正在雲端開瀏覽器抓取對戰紀錄…（第一次約 2–3 秒）</p>
          </section>
        )}

        {payload && (
          <>
            <PlayerHeader payload={payload} tally={tally} />

            <nav className="tabs" aria-label="檢視">
              <button type="button" className={tab === "matches" ? "on" : ""} onClick={() => setTab("matches")}>
                對局 <em>{filtered.length}</em>
              </button>
              <button type="button" className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>
                統計分析
              </button>
              <span className="tabs-status">
                {refreshing ? "背景更新中…" : notice}
                {payload.sample && "・示範資料"}
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

              <div className="seg" role="group" aria-label="先後手">
                {PICK_LABELS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={pick === p.key ? "on" : ""}
                    onClick={() => setPick(p.key)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <MonsterSelect label="我方" value={mySel} onChange={setMySel} pinned={myPinned} />
              <MonsterSelect label="對手" value={oppSel} onChange={setOppSel} pinned={oppPinned} />

              <input
                className="text"
                value={oppQuery}
                onChange={(e) => setOppQuery(e.target.value)}
                placeholder="搜尋對手名稱 / ID…"
                aria-label="搜尋對手"
              />

              <button type="button" className="link" onClick={() => setNewestFirst((v) => !v)}>
                {newestFirst ? "最新→舊" : "舊→最新"}
              </button>

              {filterActive && (
                <button type="button" className="link danger" onClick={resetFilters}>
                  重設篩選
                </button>
              )}
            </div>

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
              {filterActive && <span className="tag">已套用篩選</span>}
            </div>

            {tab === "matches" ? (
              <MatchList matches={filtered} page={page} onPage={setPage} me={payload.player} />
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
