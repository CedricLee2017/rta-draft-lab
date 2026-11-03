import { useMemo, useState } from "react";
import type { RtaMatch } from "../lib/types";
import {
  comboStats,
  firstPickSplit,
  leaderStats,
  matchupStats,
  monsterStats,
  opponentStats,
  type MonsterStat,
  type Tally,
} from "../lib/stats";
import { monsterName } from "../lib/monsters";
import { MonsterIcon } from "./MonsterIcon";

type Section = "monsters" | "matchup" | "tempo" | "opponents";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "monsters", label: "魔靈" },
  { key: "matchup", label: "對位" },
  { key: "tempo", label: "節奏與組合" },
  { key: "opponents", label: "對手" },
];

function Rate({ value, games }: { value: number | null; games?: number }) {
  if (value === null) return <span className="rate na">–</span>;
  const cls = value >= 55 ? "good" : value < 45 ? "bad" : "mid";
  return (
    <span className={`rate ${cls}`}>
      {value.toFixed(1)}%
      {games !== undefined && <em>{games}</em>}
    </span>
  );
}

interface ThProps {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
}

function Th({ label, active, dir, onClick }: ThProps) {
  return (
    <th className={`sortable${active ? " on" : ""}`} onClick={onClick} scope="col">
      {label}
      <span className="th-dir">{active ? (dir === 1 ? "▲" : "▼") : ""}</span>
    </th>
  );
}

type SortKey = "drafted" | "banned" | "winRate";

function MonsterTable({
  rows,
  side,
  caption,
}: {
  rows: MonsterStat[];
  side: "my" | "opp";
  caption: string;
}) {
  const [key, setKey] = useState<SortKey>("drafted");
  const [dir, setDir] = useState<1 | -1>(-1);
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => ((a[key] ?? -1) - (b[key] ?? -1)) * dir);
    return arr;
  }, [rows, key, dir]);

  const limit = showAll ? sorted.length : 24;
  const visible = sorted.slice(0, limit);

  function toggle(k: SortKey) {
    if (k === key) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setKey(k);
      setDir(-1);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>{caption}</h3>
        <span className="card-note">{rows.length} 隻</span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">魔靈</th>
              <Th label="出場" active={key === "drafted"} dir={dir} onClick={() => toggle("drafted")} />
              <Th label="被 ban" active={key === "banned"} dir={dir} onClick={() => toggle("banned")} />
              <th scope="col">出戰</th>
              <Th label="勝率" active={key === "winRate"} dir={dir} onClick={() => toggle("winRate")} />
              <th scope="col">被 ban 後</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="tbl-mon">
                    <MonsterIcon id={s.id} size={30} />
                    <span>{monsterName(s.id)}</span>
                  </div>
                </td>
                <td>
                  {s.drafted}
                  <em>{s.draftRate.toFixed(0)}%</em>
                </td>
                <td className={s.banned ? "ban" : ""}>
                  {s.banned}
                  <em>{s.banRate.toFixed(0)}%</em>
                </td>
                <td>{s.played}</td>
                <td>
                  <Rate value={s.winRate} />
                  <em className="sub">
                    {s.wins}-{s.losses}
                  </em>
                </td>
                <td>
                  <Rate value={s.bannedWinRate} games={s.bannedGames} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sorted.length > limit && (
        <button type="button" className="btn ghost wide" onClick={() => setShowAll(true)}>
          顯示全部 {sorted.length} 隻
        </button>
      )}

      <p className="card-foot">
        {side === "my"
          ? "「出場」= 被選進 5 隻；「被 ban」= 對手從我的 5 隻中 ban 掉；「出戰」= 實際打進去的 4 隻。"
          : "「出場」= 對手選進 5 隻；「被 ban」= 我從對手的 5 隻中 ban 掉；「勝率」= 我對上這隻的勝率。"}
      </p>
    </div>
  );
}

