"""從 sw-tick-lab 的圖鑑產生前端用的魔靈清單。

用法（在 rta-draft-lab 目錄）：
    python tools/make_monster_data.py

輸出：web/src/data/monsters.json
欄位：id / name / el / nat / awk / icon
  el  = 1 水、2 火、3 風、4 光、5 暗
  nat = 胎生星數（1–5）
  awk = 0 未覺醒原名、1 已覺醒、2 二次覺醒
"""

from __future__ import annotations

import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "..", "sw-tick-lab", "src", "data", "monsters.json")
OUT = os.path.join(ROOT, "web", "src", "data", "monsters.json")


def main() -> None:
    with open(SRC, encoding="utf-8") as f:
        src = json.load(f)

    out = [
        {
            "id": m["id"],
            "name": m["name"],
            "el": m["el"],
            "nat": m["nat"],
            "awk": m.get("awk", 1),
            "icon": m["icon"],
        }
        for m in src
    ]
    out.sort(key=lambda m: m["id"])

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print(f"monsters={len(out)} bytes={os.path.getsize(OUT)}")


if __name__ == "__main__":
    main()
