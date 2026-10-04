"""Offline tests for the MLB postseason team card (series round/status + next
game instead of regular-season W-L) and the ESPN date-range 400 fallback.
No network: ESPN responses are faked."""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402

NOW = datetime(2026, 10, 4, 15, 30, tzinfo=timezone.utc)   # 11:30 AM EDT


class Resp:
    def __init__(self, code, body):
        self.status_code, self._b = code, body

    def json(self):
        return self._b


def team(abbr, tid):
    return {"id": tid, "abbreviation": abbr}


IDS = {"NYY": "10", "TB": "30", "BOS": "2", "LAD": "19", "ATL": "15"}


def ev(eid, when, home, away, note, state="pre", hs=None, as_=None, detail=None, series=None):
    comps = []
    for ab, ha, sc in ((home, "home", hs), (away, "away", as_)):
        c = {"homeAway": ha, "team": team(ab, IDS[ab])}
        if state == "post":
            c["score"] = {"value": float(sc), "displayValue": str(sc)}
            c["winner"] = sc > (as_ if ha == "home" else hs)
        elif state == "in":
            c["score"] = str(sc)
        comps.append(c)
    comp = {"competitors": comps, "notes": [{"headline": note}],
            "status": {"type": {"state": state, "shortDetail": detail or ("Final" if state == "post" else
                                                                          server._fmt_eastern(when))}}}
    if series:
        comp["series"] = series
    return {"id": eid, "date": when.strftime("%Y-%m-%dT%H:%MZ"), "seasonType": {"type": 3},
            "competitions": [comp]}


class FakeCx:
    def __init__(self, sched, sb=(), range_code=400):
        self.sched, self.sb, self.range_code = sched, list(sb), range_code
        self.calls = []

    async def get(self, url, **kw):
        self.calls.append(url)
        if "/schedule" in url:
            ab = url.split("/teams/")[1].split("/")[0].upper()
            return Resp(200, {"season": {"type": 3}, "events": self.sched.get(ab, [])})
        if "/scoreboard" in url:
            if "-" in url.split("dates=")[-1].split("&")[0]:
                return Resp(self.range_code, {"events": self.sb} if self.range_code == 200 else {})
            return Resp(200, {"events": self.sb})
        if "/teams/" in url:
            return Resp(200, {"team": {"record": {"items": [{"summary": "93-68"}]}}})
        return Resp(404, {})


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def cards(cx, t="MLB:NYY", now=NOW):
    orig = server.datetime

    class FixedDT(datetime):
        @classmethod
        def now(cls, tz=None):
            return now if tz else now.replace(tzinfo=None)

    server.datetime = FixedDT
    try:
        return run(server._fetch_score(cx, t))
    finally:
        server.datetime = orig


def setup_function(_):
    server._sched_cache.clear()
    server._sb_cache.clear()


def d(h):
    return NOW + timedelta(hours=h)


ALDS = [
    ev("1", d(-41), "TB", "NYY", "ALDS - Game 1", "post", 1, 0),
    ev("2", d(32.5), "TB", "NYY", "ALDS - Game 2"),
    ev("3", d(80.5), "NYY", "TB", "ALDS - Game 3"),
    ev("4", d(104.5), "NYY", "TB", "ALDS - Game 4 If Necessary"),
    ev("5", d(152.5), "TB", "NYY", "ALDS - Game 5 If Necessary"),
]
WC = [ev("w1", d(-112), "NYY", "BOS", "ALWC - Game 1", "post", 9, 0),
      ev("w2", d(-88), "NYY", "BOS", "ALWC - Game 2", "post", 9, 2)]


def lines_ok(cs):
    for c in cs:
        for k in ("record", "st", "away"):
            assert len(c.get(k, "")) <= 21, (k, c)


def test_upcoming_game_shows_series_not_record():
    cs = cards(FakeCx({"NYY": WC + ALDS}))
    assert len(cs) == 1
    c = cs[0]
    assert c["mode"] == "record" and c["record"] == "ALDS TB 1-0"
    assert c["away"] == "G2 @ TB" and c["st"] == "10/5 - 8:00 PM EDT"
    assert "93-68" not in str(c)
    lines_ok(cs)


