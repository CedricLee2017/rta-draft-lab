import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ELEMENTS, MONSTERS, type Monster } from "../lib/monsters";
import { MonsterIcon } from "./MonsterIcon";

interface Props {
  label: string;
  value: number[];
  onChange: (ids: number[]) => void;
  /** 依使用率排序的魔靈（沒有搜尋／篩選時排在前面） */
  pinned?: number[];
  max?: number;
}

const ELS = [1, 2, 3, 4, 5];
const NATS = [1, 2, 3, 4, 5];
/** 一次最多渲染幾隻（1987 隻全畫會卡），其餘用篩選縮小 */
const RENDER_LIMIT = 240;

export function MonsterSelect({ label, value, onChange, pinned = [], max = 5 }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [el, setEl] = useState(0);
  const [nat, setNat] = useState(0);
  const [awakenedOnly, setAwakenedOnly] = useState(false);
  const [draft, setDraft] = useState<number[]>([]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  function openPicker() {
    setDraft(value);
    setQuery("");
    setEl(0);
    setNat(0);
    setAwakenedOnly(false);
    setOpen(true);
  }

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rank = new Map(pinned.map((id, i) => [id, i]));
    const browsing = !q && !el && !nat && !awakenedOnly;

    const out = MONSTERS.filter((m: Monster) => {
      if (el && m.el !== el) return false;
      if (nat && m.nat !== nat) return false;
      if (awakenedOnly && m.awk === 0) return false;
      if (q && !m.name.toLowerCase().includes(q) && !String(m.id).includes(q)) return false;
      return true;
    });

    out.sort((a, b) => {
      if (browsing) {
        const d = (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999);
        if (d !== 0) return d;
      }
      return a.name.localeCompare(b.name, "en") || a.id - b.id;
    });
    return out;
  }, [query, el, nat, awakenedOnly, pinned]);

  const shown = list.slice(0, RENDER_LIMIT);

  function toggle(id: number) {
    setDraft((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < max ? [...cur, id] : cur,
    );
  }

  function apply() {
    onChange(draft);
    setOpen(false);
  }

  function resetFilters() {
    setQuery("");
    setEl(0);
    setNat(0);
    setAwakenedOnly(false);
  }

  const filtered = !!query.trim() || !!el || !!nat || !!awakenedOnly;

  const selected = useMemo(() => new Set(value), [value]);

  return (
    <div className="mselect">
      <button
        type="button"
        className={`mselect-btn${value.length ? " has" : ""}${open ? " open" : ""}`}
        onClick={openPicker}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="mselect-label">{label}</span>
        {value.length > 0 ? (
          <span className="mselect-chips">
            {value.map((id) => (
              <MonsterIcon key={id} id={id} size={22} />
            ))}
          </span>
        ) : (
          <span className="mselect-empty">全部</span>
        )}
        <span className="mselect-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open &&
        createPortal(
          <div className="picker-backdrop" onMouseDown={() => setOpen(false)}>
            <div
              className="picker"
              role="dialog"
              aria-modal="true"
              aria-label={`選擇魔靈（${label}）`}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <header className="picker-head">
                <h2>
                  選擇魔靈
                  <span className="picker-sub">{label}篩選</span>
                </h2>
                <button
                  type="button"
                  className="picker-x"
                  onClick={() => setOpen(false)}
                  aria-label="關閉"
                >
                  ×
                </button>
              </header>

              <input
                className="picker-search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜尋魔靈名稱（英文，例如 Sonia）或 ID…"
                aria-label="搜尋魔靈"
              />

              <div className="picker-row">
                <span className="picker-label">元素</span>
                <div className="picker-pills">
                  <button
                    type="button"
                    className={el === 0 ? "on" : ""}
                    onClick={() => setEl(0)}
                  >
                    全部
                  </button>
                  {ELS.map((e) => (
                    <button
                      key={e}
                      type="button"
                      className={el === e ? "on" : ""}
                      onClick={() => setEl(e)}
                    >
                      <i className={`dot ${ELEMENTS[e].cls}`} />
                      {ELEMENTS[e].name}
                    </button>
                  ))}
                </div>
              </div>

              <div className="picker-row">
                <span className="picker-label">胎生星級</span>
                <div className="picker-pills">
                  <button
                    type="button"
                    className={nat === 0 ? "on" : ""}
                    onClick={() => setNat(0)}
                  >
                    全部
                  </button>
                  {NATS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={nat === n ? "on" : ""}
                      onClick={() => setNat(n)}
                    >
                      {n}★
                    </button>
                  ))}
                </div>

                <label className="picker-check">
                  <input
                    type="checkbox"
                    checked={awakenedOnly}
                    onChange={(e) => setAwakenedOnly(e.target.checked)}
                  />
                  只顯示已覺醒
                </label>
              </div>

              <p className="picker-count">
                符合 <b>{list.length}</b> 隻・點擊即可選擇
                {list.length > RENDER_LIMIT && (
                  <em>（先顯示 {RENDER_LIMIT} 隻，用上方條件縮小範圍）</em>
                )}
                {filtered && (
                  <button type="button" className="link picker-reset" onClick={resetFilters}>
                    重設條件
                  </button>
                )}
              </p>

              <div className="picker-grid">
                {shown.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className={`picker-item ${ELEMENTS[m.el]?.cls ?? ""}${draft.includes(m.id) ? " on" : ""}`}
                    onClick={() => toggle(m.id)}
                    title={`${m.name}（#${m.id}）`}
                    aria-pressed={draft.includes(m.id)}
                  >
                    <MonsterIcon id={m.id} size={54} />
                    <span className="picker-name">{m.name}</span>
                    <span className="picker-meta">
                      {ELEMENTS[m.el]?.name}・{m.nat}★
                    </span>
                  </button>
                ))}
                {list.length === 0 && (
                  <p className="picker-none">找不到符合的魔靈，換個關鍵字或放寬條件。</p>
                )}
              </div>

              <footer className="picker-foot">
                <div className="picker-picked">
                  {draft.length === 0 ? (
                    <span className="picker-hint">尚未選擇</span>
                  ) : (
                    draft.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="picker-chip"
                        onClick={() => toggle(id)}
                        title="點一下移除"
                      >
                        <MonsterIcon id={id} size={30} />
                      </button>
                    ))
                  )}
                </div>

                <span className="picker-tally">
                  {draft.length}/{max}
                </span>

                {draft.length > 0 && (
                  <button type="button" className="link" onClick={() => setDraft([])}>
                    清除
                  </button>
                )}

                <button type="button" className="btn primary" onClick={apply}>
                  完成
                </button>
              </footer>
            </div>
          </div>,
          document.body,
        )}

      {!open && selected.size > 0 && <span className="mselect-sr">{selected.size} 隻已選</span>}
    </div>
  );
}
