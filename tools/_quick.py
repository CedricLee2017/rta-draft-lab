import json
from collections import Counter

mon = {m["id"]: m for m in json.load(open("web/src/data/monsters.json", encoding="utf-8"))}
for f in ["payload-221145-s39.json", "payload-188475-s39.json", "payload-254018-s39.json"]:
    p = json.load(open(f, encoding="utf-8"))
    ms = p["matches"]
    n = len(ms) or 1
    c = Counter()
    for m in ms:
        for x in m["my"]:
            c[x] += 1
    print(p["player"]["id"], p["player"]["username"], "n", len(ms), "score", p["summary"]["score"], "rank", p["summary"]["rank"], "wr", p["summary"]["winRate"])
    print("  ", ", ".join(f"{mon.get(i, {}).get('name', i)} {v/n*100:.0f}%" for i, v in c.most_common(8)))
    ld = [(i, v) for i, v in c.most_common() if mon.get(i, {}).get("el") in (4, 5) and mon.get(i, {}).get("nat") == 5]
    print("  LD5:", ", ".join(f"{mon.get(i, {}).get('name', i)} {v/n*100:.0f}%" for i, v in ld[:6]))
