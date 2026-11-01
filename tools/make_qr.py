"""
產生首頁 QR code（指向正式站）。

用法：
    pip install segno
    python tools/make_qr.py
    python tools/make_qr.py https://你的新網址

輸出：web/public/qr-live.svg
換網址時記得同步修改 web/src/lib/site.ts 的 SITE_URL，再跑一次這支腳本。
"""

from __future__ import annotations

import sys
from pathlib import Path

import segno

DEFAULT_URL = "https://rta-draft-lab-live.pages.dev"


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    out = Path(__file__).resolve().parents[1] / "web" / "public" / "qr-live.svg"

    qr = segno.make(url, error="m")
    qr.save(
        out,
        kind="svg",
        scale=8,
        border=2,
        dark="#0b1120",
        light="#ffffff",
        xmldecl=False,
    )

    print(f"wrote {out}")
    print(f"url   {url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
