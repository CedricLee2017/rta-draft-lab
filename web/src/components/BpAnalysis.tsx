import { useMemo, useState } from "react";
import {
  banImpact,
  bannedAgainst,
  bpSummary,
  coreStats,
  openerStats,
  secondPickResponses,
  speedStats,
  threatStats,
} from "../lib/bp";
import { monsterName } from "../lib/monsters";
import { comboStats } from "../lib/stats";
import type { RtaMatch } from "../lib/types";
import { MonsterIcon } from "./MonsterIcon";

type Section = "openings" | "responses" | "bans" | "speed" | "threats" | "combos";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "openings", label: "開場" },
  { key: "responses", label: "後手應對" },
  { key: "bans", label: "Ban 效益" },
  { key: "speed", label: "速度線" },
  { key: "threats", label: "威脅與核心" },
  { key: "combos", label: "組合" },
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

function Mon({ id, size = 28 }: { id: number; size?: number }) {
  return (
    <div className="tbl-mon">
      <MonsterIcon id={id} size={size} />
      <span>{monsterName(id)}</span>
    </div>
  );
}

/** 兩隻魔靈的組合（後手 2 pick / 對手 4・5 手） */
function Pair({ a, b, size = 26 }: { a: number; b: number; size?: number }) {
  return (
    <div className="pair">
      <MonsterIcon id={a} size={size} />
      <span className="pair-x" aria-hidden>
        +
      </span>
      <MonsterIcon id={b} size={size} />
      <span className="pair-name">
        {monsterName(a)} + {monsterName(b)}
      </span>
    </div>
  );
}

/** 勝率差（pt），正數 = 比基準好 */
function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="na">–</span>;
  return (
    <b className={value >= 0 ? "good" : "bad"}>
      {value >= 0 ? "+" : ""}
      {value.toFixed(1)}pt
    </b>
  );
}

const pct = (n: number) => `${n.toFixed(1)}%`;

