import { useState } from "react";
import type { MatchPayload } from "../lib/types";
import type { Tally } from "../lib/stats";

interface Props {
  payload: MatchPayload;
  tally: Tally;
  /** 目前顯示範圍內的總場數（未套用其他篩選） */
  matchCount: number;
  /** 例如 S39 或 S37–39 */
  seasonLabel: string;
}

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-US"));

function rateClass(r: number | null): string {
  if (r === null) return "na";
  if (r >= 55) return "good";
  if (r < 45) return "bad";
  return "mid";
}

export function PlayerHeader({ payload, tally, matchCount, seasonLabel }: Props) {
  const s = payload.summary;
  const [imgOk, setImgOk] = useState(true);

  const winRate = tally.winRate ?? s.winRate;
  const recent = s.daily.slice(-21);
  const maxPlayed = Math.max(1, ...recent.map((d) => d.played));
  const multi = seasonLabel.includes("–");

  return (
    <section className="player">
      <div className="player-id">
        <div className="avatar">
          {s.image && imgOk ? (
            <img src={s.image} alt="" onError={() => setImgOk(false)} loading="lazy" />
          ) : (
            <span>{(s.username || payload.player.username || "?").slice(0, 1)}</span>
          )}
        </div>
        <div className="player-meta">
          <h1>{s.username || payload.player.username || `#${payload.player.id}`}</h1>
          <p className="player-sub">
            <span className="chip">ID {payload.player.id}</span>
            {s.country && <span className="chip">{s.country}</span>}
            <span className="chip">{seasonLabel || `S${payload.season}`}</span>
            {payload.sample && <span className="chip warn">示範資料</span>}
          </p>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <span className="tile-k">{multi ? "範圍勝率" : "本季勝率"}</span>
          <strong className={`tile-v ${rateClass(winRate)}`}>
            {winRate === null ? "–" : `${winRate.toFixed(1)}%`}
          </strong>
          <span className="tile-s">
            {tally.wins}勝 {tally.losses}負{tally.draws ? ` ${tally.draws}和` : ""}
          </span>
        </div>

        <div className="tile">
          <span className="tile-k">目前分數</span>
          <strong className="tile-v">{fmt(s.score)}</strong>
          <span className="tile-s">
            排名 {fmt(s.rank)}
            {s.peak !== null ? `・峰值 ${s.peak}` : ""}
          </span>
        </div>

        <div className="tile">
          <span className="tile-k">紀錄場數</span>
          <strong className="tile-v">{fmt(matchCount)}</strong>
          <span className="tile-s">
            {multi ? `${seasonLabel}・已載入` : s.total && s.total !== matchCount ? `官方總計 ${s.total}` : "已載入全部對局"}
          </span>
        </div>

        <div className="tile">
          <span className="tile-k">連勝</span>
          <strong className={`tile-v ${(s.currentStreak ?? 0) < 0 ? "bad" : "good"}`}>
            {s.currentStreak === null ? "–" : s.currentStreak > 0 ? `+${s.currentStreak}` : s.currentStreak}
          </strong>
          <span className="tile-s">最佳 {s.bestStreak ?? "–"} 連勝</span>
        </div>
      </div>

      {recent.length > 0 && (
        <div className="spark" title="最近 21 天：柱高 = 場數，顏色 = 勝率">
          {recent.map((d) => {
            const wr = d.played ? (d.won / d.played) * 100 : null;
            return (
              <div className="spark-col" key={d.date}>
                <div
                  className={`spark-bar ${rateClass(wr)}`}
                  style={{ height: `${Math.max(6, (d.played / maxPlayed) * 100)}%` }}
                  title={`${d.date}・${d.won}/${d.played} 勝${wr === null ? "" : `（${wr.toFixed(0)}%）`}`}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