def test_live_game_prefixes_round_and_game():
    live = ev("2", d(-1), "TB", "NYY", "ALDS - Game 2", "in", 2, 3, detail="Top 5th")
    cs = cards(FakeCx({"NYY": WC + ALDS}, sb=[live]))
    assert cs == [{"ok": 1, "home": "TB", "hs": 2, "away": "NYY", "as": 3, "st": "ALDS G2 Top 5th", "post": 1}]


def test_recent_final_then_next_game_tied():
    g2 = ev("2", d(-3), "TB", "NYY", "ALDS - Game 2", "post", 2, 5)
    sched = WC + [ALDS[0], g2] + ALDS[2:]
    cs = cards(FakeCx({"NYY": sched}))
    assert cs[0]["st"] == "Final ALDS tied 1-1" and cs[0]["as"] == 5
    assert cs[1]["record"] == "ALDS tied 1-1" and cs[1]["away"] == "G3 vs TB"
    lines_ok(cs)


def test_series_from_scoreboard_series_field():
    ser = {"type": "playoff", "summary": "NYY leads series 2-1", "totalCompetitions": 5,
           "competitors": [{"id": "10", "wins": 2}, {"id": "30", "wins": 1}]}
    g4 = ev("4", d(5), "NYY", "TB", "ALDS - Game 4 If Necessary", series=ser)
    cs = cards(FakeCx({"NYY": WC + ALDS}, sb=[g4]))
    nxt = [c for c in cs if c.get("mode") == "record"][-1]
    assert nxt["record"] == "ALDS NYY 2-1"


def test_eliminated_team_season_over():
    cs = cards(FakeCx({"BOS": WC}), t="MLB:BOS")
    assert cs == [{"ok": 1, "mode": "record", "post": 1, "home": "BOS", "away": "2027",
                   "hs": 0, "as": 0, "record": "Lost ALWC 0-2", "st": "Season over"}]


def test_won_round_waiting_for_next():
    sweep = [ev(f"s{i}", d(-100 + 24 * i), "NYY", "TB", f"ALDS - Game {i}", "post", 5, 1) for i in (1, 2, 3)]
    cs = cards(FakeCx({"NYY": WC + sweep}))
    assert cs[-1]["record"] == "Won ALDS 3-0" and cs[-1]["away"] == "ALCS" and cs[-1]["st"] == "TBD"


def test_world_series_strings_fit():
    ws = [ev("x1", d(-50), "NYY", "LAD", "World Series - Game 1", "post", 3, 2),
          ev("x2", d(-26), "NYY", "LAD", "World Series - Game 2", "post", 1, 4),
          ev("x3", d(30), "LAD", "NYY", "World Series - Game 3")]
    IDS.setdefault("LAD", "19")
    cs = cards(FakeCx({"NYY": ws}))
    assert cs[-1]["record"] == "World Series tied 1-1"
    lines_ok(cs)
    assert server._series_line("World Series", "NYY", "LAD", 3, 2, 4) == "World Series NYY 3-2"
    assert server._series_line("World Series", "NYY", "LAD", 4, 2, 4) == "Won World Series 4-2"


def test_not_postseason_falls_back_to_regular_logic():
    class RegCx(FakeCx):
        async def get(self, url, **kw):
            if "/schedule" in url:
                return Resp(200, {"season": {"type": 2}, "events": []})
            return await super().get(url, **kw)

    cs = cards(RegCx({}))
    assert cs and cs[0]["record"] == "93-68"


def test_range_400_falls_back_to_single_days():
    cx = FakeCx({"NYY": WC + ALDS})
    cards(cx)
    days = [u for u in cx.calls if "/scoreboard?dates=" in u and "-" not in u.split("dates=")[1].split("&")[0]]
    assert len(days) == 3
