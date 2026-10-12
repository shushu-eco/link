"""Who is live on Kick now with a game on screen, for the night run (driver.js): shooters first, then other games.

Usage:
    python tools/reels/night/kick_live.py

Prints {"shooters": [...], "games": [...]}, each {"slug", "category", "viewers", "language"}, most watched first.
English streams come first (Link hears speech as English); others only fill up what is missing.
Asks Kick's official API through Link's own kick_api (the user's Kick app, Settings > Accounts), and reads only
what anyone can see. The shooters' category numbers are looked up once and kept in %USERPROFILE%\\.link\\night.
"""
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import kick_api as k

KEPT = k.DATA / "night" / "kick_categories.json"
# what to look a category up by -> the names that count
SHOOTERS = {
    "Call of Duty": ["Call of Duty: Warzone", "Call of Duty: Black Ops 7", "Call of Duty: Modern Warfare 4", "Call of Duty: Black Ops 6"],
    "Warzone": ["Call of Duty: Warzone"], "Counter-Strike": ["Counter-Strike 2"], "VALORANT": ["VALORANT"],
    "Fortnite": ["Fortnite", "Fortnite Zero Build"], "Apex Legends": ["Apex Legends"], "PUBG": ["PUBG: Battlegrounds"],
    "Escape from Tarkov": ["Escape From Tarkov", "Escape from Tarkov: Arena"], "Overwatch": ["Overwatch", "Overwatch 2"],
    "Battlefield": ["Battlefield 6", "Battlefield REDSEC"], "Marvel Rivals": ["Marvel Rivals"], "Delta Force": ["Delta Force"],
    "ARC Raiders": ["ARC Raiders"], "Rust": ["Rust"], "The Finals": ["The Finals"], "Siege": ["Tom Clancy's Rainbow Six Siege", "Tom Clancy's Rainbow Six Siege X"],
    "Destiny 2": ["Destiny 2"], "Halo Infinite": ["Halo Infinite"], "DayZ": ["DayZ"], "Hunt: Showdown": ["Hunt: Showdown", "Hunt: Showdown 1896"],
}
# categories with a person on screen and no game, or no game worth a reel
NOT_GAMES = re.compile(r"IRL|Just Chatting|Slots|Casino|Roulette|Pools|Hot Tubs|Crypto|Trading|Music|ASMR|Podcast|Talk|Poker|Gambl|Betting|Blackjack|"
                       r"\bArt\b|\bDJ\b|Special Events|News|Sports$|Travel|Food|Fitness|Body Art|Watch Party|Creative|Science|Politics|Beauty|Animals|Chess|Bingo|Lottery", re.I)


def shooter_ids():
    kept = k.read_json(KEPT)
    if kept:
        return {int(i): n for i, n in kept.items()}
    ids = {}
    for query, names in SHOOTERS.items():
        try:
            for c in k.call("categories", q=query).get("data") or []:
                if c.get("name") in names:
                    ids[int(c["id"])] = c["name"]
        except k.KickError:
            pass
    if ids:
        KEPT.parent.mkdir(parents=True, exist_ok=True)
        KEPT.write_text(json.dumps(ids), encoding="utf-8")
    return ids


def short(s):
    return {"slug": s.get("slug"), "category": (s.get("category") or {}).get("name") or "", "viewers": s.get("viewer_count") or 0, "language": s.get("language") or ""}


def live(**params):
    try:
        return [short(s) for s in k.call("livestreams", limit=100, sort="viewer_count", **params).get("data") or [] if s.get("slug")]
    except k.KickError:
        return []


def ordered(rows):
    seen, out = set(), []
    # English first, then the rest; in each, most watched first
    for s in sorted(rows, key=lambda s: (s["language"] != "en", -s["viewers"])):
        if s["slug"] not in seen:
            seen.add(s["slug"])
            out.append(s)
    return out


sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ids = shooter_ids()
shooters = []
for cid in ids:
    shooters += live(category_id=cid, language="en")[:8]
if len(shooters) < 12:   # too few in English: any language fills up
    for cid in ids:
        shooters += live(category_id=cid)[:5]
top = live(language="en") + live()
games = [s for s in top if s["category"] and not NOT_GAMES.search(s["category"]) and s["category"] not in ids.values()]
print(json.dumps({"shooters": ordered(shooters)[:40], "games": ordered(games)[:40], "categories": sorted(set(ids.values()))}, ensure_ascii=False))
