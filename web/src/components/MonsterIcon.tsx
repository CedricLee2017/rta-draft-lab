import { useState } from "react";
import { ELEMENTS, iconUrl, monsterOf } from "../lib/monsters";

interface Props {
  id: number;
  size?: number;
  /** 被 ban（畫紅斜線 + 灰階） */
  banned?: boolean;
  /** 隊長（左下角 L） */
  leader?: boolean;
  className?: string;
}

export function MonsterIcon({ id, size = 40, banned = false, leader = false, className = "" }: Props) {
  const m = monsterOf(id);
  const [broken, setBroken] = useState(false);
  const el = m ? ELEMENTS[m.el] : undefined;

  const style = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.24),
  };

  return (
    <div
      className={`mon ${el?.cls ?? ""} ${banned ? "is-banned" : ""} ${className}`}
      style={style}
      title={m ? `${m.name}${banned ? "（被 ban）" : ""}${leader ? "（隊長）" : ""}` : `#${id}`}
    >
      {m && !broken ? (
        <img
          src={iconUrl(id)}
          alt={m.name}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="mon-fallback" style={{ fontSize: Math.round(size * 0.4) }}>
          {(m?.name ?? "?").slice(0, 1)}
        </span>
      )}
      {leader && !banned && (
        <span className="mon-leader" style={{ fontSize: Math.max(7, Math.round(size * 0.24)) }}>
          L
        </span>
      )}
    </div>
  );
}
