import type { RtaMatch } from "../lib/types";
import { MonsterIcon } from "./MonsterIcon";

const PAGE_SIZE = 20;

const pad = (n: number) => String(n).padStart(2, "0");

function fmtTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 16).replace("T", " ");
  const d = new Date(t);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resultOf(m: RtaMatch): "win" | "lose" | "draw" {
  if (m.won === true) return "win";
  if (m.won === false) return "lose";
  return "draw";
}

function MatchCard({ m }: { m: RtaMatch }) {
  const r = resultOf(m);
  const diff = m.myScore !== null && m.oppScore !== null ? m.myScore - m.oppScore : null;

  return (
    <article className={`match ${r}`}>
      <header className="match-head">
        <span className={`badge ${r}`}>{r === "win" ? "勝" : r === "lose" ? "負" : "和"}</span>
        <span className={`badge ${m.firstPick ? "pick" : "second"}`}>{m.firstPick ? "首搶" : "後手"}</span>
        <time dateTime={m.time}>{fmtTime(m.time)}</time>
        <span className="match-opp" title={`ID ${m.oppId ?? "?"}`}>
          {m.oppName || "未知對手"}
        </span>
        <span className="match-score">
          {m.myScore ?? "–"}
          <i>:</i>
          {m.oppScore ?? "–"}
          {diff !== null && diff !== 0 && (
            <b className={diff > 0 ? "good" : "bad"}>{diff > 0 ? `+${diff}` : diff}</b>
          )}
        </span>
      </header>

      <div className="match-row">
        <span className="row-tag">我方</span>
        <div className="icons">
          {m.my.map((id) => (
            <MonsterIcon
              key={id}
              id={id}
              size={36}
              banned={id === m.myBan}
              leader={id === m.myLeader}
            />
          ))}
        </div>
      </div>

      <div className="match-row">
        <span className="row-tag opp">對手</span>
        <div className="icons">
          {m.opp.map((id) => (
            <MonsterIcon
              key={id}
              id={id}
              size={36}
              banned={id === m.oppBan}
              leader={id === m.oppLeader}
            />
          ))}
        </div>
      </div>
    </article>
  );
}

interface Props {
  matches: RtaMatch[];
  page: number;
  onPage: (page: number) => void;
}

export function MatchList({ matches, page, onPage }: Props) {
  const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const start = (current - 1) * PAGE_SIZE;
  const slice = matches.slice(start, start + PAGE_SIZE);

  if (matches.length === 0) {
    return (
      <div className="empty-inline">
        <p>沒有符合條件的對局</p>
        <span>試著放寬篩選條件，或清除魔靈篩選。</span>
      </div>
    );
  }

  return (
    <div className="matchlist">
      <div className="match-grid">
        {slice.map((m) => (
          <MatchCard key={m.battleId} m={m} />
        ))}
      </div>

      {pages > 1 && (
        <nav className="pager" aria-label="分頁">
          <button type="button" className="btn ghost" disabled={current <= 1} onClick={() => onPage(current - 1)}>
            上一頁
          </button>
          <span className="pager-info">
            <b>{current}</b> / {pages}
            <em>
              （{start + 1}–{Math.min(start + PAGE_SIZE, matches.length)} 共 {matches.length} 場）
            </em>
          </span>
          <button
            type="button"
            className="btn ghost"
            disabled={current >= pages}
            onClick={() => onPage(current + 1)}
          >
            下一頁
          </button>
        </nav>
      )}
    </div>
  );
}

export { PAGE_SIZE };