export function BpAnalysis({ matches }: { matches: RtaMatch[] }) {
  const [section, setSection] = useState<Section>("openings");
  const [openerQuery, setOpenerQuery] = useState("");
  const [selectedOpener, setSelectedOpener] = useState<number | null>(null);
  const [selectedPair, setSelectedPair] = useState<{ a: number; b: number } | null>(null);

  const summary = useMemo(() => bpSummary(matches), [matches]);
  const myFirstOpeners = useMemo(() => openerStats(matches, "my", true), [matches]);
  const mySecondOpeners = useMemo(() => openerStats(matches, "my", false), [matches]);
  const oppFirstOpeners = useMemo(() => openerStats(matches, "opp", false), [matches]);
  const oppSecondOpeners = useMemo(() => openerStats(matches, "opp", true), [matches]);
  const responses = useMemo(() => secondPickResponses(matches), [matches]);
  const bans = useMemo(() => banImpact(matches, 8), [matches]);
  const banned = useMemo(() => bannedAgainst(matches, 5), [matches]);
  const speed = useMemo(() => speedStats(matches), [matches]);
  const threats = useMemo(() => threatStats(matches, 15), [matches]);
  const core = useMemo(() => coreStats(matches, 25), [matches]);
  const combos = useMemo(() => comboStats(matches, 15), [matches]);

  if (matches.length === 0) {
    return (
      <div className="empty-inline">
        <p>沒有符合條件的對局</p>
        <span>先放寬篩選，或載入更多賽季。</span>
      </div>
    );
  }

  const impactTop = [...bans]
    .filter((r) => r.banGames >= 10 && r.openGames >= 10)
    .sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0))
    .slice(0, 12);

  const comboTop = [...combos]
    .filter((c) => c.games >= 15)
    .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
    .slice(0, 12);

  const responseBase = summary.firstSplit.second.winRate;
  const openerQueryNorm = openerQuery.trim().toLowerCase();
  const responseRows = openerQueryNorm
    ? responses.filter(
        (r) =>
          monsterName(r.id).toLowerCase().includes(openerQueryNorm) ||
          String(r.id).includes(openerQueryNorm),
      )
    : responses;
  const currentOpener =
    responseRows.find((r) => r.id === selectedOpener) ?? responseRows[0] ?? null;
  const currentPair =
    currentOpener && selectedPair
      ? currentOpener.pairs.find(
          (p) => p.a === selectedPair.a && p.b === selectedPair.b,
        ) ?? null
      : null;
  const followRows = currentPair
    ? currentPair.followUps
    : currentOpener?.followUps ?? [];
  const topPair = currentOpener?.pairs[0] ?? null;
  const bestPair = currentOpener
    ? currentOpener.pairs
        .filter((p) => p.games >= 3)
        .sort(
          (a, b) =>
            (b.winRate ?? -1) - (a.winRate ?? -1) ||
            b.games - a.games ||
            a.a - b.a,
        )[0] ?? null
    : null;
  const openerDelta =
    currentOpener && currentOpener.winRate !== null && responseBase !== null
      ? currentOpener.winRate - responseBase
      : null;

  return (
    <div className="bp">
      <nav className="subtabs" aria-label="BP 分析分類">
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

      <p className="bp-note">
        以目前篩選的 <b>{summary.total}</b> 場計算（勝率分母 {summary.decided} 場，和局不計）。
        速度用「基礎速度＋隊長技能」推估，沒有符文與逐手順序，樣本小的列請保守解讀。
      </p>

      {section === "openings" && (
        <>
          <div className="split-row">
            <div className="card split">
              <span className="split-k">首搶勝率</span>
              <strong className="split-v">
                {summary.firstSplit.first.winRate === null ? "–" : pct(summary.firstSplit.first.winRate)}
              </strong>
              <span className="split-s">
                {summary.firstSplit.first.wins}勝 {summary.firstSplit.first.losses}負・
                {summary.firstSplit.first.games} 場
              </span>
            </div>
            <div className="card split">
              <span className="split-k">後手勝率</span>
              <strong className="split-v">
                {summary.firstSplit.second.winRate === null ? "–" : pct(summary.firstSplit.second.winRate)}
              </strong>
              <span className="split-s">
                {summary.firstSplit.second.wins}勝 {summary.firstSplit.second.losses}負・
                {summary.firstSplit.second.games} 場
              </span>
            </div>
            <div className="card split">
              <span className="split-k">速度隊長使用</span>
              <strong className="split-v">{Math.round(summary.speedLeadUse.pct)}%</strong>
              <span className="split-s">{summary.speedLeadUse.games} 場帶速度隊長</span>
            </div>
          </div>

          <div className="two-col">
            <div className="card">
              <div className="card-head">
                <h3>我方首搶時的第一手</h3>
                <span className="card-note">第一手選角的勝率</span>
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
                  {myFirstOpeners.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td><Mon id={r.id} /></td>
                      <td>{r.games}</td>
                      <td><Rate value={r.winRate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>我方後手時的第一手</h3>
                <span className="card-note">被搶走首選後的開局</span>
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
                  {mySecondOpeners.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td><Mon id={r.id} /></td>
                      <td>{r.games}</td>
                      <td><Rate value={r.winRate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="two-col" style={{ marginTop: 12 }}>
            <div className="card">
              <div className="card-head">
                <h3>對手首搶時的第一手</h3>
                <span className="card-note">對手這樣開局時，我的勝率</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">對手第一手</th>
                    <th scope="col">場數</th>
                    <th scope="col">我的勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {oppFirstOpeners.slice(0, 8).map((r) => (
                    <tr key={r.id}>
                      <td><Mon id={r.id} /></td>
                      <td>{r.games}</td>
                      <td><Rate value={r.winRate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>對手後手時的第一手</h3>
                <span className="card-note">我首搶時，對手怎麼回應</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">對手第一手</th>
                    <th scope="col">場數</th>
                    <th scope="col">我的勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {oppSecondOpeners.slice(0, 6).map((r) => (
                    <tr key={r.id}>
                      <td><Mon id={r.id} /></td>
                      <td>{r.games}</td>
                      <td><Rate value={r.winRate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {section === "responses" && (
        <>
          {responses.length === 0 ? (
            <div className="empty-inline">
              <p>目前沒有「對手先手」的對局</p>
              <span>
                把上面的首搶方改成「全部」或「對手首搶」，或載入更多賽季。
              </span>
            </div>
          ) : (
            <>
              <div className="split-row">
                <div className="card split">
                  <span className="split-k">後手場數</span>
                  <strong className="split-v">{summary.firstSplit.second.games}</strong>
                  <span className="split-s">
                    佔全部{" "}
                    {summary.total
                      ? Math.round(
                          (summary.firstSplit.second.games / summary.total) * 100,
                        )
                      : 0}
                    %
                  </span>
                </div>
                <div className="card split">
                  <span className="split-k">後手勝率</span>
                  <strong className="split-v">
                    {summary.firstSplit.second.winRate === null
                      ? "–"
                      : pct(summary.firstSplit.second.winRate)}
                  </strong>
                  <span className="split-s">
                    {summary.firstSplit.second.wins}勝{" "}
                    {summary.firstSplit.second.losses}負
                  </span>
                </div>
                <div className="card split">
                  <span className="split-k">對手最常首搶</span>
                  <strong className="split-v" style={{ fontSize: 18 }}>
                    {monsterName(responses[0].id)}
                  </strong>
                  <span className="split-s">
                    {responses[0].games} 場・我的勝率{" "}
                    {responses[0].winRate === null
                      ? "–"
                      : pct(responses[0].winRate)}
                  </span>
                </div>
              </div>

              <div className="card">
                <div className="card-head">
                  <h3>對手首搶 → 我的 2 pick</h3>
                  <span className="card-note">
                    點一列展開；2 pick＝第 2、3 手
                  </span>
                  <input
                    className="text response-search"
                    value={openerQuery}
                    onChange={(e) => {
                      setOpenerQuery(e.target.value);
                      setSelectedPair(null);
                    }}
                    placeholder="搜尋對手首搶…"
                    aria-label="搜尋對手首搶"
                  />
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th scope="col">對手首搶</th>
                        <th scope="col">場數</th>
                        <th scope="col">我的勝率</th>
                        <th scope="col">vs 後手平均</th>
                        <th scope="col">最常應對（第 2＋3 手）</th>
                        <th scope="col">佔比</th>
                        <th scope="col">該組合勝率</th>
                        <th scope="col" />
                      </tr>
                    </thead>
                    <tbody>
                      {responseRows.slice(0, 20).map((r) => {
                        const top = r.pairs[0];
                        const active = currentOpener?.id === r.id;
                        return (
                          <tr
                            key={r.id}
                            className={`selectable${active ? " selected" : ""}`}
                            onClick={() => {
                              setSelectedOpener(r.id);
                              setSelectedPair(null);
                            }}
                          >
                            <td>
                              <Mon id={r.id} />
                            </td>
                            <td>{r.games}</td>
                            <td>
                              <Rate value={r.winRate} />
                            </td>
                            <td>
                              <Delta
                                value={
                                  responseBase !== null && r.winRate !== null
                                    ? r.winRate - responseBase
                                    : null
                                }
                              />
                            </td>
                            <td>
                              {top ? (
                                <Pair a={top.a} b={top.b} />
                              ) : (
                                <span className="na">–</span>
                              )}
                            </td>
                            <td>{top ? `${top.share.toFixed(0)}%` : "–"}</td>
                            <td>
                              {top ? (
                                <Rate value={top.winRate} games={top.games} />
                              ) : (
                                <span className="na">–</span>
                              )}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="row-btn"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedOpener(r.id);
                                  setSelectedPair(null);
                                }}
                              >
                                {active ? "查看中" : "查看"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                      {responseRows.length === 0 && (
                        <tr>
                          <td colSpan={8} className="tbl-empty">
                            沒有符合的對手首搶
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="card-foot">
                  樣本會跟著賽季與上面的篩選變動；想看更穩定的數字，把賽季範圍拉長（例如
                  37–39）。
                  {responseRows.length > 20 &&
                    " 只顯示前 20 個（依場數排序），可用上方搜尋找其他首搶。"}
                </div>
              </div>

              {currentOpener && (
                <div className="card response-detail">
                  <div className="card-head">
                    <MonsterIcon id={currentOpener.id} size={28} />
                    <h3>對手首搶 {monsterName(currentOpener.id)}</h3>
                    <span className="card-note">
                      {currentOpener.games} 場・我的勝率{" "}
                      <Rate value={currentOpener.winRate} />・vs 後手平均{" "}
                      <Delta value={openerDelta} />
                    </span>
                  </div>

                  <div className="response-badges">
                    <span>
                      實際出戰 <b>{currentOpener.played}</b> 場・勝率{" "}
                      <Rate value={currentOpener.playedWinRate} />
                    </span>
                    <span>
                      被我 ban <b>{currentOpener.banned}</b> 場・勝率{" "}
                      <Rate value={currentOpener.bannedWinRate} />
                    </span>
                    {topPair && (
                      <span>
                        最常應對{" "}
                        <b>
                          {monsterName(topPair.a)} + {monsterName(topPair.b)}
                        </b>
                        ・{topPair.games} 場（{topPair.share.toFixed(0)}%）・
                        <Rate value={topPair.winRate} />
                      </span>
                    )}
                  </div>

                  <div className="response-insight">
                    <div>
                      <b>最常出：</b>
                      {topPair ? (
                        <>
                          <Pair a={topPair.a} b={topPair.b} />
                          {topPair.games} 場（{topPair.share.toFixed(0)}%），勝率{" "}
                          <Rate value={topPair.winRate} games={topPair.games} />
                          ，與此開局平均差 <Delta value={topPair.delta} />。
                        </>
                      ) : (
                        <span className="na">沒有可分析的組合</span>
                      )}
                    </div>
                    {bestPair &&
                      (!topPair ||
                        bestPair.a !== topPair.a ||
                        bestPair.b !== topPair.b) && (
                        <div>
                          <b>≥3 場中勝率最高：</b>
                          <Pair a={bestPair.a} b={bestPair.b} />
                          {bestPair.games} 場，勝率{" "}
                          <Rate value={bestPair.winRate} games={bestPair.games} />
                          （<Delta value={bestPair.delta} />）。
                        </div>
                      )}
                    {topPair && topPair.delta !== null && topPair.delta < -5 && (
                      <div className="response-hint">
                        最常出的組合低於此開局平均；可以比較下面的替代組合，但樣本小的列不要當成穩定結論。
                      </div>
                    )}
                  </div>

                  <div className="two-col">
                    <div>
                      <div className="card-head">
                        <h3>我的 2 pick 組合</h3>
                        <span className="card-note">
                          {currentPair
                            ? "右邊只會看這組的後續"
                            : "點一組看對手接著的 4/5 手"}
                        </span>
                      </div>
                      <div className="tbl-wrap">
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th scope="col">我的 2 pick</th>
                              <th scope="col">場數</th>
                              <th scope="col">佔比</th>
                              <th scope="col">勝率</th>
                              <th scope="col">與此開局差</th>
                              <th scope="col" />
                            </tr>
                          </thead>
                          <tbody>
                            {currentOpener.pairs.map((p) => {
                              const active =
                                currentPair?.a === p.a && currentPair?.b === p.b;
                              return (
                                <tr
                                  key={`${p.a}:${p.b}`}
                                  className={`selectable${active ? " selected" : ""}`}
                                  onClick={() =>
                                    setSelectedPair(
                                      active ? null : { a: p.a, b: p.b },
                                    )
                                  }
                                >
                                  <td>
                                    <Pair a={p.a} b={p.b} />
                                  </td>
                                  <td>{p.games}</td>
                                  <td>{p.share.toFixed(0)}%</td>
                                  <td>
                                    <Rate value={p.winRate} games={p.games} />
                                  </td>
                                  <td>
                                    <Delta value={p.delta} />
                                  </td>
                                  <td>
                                    <button
                                      type="button"
                                      className="row-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedPair(
                                          active ? null : { a: p.a, b: p.b },
                                        );
                                      }}
                                    >
                                      {active ? "取消" : "後續"}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                            {currentOpener.pairs.length === 0 && (
                              <tr>
                                <td colSpan={6} className="tbl-empty">
                                  沒有可分析的 2 pick 組合
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      <div className="card-foot">
                        「2 pick」是同一個第 2/3 手區塊，陣列順序不影響組合；樣本
                        &lt;3 場的組合只供參考。
                      </div>
                    </div>

                    <div>
                      <div className="card-head">
                        <h3>
                          {currentPair
                            ? `當我出 ${monsterName(currentPair.a)} + ${monsterName(currentPair.b)} 時`
                            : "對手接著的第 4/5 手"}
                        </h3>
                        <span className="card-note">
                          {currentPair
                            ? `對手接著最常出什麼（這組 ${currentPair.games} 場）`
                            : `全部 ${currentOpener.games} 場`}
                        </span>
                        {currentPair && (
                          <button
                            type="button"
                            className="link"
                            onClick={() => setSelectedPair(null)}
                          >
                            看全部
                          </button>
                        )}
                      </div>
                      <div className="tbl-wrap">
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th scope="col">對手 4/5 手</th>
                              <th scope="col">場數</th>
                              <th scope="col">佔比</th>
                              <th scope="col">我的勝率</th>
                            </tr>
                          </thead>
                          <tbody>
                            {followRows.slice(0, 10).map((f) => (
                              <tr key={`${f.a}:${f.b}`}>
                                <td>
                                  <Pair a={f.a} b={f.b} />
                                </td>
                                <td>{f.games}</td>
                                <td>{f.share.toFixed(0)}%</td>
                                <td>
                                  <Rate value={f.winRate} games={f.games} />
                                </td>
                              </tr>
                            ))}
                            {followRows.length === 0 && (
                              <tr>
                                <td colSpan={4} className="tbl-empty">
                                  這組沒有足夠的後續資料
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      {followRows.length > 10 && (
                        <div className="card-foot">
                          只顯示前 10 種組合（依場數）。
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="two-col" style={{ marginTop: 12 }}>
                    <div>
                      <div className="card-head">
                        <h3>我的第 2 手（單隻）</h3>
                        <span className="card-note">依陣列順序近似</span>
                      </div>
                      <div className="tbl-wrap">
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th scope="col">魔靈</th>
                              <th scope="col">場數</th>
                              <th scope="col">勝率</th>
                              <th scope="col">與此開局差</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentOpener.firstPicks.map((p) => (
                              <tr key={p.id}>
                                <td>
                                  <Mon id={p.id} />
                                </td>
                                <td>{p.games}</td>
                                <td>
                                  <Rate value={p.winRate} games={p.games} />
                                </td>
                                <td>
                                  <Delta value={p.delta} />
                                </td>
                              </tr>
                            ))}
                            {currentOpener.firstPicks.length === 0 && (
                              <tr>
                                <td colSpan={4} className="tbl-empty">
                                  沒有資料
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <div className="card-head">
                        <h3>我的第 3 手（單隻）</h3>
                        <span className="card-note">依陣列順序近似</span>
                      </div>
                      <div className="tbl-wrap">
                        <table className="tbl">
                          <thead>
                            <tr>
                              <th scope="col">魔靈</th>
                              <th scope="col">場數</th>
                              <th scope="col">勝率</th>
                              <th scope="col">與此開局差</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentOpener.secondPicks.map((p) => (
                              <tr key={p.id}>
                                <td>
                                  <Mon id={p.id} />
                                </td>
                                <td>{p.games}</td>
                                <td>
                                  <Rate value={p.winRate} games={p.games} />
                                </td>
                                <td>
                                  <Delta value={p.delta} />
                                </td>
                              </tr>
                            ))}
                            {currentOpener.secondPicks.length === 0 && (
                              <tr>
                                <td colSpan={4} className="tbl-empty">
                                  沒有資料
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {section === "bans" && (
        <>
          <div className="card">
            <div className="card-head">
              <h3>Ban 效益：對手出這隻時，ban 與不 ban 的勝率</h3>
              <span className="card-note">Δ 為正 = ban 掉之後勝率更高（ban／不 ban 各至少 10 場）</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">魔靈</th>
                    <th scope="col">對手出過</th>
                    <th scope="col">ban 次數</th>
                    <th scope="col">ban 率</th>
                    <th scope="col">ban 後勝率</th>
                    <th scope="col">不 ban 勝率</th>
                    <th scope="col">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {impactTop.map((r) => (
                    <tr key={r.id}>
                      <td><Mon id={r.id} /></td>
                      <td>{r.faced}</td>
                      <td>{r.banned}</td>
                      <td>{r.banRate.toFixed(0)}%</td>
                      <td><Rate value={r.banWinRate} games={r.banGames} /></td>
                      <td><Rate value={r.openWinRate} games={r.openGames} /></td>
                      <td>
                        {r.delta === null ? (
                          <span className="na">–</span>
                        ) : (
                          <b className={r.delta >= 0 ? "good" : "bad"}>
                            {r.delta >= 0 ? "+" : ""}
                            {r.delta.toFixed(1)}pt
                          </b>
                        )}
                      </td>
                    </tr>
                  ))}
                  {impactTop.length === 0 && (
                    <tr>
                      <td colSpan={7} className="tbl-empty">樣本不足</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-head">
              <h3>我的角色被 ban 時</h3>
              <span className="card-note">被 ban 後勝率 vs 有出戰時勝率</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">魔靈</th>
                    <th scope="col">被 ban</th>
                    <th scope="col">被 ban 後勝率</th>
                    <th scope="col">出戰場數</th>
                    <th scope="col">出戰勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {banned.slice(0, 12).map((r) => (
                    <tr key={r.id}>
                      <td><Mon id={r.id} /></td>
                      <td>{r.banned}</td>
                      <td><Rate value={r.bannedWinRate} /></td>
                      <td>{r.playedGames}</td>
                      <td><Rate value={r.playedWinRate} /></td>
                    </tr>
                  ))}
                  {banned.length === 0 && (
                    <tr>
                      <td colSpan={5} className="tbl-empty">樣本不足</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {section === "speed" && (
        <>
          <div className="split-row">
            <div className="card split">
              <span className="split-k">我方最快 ＞ 對手</span>
              <strong className={`split-v ${speed.faster.winRate !== null && speed.faster.winRate >= 50 ? "good" : "bad"}`}>
                {speed.faster.winRate === null ? "–" : pct(speed.faster.winRate)}
              </strong>
              <span className="split-s">{speed.faster.games} 場</span>
            </div>
            <div className="card split">
              <span className="split-k">我方最快 ＜ 對手</span>
              <strong className={`split-v ${speed.slower.winRate !== null && speed.slower.winRate >= 50 ? "good" : "bad"}`}>
                {speed.slower.winRate === null ? "–" : pct(speed.slower.winRate)}
              </strong>
              <span className="split-s">{speed.slower.games} 場</span>
            </div>
            <div className="card split">
              <span className="split-k">速度隊長使用</span>
              <strong className="split-v">{Math.round(summary.speedLeadUse.pct)}%</strong>
              <span className="split-s">
                有速度隊長 {speed.speedLead.tally.winRate === null ? "–" : pct(speed.speedLead.tally.winRate)}
                ・沒有 {speed.nonSpeedLead.tally.winRate === null ? "–" : pct(speed.nonSpeedLead.tally.winRate)}
              </span>
            </div>
          </div>

          <div className="two-col">
            <div className="card">
              <div className="card-head">
                <h3>前二平均速度差</h3>
                <span className="card-note">正數 = 我方較快</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">差距</th>
                    <th scope="col">場數</th>
                    <th scope="col">勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {speed.buckets.map((b) => (
                    <tr key={b.label}>
                      <td>{b.label}</td>
                      <td>{b.tally.games}</td>
                      <td><Rate value={b.tally.winRate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card">
              <div className="card-head">
                <h3>速度落後時的配置</h3>
                <span className="card-note">
                  我方最快較慢的 {speed.behind.games} 場
                </span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">配置</th>
                    <th scope="col">場數</th>
                    <th scope="col">勝率</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>用速度隊長</td>
                    <td>{speed.behind.withSpeedLead.games}</td>
                    <td><Rate value={speed.behind.withSpeedLead.winRate} /></td>
                  </tr>
                  <tr>
                    <td>不用速度隊長</td>
                    <td>{speed.behind.withoutSpeedLead.games}</td>
                    <td><Rate value={speed.behind.withoutSpeedLead.winRate} /></td>
                  </tr>
                  {speed.behind.supports.map((s) => (
                    <tr key={s.count}>
                      <td>輔助 {s.count} 隻</td>
                      <td>{s.tally.games}</td>
                      <td><Rate value={s.tally.winRate} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {section === "threats" && (
        <>
          <div className="card">
            <div className="card-head">
              <h3>對手出戰這隻時，我的勝率</h3>
              <span className="card-note">只看實際出戰（被 ban 的不計）・至少 15 場・越低＝越難打</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">對手的魔靈</th>
                    <th scope="col">場數</th>
                    <th scope="col">我的勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {threats.slice(0, 12).map((r) => (
                    <tr key={r.id}>
                      <td><Mon id={r.id} /></td>
                      <td>{r.games}</td>
                      <td><Rate value={r.winRate} /></td>
                    </tr>
                  ))}
                  {threats.length === 0 && (
                    <tr>
                      <td colSpan={3} className="tbl-empty">樣本不足</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-head">
              <h3>核心：有帶 / 沒帶這隻的勝率</h3>
              <span className="card-note">實際出戰 4 隻才算「有帶」，至少 25 場</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th scope="col">魔靈</th>
                    <th scope="col">有帶</th>
                    <th scope="col">有帶勝率</th>
                    <th scope="col">沒帶</th>
                    <th scope="col">沒帶勝率</th>
                    <th scope="col">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {core.slice(0, 12).map((r) => (
                    <tr key={r.id}>
                      <td><Mon id={r.id} /></td>
                      <td>{r.withGames}</td>
                      <td><Rate value={r.withWinRate} /></td>
                      <td>{r.withoutGames}</td>
                      <td><Rate value={r.withoutWinRate} /></td>
                      <td>
                        {r.delta === null ? (
                          <span className="na">–</span>
                        ) : (
                          <b className={r.delta >= 0 ? "good" : "bad"}>
                            {r.delta >= 0 ? "+" : ""}
                            {r.delta.toFixed(1)}pt
                          </b>
                        )}
                      </td>
                    </tr>
                  ))}
                  {core.length === 0 && (
                    <tr>
                      <td colSpan={6} className="tbl-empty">樣本不足</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {section === "combos" && (
        <div className="card">
          <div className="card-head">
            <h3>雙人組合（同時出戰 ≥ 15 場）</h3>
            <span className="card-note">依勝率排序</span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">組合</th>
                  <th scope="col">場數</th>
                  <th scope="col">勝率</th>
                </tr>
              </thead>
              <tbody>
                {comboTop.map((c) => (
                  <tr key={`${c.a}-${c.b}`}>
                    <td>
                      <div className="tbl-mon">
                        <MonsterIcon id={c.a} size={26} />
                        <MonsterIcon id={c.b} size={26} />
                        <span>
                          {monsterName(c.a)} + {monsterName(c.b)}
                        </span>
                      </div>
                    </td>
                    <td>{c.games}</td>
                    <td><Rate value={c.winRate} /></td>
                  </tr>
                ))}
                {comboTop.length === 0 && (
                  <tr>
                    <td colSpan={3} className="tbl-empty">樣本不足</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