function Matchup({ matches }: { matches: RtaMatch[] }) {
  const my = useMemo(() => monsterStats(matches, "my").slice(0, 12), [matches]);
  const opp = useMemo(() => monsterStats(matches, "opp").slice(0, 12), [matches]);
  const pairs = useMemo(() => {
    const map = new Map<string, { games: number; wins: number; losses: number; winRate: number | null }>();
    for (const p of matchupStats(matches)) map.set(`${p.myId}:${p.oppId}`, p);
    return map;
  }, [matches]);

  if (my.length === 0 || opp.length === 0) {
    return <div className="empty-inline"><p>資料不足</p></div>;
  }

  return (
    <div className="card">
      <div className="card-head">
        <h3>對位勝率矩陣</h3>
        <span className="card-note">我的魔靈 × 對手魔靈（只計算雙方實際出戰）</span>
      </div>

      <div className="heat-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th className="corner" />
              {opp.map((o) => (
                <th key={o.id}>
                  <MonsterIcon id={o.id} size={30} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {my.map((m) => (
              <tr key={m.id}>
                <th>
                  <MonsterIcon id={m.id} size={30} />
                  <span>{monsterName(m.id)}</span>
                </th>
                {opp.map((o) => {
                  const p = pairs.get(`${m.id}:${o.id}`);
                  if (!p || p.games < 2) {
                    return (
                      <td key={o.id} className="cell empty" title={`${monsterName(m.id)} vs ${monsterName(o.id)}`}>
                        ·
                      </td>
                    );
                  }
                  const wr = p.winRate ?? 0;
                  const cls = wr >= 60 ? "h3" : wr >= 50 ? "h2" : wr >= 40 ? "h1" : "h0";
                  return (
                    <td
                      key={o.id}
                      className={`cell ${cls}`}
                      title={`${monsterName(m.id)} vs ${monsterName(o.id)}：${p.wins}-${p.losses}（${p.games} 場）`}
                    >
                      {wr.toFixed(0)}
                      <em>{p.games}</em>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="card-foot">數字 = 勝率（%），小字 = 樣本場數。少於 2 場以「·」表示，避免小樣本誤導。</p>
    </div>
  );
}

function Tempo({ matches, tally }: { matches: RtaMatch[]; tally: Tally }) {
  const split = useMemo(() => firstPickSplit(matches), [matches]);
  const leaders = useMemo(() => leaderStats(matches).slice(0, 12), [matches]);
  const combos = useMemo(() => comboStats(matches, 6).slice(0, 12), [matches]);

  return (
    <>
      <div className="split-row">
        <div className="card split">
          <span className="split-k">首搶勝率</span>
          <strong className={`split-v ${split.first.winRate === null ? "na" : split.first.winRate >= 50 ? "good" : "bad"}`}>
            {split.first.winRate === null ? "–" : `${split.first.winRate.toFixed(1)}%`}
          </strong>
          <span className="split-s">
            {split.first.wins}勝 {split.first.losses}負・{split.first.games} 場
          </span>
        </div>
        <div className="card split">
          <span className="split-k">後手勝率</span>
          <strong className={`split-v ${split.second.winRate === null ? "na" : split.second.winRate >= 50 ? "good" : "bad"}`}>
            {split.second.winRate === null ? "–" : `${split.second.winRate.toFixed(1)}%`}
          </strong>
          <span className="split-s">
            {split.second.wins}勝 {split.second.losses}負・{split.second.games} 場
          </span>
        </div>
        <div className="card split">
          <span className="split-k">首搶優勢</span>
          <strong className="split-v">
            {split.first.winRate !== null && split.second.winRate !== null
              ? `${split.first.winRate - split.second.winRate >= 0 ? "+" : ""}${(split.first.winRate - split.second.winRate).toFixed(1)}pt`
              : "–"}
          </strong>
          <span className="split-s">總勝率 {tally.winRate === null ? "–" : `${tally.winRate.toFixed(1)}%`}</span>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head">
            <h3>隊長使用</h3>
            <span className="card-note">我當隊長時的勝率</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">魔靈</th>
                <th scope="col">場數</th>
                <th scope="col">勝率</th>
              </tr>
            </thead>
            <tbody>
              {leaders.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div className="tbl-mon">
                      <MonsterIcon id={l.id} size={30} leader />
                      <span>{monsterName(l.id)}</span>
                    </div>
                  </td>
                  <td>{l.games}</td>
                  <td>
                    <Rate value={l.winRate} />
                  </td>
                </tr>
              ))}
              {leaders.length === 0 && (
                <tr>
                  <td colSpan={3} className="tbl-empty">沒有隊長資料</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-head">
            <h3>雙人組合</h3>
            <span className="card-note">同時出戰 ≥ 6 場</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th scope="col">組合</th>
                <th scope="col">場數</th>
                <th scope="col">勝率</th>
              </tr>
            </thead>
            <tbody>
              {combos.map((c) => (
                <tr key={`${c.a}-${c.b}`}>
                  <td>
                    <div className="tbl-mon">
                      <MonsterIcon id={c.a} size={28} />
                      <MonsterIcon id={c.b} size={28} />
                      <span>
                        {monsterName(c.a)} + {monsterName(c.b)}
                      </span>
                    </div>
                  </td>
                  <td>{c.games}</td>
                  <td>
                    <Rate value={c.winRate} />
                  </td>
                </tr>
              ))}
              {combos.length === 0 && (
                <tr>
                  <td colSpan={3} className="tbl-empty">樣本不足</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Opponents({ matches }: { matches: RtaMatch[] }) {
  const rows = useMemo(() => opponentStats(matches).slice(0, 60), [matches]);

  return (
    <div className="card">
      <div className="card-head">
        <h3>最常遇到的對手</h3>
        <span className="card-note">{rows.length} 位（依交手次數排序）</span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">對手</th>
              <th scope="col">交手</th>
              <th scope="col">戰績</th>
              <th scope="col">勝率</th>
              <th scope="col">分數</th>
              <th scope="col">最後交手</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  <div className="tbl-mon">
                    <span className="opp-name">{o.name || `#${o.id}`}</span>
                    <em className="sub">#{o.id}</em>
                  </div>
                </td>
                <td>{o.games}</td>
                <td>
                  {o.wins}-{o.losses}
                </td>
                <td>
                  <Rate value={o.winRate} />
                </td>
                <td>{o.score ?? "–"}</td>
                <td>{o.lastSeen ? o.lastSeen.slice(0, 10) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlayerBreakdown({ matches }: { matches: RtaMatch[] }) {
  const rows = useMemo(() => {
    interface Acc {
      id: number;
      name: string;
      games: number;
      wins: number;
      losses: number;
      first: number;
      picks: Map<number, number>;
      bans: Map<number, number>;
    }
    const acc = new Map<number, Acc>();
    const bump = (map: Map<number, number>, id: number) => {
      if (!id) return;
      map.set(id, (map.get(id) ?? 0) + 1);
    };

    for (const m of matches) {
      if (m.ownerId === undefined) continue;
      let e = acc.get(m.ownerId);
      if (!e) {
        e = {
          id: m.ownerId,
          name: m.ownerName || `#${m.ownerId}`,
          games: 0,
          wins: 0,
          losses: 0,
          first: 0,
          picks: new Map(),
          bans: new Map(),
        };
        acc.set(m.ownerId, e);
      }
      e.games++;
      if (m.won === true) e.wins++;
      else if (m.won === false) e.losses++;
      if (m.firstPick) e.first++;
      bump(e.picks, m.my[0]);
      bump(e.bans, m.oppBan);
    }

    const top = (map: Map<number, number>): { id: number; n: number } | null => {
      let best: { id: number; n: number } | null = null;
      for (const [id, n] of map) if (!best || n > best.n) best = { id, n };
      return best;
    };

    return [...acc.values()]
      .map((e) => ({
        id: e.id,
        name: e.name,
        games: e.games,
        winRate: e.wins + e.losses ? (e.wins / (e.wins + e.losses)) * 100 : null,
        firstRate: e.games ? (e.first / e.games) * 100 : 0,
        firstPick: top(e.picks),
        ban: top(e.bans),
      }))
      .sort((a, b) => b.games - a.games);
  }, [matches]);

  if (rows.length < 2) return null;

  return (
    <div className="card">
      <div className="card-head">
        <h3>各玩家習慣</h3>
        <span className="card-note">合併前分開看：首選與 ban 的偏好</span>
      </div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th scope="col">玩家</th>
              <th scope="col">場數</th>
              <th scope="col">勝率</th>
              <th scope="col">首搶率</th>
              <th scope="col">最常首選</th>
              <th scope="col">最常 ban</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="tbl-mon">
                    <span className="opp-name">{r.name}</span>
                    <em className="sub">#{r.id}</em>
                  </div>
                </td>
                <td>{r.games}</td>
                <td>
                  <Rate value={r.winRate} />
                </td>
                <td>{r.firstRate.toFixed(0)}%</td>
                <td>
                  {r.firstPick ? (
                    <div className="tbl-mon">
                      <MonsterIcon id={r.firstPick.id} size={28} />
                      <span>{monsterName(r.firstPick.id)}</span>
                      <em className="sub">{r.firstPick.n}×</em>
                    </div>
                  ) : (
                    "–"
                  )}
                </td>
                <td>
                  {r.ban ? (
                    <div className="tbl-mon">
                      <MonsterIcon id={r.ban.id} size={28} banned />
                      <span>{monsterName(r.ban.id)}</span>
                      <em className="sub">{r.ban.n}×</em>
                    </div>
                  ) : (
                    "–"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-foot">
        「最常首選」= 該玩家自己的第 1 手；「最常 ban」= 他從對手 5 隻中 ban 掉的那隻。
        合併時每場都以紀錄主人的視角計算。
      </p>
    </div>
  );
}

export function StatsPanel({ matches, tally }: { matches: RtaMatch[]; tally: Tally }) {
  const [section, setSection] = useState<Section>("monsters");

  const myStats = useMemo(() => monsterStats(matches, "my"), [matches]);
  const oppStats = useMemo(() => monsterStats(matches, "opp"), [matches]);

  const insights = useMemo(() => {
    const pool = myStats.filter((s) => s.bannedGames >= 5);
    const fragile = [...pool].sort((a, b) => (a.bannedWinRate ?? 100) - (b.bannedWinRate ?? 100))[0];
    const replaceable = [...pool].sort((a, b) => (b.bannedWinRate ?? 0) - (a.bannedWinRate ?? 0))[0];
    const mostBanned = [...myStats].sort((a, b) => b.banRate - a.banRate)[0];
    const best = [...myStats].filter((s) => s.played >= 10).sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))[0];
    return { fragile, replaceable, mostBanned, best };
  }, [myStats]);

  if (matches.length === 0) {
    return <div className="empty-inline"><p>沒有符合條件的對局</p><span>先放寬篩選條件。</span></div>;
  }

  return (
    <div className="stats">
      <PlayerBreakdown matches={matches} />

      <nav className="subtabs" aria-label="統計分類">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            className={section === s.key ? "on" : ""}
            onClick={() => setSection(s.key)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {section === "monsters" && (
        <>
          {(insights.fragile || insights.mostBanned) && (
            <div className="insights">
              {insights.mostBanned && insights.mostBanned.banned > 0 && (
                <div className="insight">
                  <span>最常被 ban</span>
                  <div className="insight-body">
                    <MonsterIcon id={insights.mostBanned.id} size={30} />
                    <b>{monsterName(insights.mostBanned.id)}</b>
                    <em>
                      {insights.mostBanned.banned} 次・{insights.mostBanned.banRate.toFixed(0)}%
                    </em>
                  </div>
                </div>
              )}
              {insights.fragile && (
                <div className="insight">
                  <span>被 ban 後最慘</span>
                  <div className="insight-body">
                    <MonsterIcon id={insights.fragile.id} size={30} />
                    <b>{monsterName(insights.fragile.id)}</b>
                    <em>
                      勝率 {(insights.fragile.bannedWinRate ?? 0).toFixed(0)}%（{insights.fragile.bannedGames} 場）
                    </em>
                  </div>
                </div>
              )}
              {insights.replaceable && (
                <div className="insight">
                  <span>被 ban 後最穩</span>
                  <div className="insight-body">
                    <MonsterIcon id={insights.replaceable.id} size={30} />
                    <b>{monsterName(insights.replaceable.id)}</b>
                    <em>
                      勝率 {(insights.replaceable.bannedWinRate ?? 0).toFixed(0)}%（{insights.replaceable.bannedGames} 場）
                    </em>
                  </div>
                </div>
              )}
              {insights.best && (
                <div className="insight">
                  <span>出戰勝率最高</span>
                  <div className="insight-body">
                    <MonsterIcon id={insights.best.id} size={30} />
                    <b>{monsterName(insights.best.id)}</b>
                    <em>
                      {(insights.best.winRate ?? 0).toFixed(0)}%（{insights.best.played} 場）
                    </em>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="two-col">
            <MonsterTable rows={myStats} side="my" caption="我的魔靈" />
            <MonsterTable rows={oppStats} side="opp" caption="對手的魔靈" />
          </div>
        </>
      )}

      {section === "matchup" && <Matchup matches={matches} />}
      {section === "tempo" && <Tempo matches={matches} tally={tally} />}
      {section === "opponents" && <Opponents matches={matches} />}
    </div>
  );
}
