import { useEffect, useMemo, useState } from "react";
import { ELEMENTS, MONSTERS, type Monster } from "../lib/monsters";
import { MonsterIcon } from "./MonsterIcon";

/** 屬性排序：水 → 火 → 風 → 光 → 暗（el 1..5） */
const EL_RANK: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };
const EL_FILTERS = [1, 2, 3, 4, 5];
const EL_COLOR: Record<number, string> = {
  1: "var(--water)",
  2: "var(--fire)",
  3: "var(--wind)",
  4: "var(--light)",
  5: "var(--dark)",
};

/** 一次最多渲染幾張卡；其餘用搜尋／篩選縮小範圍 */
const RENDER_LIMIT = 480;

function matches(
  m: Monster,
  term: string,
  el: number,
  nat: number,
  awakeOnly: boolean,
): boolean {
  if (el && m.el !== el) return false;
  if (nat && m.nat !== nat) return false;
  if (awakeOnly && !m.awk) return false;
  if (!term) return true;
  const elName = ELEMENTS[m.el]?.name ?? "";
  return (
    m.name.toLowerCase().includes(term) ||
    String(m.id).includes(term) ||
    elName.includes(term) ||
    `${m.nat}★`.includes(term)
  );
}

interface Props {
  title: string;
  /** 已選／已被 ban，不能再選 */
  used: Set<number>;
  /** AI 歷史出場次數（顯示在卡片上） */
  aiCounts: Map<number, number>;
  /** 對手歷史出場次數（顯示在卡片上） */
  oppCounts: Map<number, number>;
  /** 本場我方已選幾隻 */
  pickedCount: number;
  onPick: (id: number) => void;
  onClose: () => void;
}

export function MonsterPickerModal({
  title,
  used,
  aiCounts,
  oppCounts,
  pickedCount,
  onPick,
  onClose,
}: Props) {
  const [q, setQ] = useState("");
  const [el, setEl] = useState(0);
  const [nat, setNat] = useState(0);
  const [awakeOnly, setAwakeOnly] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return MONSTERS.filter((m) => matches(m, term, el, nat, awakeOnly)).sort(
      (a, b) =>
        (EL_RANK[a.el] ?? 99) - (EL_RANK[b.el] ?? 99) ||
        b.nat - a.nat ||
        b.awk - a.awk ||
        a.name.localeCompare(b.name),
    );
  }, [q, el, nat, awakeOnly]);

  const available = useMemo(
    () => list.filter((m) => !used.has(m.id)).length,
    [list, used],
  );
  const visible = list.slice(0, RENDER_LIMIT);
  const more = list.length - visible.length;

  return (
    <div
      className="mp-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mp-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="mp-head">
          <h2>{title}</h2>
          <button type="button" className="mp-close" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </div>

        <div className="mp-body">
          <div className="mp-toolbar">
            <input
              autoFocus
              className="mp-search"
              placeholder="搜尋魔靈名稱 / ID（英文，例如 Oliver）…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <div className="mp-filter-row">
              <span className="mp-label">元素</span>
              <button
                type="button"
                className={`mp-chip ${el === 0 ? "on" : ""}`}
                onClick={() => setEl(0)}
              >
                全部
              </button>
              {EL_FILTERS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`mp-chip ${el === id ? "on" : ""}`}
                  style={{ color: EL_COLOR[id] }}
                  onClick={() => setEl(id)}
                >
                  <i className="mp-dot" />
                  {ELEMENTS[id]?.name}
                </button>
              ))}
            </div>

            <div className="mp-filter-row">
              <span className="mp-label">胎生星級</span>
              <button
                type="button"
                className={`mp-chip ${nat === 0 ? "on" : ""}`}
                onClick={() => setNat(0)}
              >
                全部
              </button>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`mp-chip ${nat === n ? "on" : ""}`}
                  onClick={() => setNat(n)}
                >
                  {n}★
                </button>
              ))}
              <label className="mp-awake">
                <input
                  type="checkbox"
                  checked={awakeOnly}
                  onChange={(e) => setAwakeOnly(e.target.checked)}
                />
                只顯示已覺醒
              </label>
            </div>
          </div>

          <div className="mp-count">
            符合 {list.length} 隻・可用 {available} 隻
            {list.length > 0 && "・點擊即可選擇"}
          </div>

          <div className="mp-grid">
            {visible.map((m) => {
              const isUsed = used.has(m.id);
              const ai = aiCounts.get(m.id) ?? 0;
              const opp = oppCounts.get(m.id) ?? 0;
              return (
                <button
                  key={m.id}
                  type="button"
                  className={`mp-card${isUsed ? " used" : ""}`}
                  disabled={isUsed}
                  title={`${m.name} · ${ELEMENTS[m.el]?.name ?? ""} · ${m.nat}★ · 基礎速度 ${m.spd} · ${m.arch}`}
                  onClick={() => onPick(m.id)}
                >
                  <MonsterIcon id={m.id} size={48} />
                  <span className="mp-name">{m.name}</span>
                  <span className="mp-meta">
                    <span className={`mp-el el-${m.el}`}>
                      {ELEMENTS[m.el]?.name ?? "?"}
                    </span>
                    ・{m.nat}★
                  </span>
                  <span className="mp-ext">
                    {m.spd} SPD・{m.arch}
                  </span>
                  <span className="mp-ext">
                    AI {ai}・對手 {opp}
                  </span>
                  {isUsed && <span className="mp-used">已選</span>}
                </button>
              );
            })}
            {list.length === 0 && (
              <div className="mp-empty">找不到符合條件的魔靈</div>
            )}
          </div>

          <div className="mp-foot">
            <span className="mp-foot-note">
              本場已選 {pickedCount}/5
              {more > 0 && `・只顯示前 ${RENDER_LIMIT} 隻，用搜尋縮小範圍`}
            </span>
            <button type="button" className="btn primary" onClick={onClose}>
              完成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
