import type { Tally } from "../lib/stats";
import type { RosterEntry } from "./RosterBar";

interface Props {
  entries: RosterEntry[];
  tally: Tally;
  /** 顯示範圍內的總場數（未套用其他篩選） */
  matchCount: number;
  seasonLabel: string;
}

function rateClass(r: number | null): string {
  if (r === null) return "na";
  if (r >= 55) return "good";
  if (r < 45) return "bad";
  return "mid";
}

/**
 * 選了多位玩家時的首頁摘要。
 *
 * 每筆對戰都以「該玩家自己的視角」記錄（他的 5 隻、他被 ban 的那隻），
 * 所以合併後看到的選角 / ban / 勝率就是這幾位玩家共同的習慣。
 */
export function MultiHeader({ entries, tally, matchCount, seasonLabel }: Props) {
  const winRate = tally.winRate;
  const avg = entries.length ? Math.round(matchCount / entries.length) : 0;

  return (
    <section className="player multi">
      <div className="player-id">
        <div className="avatar-stack" aria-hidden>
          {entries.slice(0, 5).map((e) => (
            <span className="avatar sm" key={e.id} title={e.name}>
              <span>{e.name.replace(/^#/, "").slice(0, 1)}</span>
            </span>
          ))}
          {entries.length > 5 && <span className="avatar sm more">+{entries.length - 5}</span>}
        </div>
        <div className="player-meta">
          <h1>{entries.length} 位玩家・合併分析</h1>
          <p className="player-sub">
            {entries.map((e) => (
              <span className="chip" key={e.id}>
                {e.name}
              </span>
            ))}
            <span className="chip">{seasonLabel}</span>
          </p>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="tile-k">合併勝率</span>
          <strong className={`tile-v ${rateClass(winRate)}`}>
            {winRate === null ? "–" : `${winRate.toFixed(1)}%`}
          </strong>
          <span className="tile-s">
            {tally.wins}勝 {tally.losses}負{tally.draws ? ` ${tally.draws}和` : ""}
          </span>
        </div>

        <div className="tile">
          <span className="tile-k">合計場數</span>
          <strong className="tile-v">{matchCount.toLocaleString("en-US")}</strong>
          <span className="tile-s">{seasonLabel}・已載入</span>
        </div>

        <div className="tile">
          <span className="tile-k">玩家數</span>
          <strong className="tile-v">{entries.length}</strong>
          <span className="tile-s">每人平均 {avg} 場</span>
        </div>

        <div className="tile">
          <span className="tile-k">合併方式</span>
          <strong className="tile-v" style={{ fontSize: 16 }}>
            各自視角
          </strong>
          <span className="tile-s">選角／ban 統計不分你我</span>
        </div>
      </div>
    </section>
  );
}
