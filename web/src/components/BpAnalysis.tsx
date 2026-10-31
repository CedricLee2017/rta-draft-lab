import { useMemo, useState } from "react";
import {
  banImpact,
  bannedAgainst,
  bpSummary,
  coreStats,
  openerStats,
  speedStats,
  threatStats,
} from "../lib/bp";
import { monsterName } from "../lib/monsters";
import { comboStats } from "../lib/stats";
import type { RtaMatch } from "../lib/types";
import { MonsterIcon } from "./MonsterIcon";

type Section = "openings" | "bans" | "speed" | "threats" | "combos";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "openings", label: "開場" },
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

const pct = (n: number) => `${n.toFixed(1)}%`;

export function BpAnalysis({ matches }: { matches: RtaMatch[] }) {
  const [section, setSection] = useState<Section>("openings");

  const summary = useMemo(() => bpSummary(matches), [matches]);
  const myFirstOpeners = useMemo(() => openerStats(matches, "my", true), [matches]);
  const mySecondOpeners = useMemo(() => openerStats(matches, "my", false), [matches]);
  const oppFirstOpeners = useMemo(() => openerStats(matches, "opp", false), [matches]);
  const oppSecondOpeners = useMemo(() => openerStats(matches, "opp", true), [matches]);
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
