"""
產生首頁 QR code（指向正式站）。

用法：
    pip install segno
    python tools/make_qr.py
    python tools/make_qr.py https://你的新網址

預設會讀取 web/src/lib/site.ts 的 SITE_URL，所以換網址時只要改那裡再跑一次。
輸出：web/public/qr-live.svg
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

import segno

DEFAULT_URL = "https://rta-draft-lab-live.pages.dev"
SITE_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "site.ts"


def source_url() -> str:
    try:
        match = re.search(r'SITE_URL\s*=\s*"([^"]+)"', SITE_TS.read_text(encoding="utf-8"))
        if match:
            return match.group(1)
    except OSError:
        pass
    return DEFAULT_URL


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else source_url()
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
