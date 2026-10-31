import { useState } from "react";
import type { PlayerInfo, RtaMatch } from "../lib/types";
import { MonsterIcon } from "./MonsterIcon";

const PAGE_SIZE = 20;

const pad = (n: number) => String(n).padStart(2, "0");

/** 完整時間（給 tooltip 用） */
function fmtTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso.slice(0, 16).replace("T", " ");
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 相對時間，像 lucksack 的「a day ago」 */
function relTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "剛剛";
  if (mins < 60) return `${mins} 分鐘前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(t).toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

function resultOf(m: RtaMatch): "win" | "lose" | "draw" {
  if (m.won === true) return "win";
  if (m.won === false) return "lose";
  return "draw";
}

/**
 * 選秀順位：RTA 固定是「首搶 1、4、5、8、9；後手 2、3、6、7、10」，
 * 剛好對應 lucksack 對局圖上每隻魔靈右下角的數字。
 */
function draftNumbers(firstPick: boolean): number[] {
  return firstPick ? [1, 4, 5, 8, 9] : [2, 3, 6, 7, 10];
}

function Avatar({ src, name }: { src?: string; name: string }) {
  const [broken, setBroken] = useState(false);
  const label = (name || "?").trim().slice(0, 1);
  return (
    <span className="battle-avatar" aria-hidden>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        label
      )}
    </span>
  );
}

interface TeamProps {
  ids: number[];
  ban: number;
  numbers: number[];
  first: boolean;
  label: string;
}

function Team({ ids, ban, numbers, first, label }: TeamProps) {
  return (
    <div className="battle-team" aria-label={label}>
      {ids.map((id, i) => (
        <div key={`${id}-${i}`} className={`slot${i === 0 && first ? " first" : ""}`}>
          <MonsterIcon id={id} size={36} banned={id === ban} />
          <span className="slot-num">{numbers[i] ?? i + 1}</span>
          {i === 0 && first && <span className="slot-first">1ST</span>}
        </div>
      ))}
    </div>
  );
}

function MatchCard({ m, me }: { m: RtaMatch; me: PlayerInfo }) {
  const r = resultOf(m);
  const resultText = r === "win" ? "勝利" : r === "lose" ? "敗北" : "和局";

  return (
    <article className={`battle ${r}`}>
      <div className="battle-result">
        <strong>{resultText}</strong>
        <time dateTime={m.time} title={fmtTime(m.time)}>
          {relTime(m.time)}
        </time>
      </div>

      <div className="battle-side mine">
        <div className="battle-who">
          <Avatar src={m.myImage || me.image} name={me.username} />
          <div className="battle-id">
            <b className="battle-name" title={me.username}>
              {me.username || `#${me.id}`}
            </b>
            <span className="battle-score">{m.myScore ?? "–"}</span>
          </div>
        </div>

        <Team
          ids={m.my}
          ban={m.myBan}
          numbers={draftNumbers(m.firstPick)}
          first={m.firstPick}
          label="我方選角"
        />
      </div>

      <div className="battle-vs" aria-hidden>
        <span>⚔</span>
      </div>

      <div className="battle-side theirs">
        <Team
          ids={m.opp}
          ban={m.oppBan}
          numbers={draftNumbers(!m.firstPick)}
          first={!m.firstPick}
          label="對手選角"
        />

        <div className="battle-who">
          <Avatar src={m.oppImage} name={m.oppName || "對手"} />
          <div className="battle-id">
            <b className="battle-name" title={m.oppName}>
              {m.oppName || "未知對手"}
            </b>
            <span className="battle-score">{m.oppScore ?? "–"}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

interface Props {
  matches: RtaMatch[];
  page: number;
  onPage: (page: number) => void;
  me: PlayerInfo;
}

export function MatchList({ matches, page, onPage, me }: Props) {
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
      <div className="battle-grid">
        {slice.map((m) => (
          <MatchCard key={m.battleId} m={m} me={me} />
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
