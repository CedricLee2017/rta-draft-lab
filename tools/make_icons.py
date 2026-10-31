"""產生 PWA 用的 App 圖示（PNG）。

用法：python tools/make_icons.py
輸出：web/public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
"""

from __future__ import annotations

import os

from PIL import Image, ImageDraw

BG = (11, 17, 32, 255)
GOLD = (242, 198, 92, 255)
BLUE = (88, 166, 255, 255)
EDGE = (34, 48, 82, 255)

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "web", "public", "icons")
SS = 4  # 超取樣倍率


def draw_icon(size: int, *, full_bleed: bool, padding: float) -> Image.Image:
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if full_bleed:
        d.rectangle([0, 0, s, s], fill=BG)
    else:
        r = int(s * 0.22)
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=r, fill=BG)

    # 六角形（鑽石）輪廓
    cx, cy = s / 2, s / 2
    half_w = s * (0.36 - padding)
    half_h = s * (0.40 - padding)
    top = (cx, cy - half_h)
    right_top = (cx + half_w, cy - half_h * 0.45)
    right_bottom = (cx + half_w, cy + half_h * 0.45)
    bottom = (cx, cy + half_h)
    left_bottom = (cx - half_w, cy + half_h * 0.45)
    left_top = (cx - half_w, cy - half_h * 0.45)
    pts = [top, right_top, right_bottom, bottom, left_bottom, left_top]

    width = max(2, int(s * 0.035))
    d.polygon(pts, outline=GOLD, width=width)

    # 中心圓點
    dot = s * 0.085
    d.ellipse([cx - dot, cy - dot, cx + dot, cy + dot], fill=BLUE)

    # 內圈細線，讓小尺寸也看得出來
    inner = s * 0.135
    d.ellipse(
        [cx - inner, cy - inner, cx + inner, cy + inner],
        outline=EDGE,
        width=max(1, int(s * 0.012)),
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)

    specs = [
        ("icon-192.png", 192, False, 0.0),
        ("icon-512.png", 512, False, 0.0),
        ("maskable-512.png", 512, True, 0.10),
        ("apple-touch-icon.png", 180, True, 0.0),
    ]

    for name, size, full_bleed, padding in specs:
        icon = draw_icon(size, full_bleed=full_bleed, padding=padding)
        path = os.path.join(OUT_DIR, name)
        icon.save(path, "PNG", optimize=True)
        print(f"{name}: {size}x{size} {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
