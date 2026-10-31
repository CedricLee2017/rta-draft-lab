import { useEffect, useMemo, useRef, useState } from "react";
import { ELEMENTS, MONSTERS, MONSTER_MAP, searchMonsters } from "../lib/monsters";
import { MonsterIcon } from "./MonsterIcon";

interface Props {
  label: string;
  value: number[];
  onChange: (ids: number[]) => void;
  /** 依使用率排序的魔靈（會排在選單最前面） */
  pinned?: number[];
  max?: number;
}

export function MonsterSelect({ label, value, onChange, pinned, max = 5 }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const results = useMemo(() => {
    const query = q.trim();
    if (query) return searchMonsters(query, 72);

    // 空白搜尋：先列本季常用魔靈，再補齊圖鑑
    const head = (pinned ?? [])
      .map((id) => MONSTER_MAP.get(id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .slice(0, 72);
    const seen = new Set(head.map((m) => m.id));
    const tail: typeof MONSTERS = [];
    for (const m of MONSTERS) {
      if (tail.length >= 72 - head.length) break;
      if (!seen.has(m.id)) tail.push(m);
    }
    return [...head, ...tail];
  }, [q, pinned]);
  const selected = useMemo(() => new Set(value), [value]);

  function toggle(id: number) {
    if (selected.has(id)) onChange(value.filter((x) => x !== id));
    else if (value.length < max) onChange([...value, id]);
  }

  return (
    <div className="mselect" ref={boxRef}>
      <button
        type="button"
        className={`mselect-btn${value.length ? " has" : ""}${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
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

      {open && (
        <div className="mselect-pop">
          <div className="mselect-head">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜尋魔靈名稱或 ID…"
              aria-label={`搜尋${label}魔靈`}
            />
            {value.length > 0 && (
              <button type="button" className="link" onClick={() => onChange([])}>
                清除
              </button>
            )}
          </div>

          <div className="mselect-grid">
            {results.map((m) => (
              <button
                type="button"
                key={m.id}
                className={`mselect-item ${ELEMENTS[m.el]?.cls ?? ""}${selected.has(m.id) ? " on" : ""}`}
                onClick={() => toggle(m.id)}
                title={`${m.name}（#${m.id}）`}
              >
                <MonsterIcon id={m.id} size={42} />
                <span>{m.name}</span>
              </button>
            ))}
            {results.length === 0 && <p className="mselect-none">找不到符合的魔靈</p>}
          </div>

          <p className="mselect-hint">
            已選 {value.length}/{max}・對局必須「同時包含」所有選中的魔靈
          </p>
        </div>
      )}
    </div>
  );
}
