"""Render the strings the Aura score card would show for each feed entry
(mirrors firmware Display::score). Usage: python card_strings.py < feed.json"""
import json, sys

def lines(g):
    if g.get("mode") == "record":
        nxt = ("Next: " + g["away"]) if g.get("away") else "Next game"
        return [g["home"], g.get("record", ""), nxt, g.get("st", "")]
    return [f'{g["away"]} {g["as"]}', f'{g["home"]} {g["hs"]}', g.get("st", "")]

if __name__ == "__main__":
    d = json.load(sys.stdin)
    for g in d.get("scores", []):
        ls = lines(g)
        flag = "" if all(len(x) <= 21 for x in ls) else "  <-- over 21 chars"
        print(f'{g["key"]:9} {g.get("mode","score"):6} | ' + " | ".join(ls) + flag)
