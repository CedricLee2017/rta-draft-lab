"""
自行抓取單一玩家的一季資料，輸出成 Worker 的 KV 內容格式。

用途：Cloudflare Browser Rendering 的免費額度（10 分鐘／天）用完時，
      可以在自己電腦上抓一次、寫進 KV，網站就能立刻看到，不消耗雲端瀏覽器額度。

需求：pip install curl_cffi
用法：
    python tools/fetch_player.py 221145 39
    python tools/fetch_player.py 221145 39 --out payload.json

寫進 KV（在 rta-draft-lab 目錄）：
    npx wrangler kv key put --namespace-id 47c4f3e6931c4992b8a743cbdb8aff56 \
        --remote "m:221145:39" --path payload.json --ttl 1209600
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from curl_cffi import requests

API = "https://api.lucksack.gg"
VERSION = 1


def normalize_match(m: dict) -> dict:
    return {
        "battleId": m.get("battle_id") or 0,
        "time": m.get("battle_time") or "",
        "won": m.get("won"),
        "firstPick": m.get("had_first_pick") is True,
        "my": m.get("my_monsters") or [],
        "myBan": m.get("my_bans") or 0,
        "myLeader": m.get("my_leader") or 0,
        "myScore": m.get("my_score"),
        "opp": m.get("opponent_monsters") or [],
        "oppBan": m.get("opponent_bans") or 0,
        "oppLeader": m.get("opponent_leader") or 0,
        "oppScore": m.get("opponent_score"),
        "oppId": m.get("opponent_id"),
        "oppName": m.get("opponent_username") or "",
        "bracket": m.get("my_rank_bracket"),
        "oppBracket": m.get("opponent_rank_bracket"),
        "myImage": m.get("my_image") or "",
        "oppImage": m.get("opponent_image") or "",
    }


def normalize_summary(raw: dict) -> dict:
    sm = raw.get("summary") or {}
    ui = raw.get("user_info") or {}
    bounds = raw.get("season_bounds") or []
    return {
        "username": ui.get("username") or "",
        "country": ui.get("country") or "",
        "image": ui.get("image") or "",
        "rank": sm.get("current_rank"),
        "score": sm.get("current_score"),
        "peak": sm.get("peak_score"),
        "winRate": sm.get("overall_win_rate"),
        "total": sm.get("total_matches"),
        "wins": sm.get("total_wins"),
        "draws": sm.get("total_draws"),
        "bestStreak": sm.get("best_win_streak"),
        "currentStreak": sm.get("current_streak"),
        "seasonStart": bounds[0] if len(bounds) > 0 else None,
        "seasonEnd": bounds[1] if len(bounds) > 1 else None,
        "daily": [
            {"date": d.get("date"), "played": d.get("match_played") or 0, "won": d.get("match_won") or 0}
            for d in (raw.get("daily_stats") or [])
            if isinstance(d, dict) and d.get("date")
        ],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("player", type=int, help="lucksack 玩家 ID，例如 221145")
    ap.add_argument("season", type=int, nargs="?", default=39, help="賽季，預設 39")
    ap.add_argument("--out", default="payload.json", help="輸出檔名")
    args = ap.parse_args()

    base = f"{API}/players/{args.player}"
    s = requests.Session(impersonate="chrome")

    matches_res = s.get(
        f"{base}/matches?season={args.season}&limit=1000&offset=0", timeout=40
    )
    if matches_res.status_code != 200:
        print(f"matches HTTP {matches_res.status_code}: {matches_res.text[:200]}", file=sys.stderr)
        return 1
    matches_json = matches_res.json()

    try:
        summary_json = s.get(f"{base}/summary?season={args.season}", timeout=40).json()
    except Exception:
        summary_json = {}

    matches = [normalize_match(m) for m in (matches_json.get("matches") or [])]
    matches.sort(key=lambda m: m["time"], reverse=True)
    summary = normalize_summary(summary_json)

    payload = {
        "version": VERSION,
        "player": {
            "id": args.player,
            "username": summary["username"],
            "country": summary["country"],
            "image": summary["image"],
        },
        "season": args.season,
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "matches": matches,
        "total": len(matches),
    }

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    win = sum(1 for m in matches if m["won"] is True)
    loss = sum(1 for m in matches if m["won"] is False)
    print(f"player={args.player} season={args.season} matches={len(matches)}")
    print(f"name={summary['username']} score={summary['score']} rank={summary['rank']}")
    print(f"record={win}勝 {loss}負")
    print(f"output={args.out}")
    print(f'KV key: "m:{args.player}:{args.season}"')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
