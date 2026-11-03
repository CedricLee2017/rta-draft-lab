import type { PrewarmedPlayer } from "../lib/prewarmed";

/**
 * 「玩家名單」：列出本機所有抓過的玩家。
 *
 * 勾選 = 要把哪幾位玩家的資料合併成一份來分析。
 * 例如抓了 5 位玩家，只勾其中 2 位，統計 / BP 分析就只算這 2 位。
 */

export interface RosterEntry {
  id: number;
  name: string;
  image?: string;
  country?: string;
  seasons: number[];
  from: number;
  to: number;
  /** 這台裝置上的總場數（所有已抓賽季） */
  matches: number;
  winRate: number | null;
  fetchedAt: string;
  /** 最後一次看到對手的時間（用來排最近） */
  lastSeen?: string;
}

interface Props {
  entries: RosterEntry[];
  selected: number[];
  onToggle: (id: number) => void;
  onAll: () => void;
  onNone: () => void;
  /** 已寫進雲端 KV、但這台裝置還沒抓過的玩家 */
  cloud?: PrewarmedPlayer[];
  onLoadCloud?: (id: number) => void;
}

function seasonText(e: RosterEntry): string {
  if (!e.seasons.length) return "尚無資料";
  return e.from === e.to ? `S${e.to}` : `S${e.from}–${e.to}`;
}

export function RosterBar({
  entries,
  selected,
  onToggle,
  onAll,
  onNone,
  cloud = [],
  onLoadCloud,
}: Props) {
  if (!entries.length && !cloud.length) return null;

  const selectedEntries = entries.filter((e) => selected.includes(e.id));
  const total = selectedEntries.reduce((n, e) => n + e.matches, 0);

  return (
    <section className="roster" aria-label="玩家名單">
      <div className="roster-head">
        <span className="roster-label">玩家名單</span>
        <span className="roster-note">
          {selectedEntries.length
            ? `已選 ${selectedEntries.length} 位・合計 ${total} 場`
            : "勾選要合併分析的玩家"}
        </span>
        <div className="roster-actions">
          <button type="button" className="link" onClick={onAll}>
            全選
          </button>
          <button type="button" className="link" onClick={onNone}>
            全不選
          </button>
        </div>
      </div>

      <div className="roster-list">
        {entries.map((e) => {
          const on = selected.includes(e.id);
          return (
            <button
              key={e.id}
              type="button"
              className={`roster-card${on ? " on" : ""}`}
              onClick={() => onToggle(e.id)}
              aria-pressed={on}
              title={`${e.name}（ID ${e.id}・${seasonText(e)}・${e.matches} 場）`}
            >
              <span className={`roster-check${on ? " on" : ""}`} aria-hidden>
                {on ? "✓" : ""}
              </span>
              <span className="recent-avatar" aria-hidden>
                {e.name.replace(/^#/, "").slice(0, 1)}
              </span>
              <span className="roster-text">
                <span className="roster-name">{e.name}</span>
                <span className="roster-sub">
                  #{e.id}・{seasonText(e)}
                </span>
              </span>
              <span className="roster-stats">
                <b className={(e.winRate ?? 50) >= 50 ? "good" : "bad"}>
                  {e.winRate === null ? "–" : `${e.winRate.toFixed(0)}%`}
                </b>
                <em>{e.matches} 場</em>
              </span>
            </button>
          );
        })}
      </div>

      {cloud.length > 0 && onLoadCloud && (
        <div className="roster-cloud">
          <span className="roster-cloud-label">雲端已備好（點一下讀取，不耗額度）</span>
          <div className="roster-cloud-list">
            {cloud.map((p) => (
              <button
                key={p.id}
                type="button"
                className="cloud-chip"
                onClick={() => onLoadCloud(p.id)}
                title={p.note}
              >
                <b>{p.name}</b>
                <em>#{p.id}</em>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
