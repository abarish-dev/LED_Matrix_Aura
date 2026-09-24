"""
Backend tests for the new "off-season record + next-game" fallback tier in
_fetch_score (server.py), added this session on top of the existing
live/recent-final/upcoming/next-game windowing logic.

Spec under test (per PRD "off-season record/next-game fallback"):
    * When a team has ZERO events in the scoreboard window (+/-8ish days) AND
      no next_game was found either (a true off-season gap, e.g. before the
      season opener / all preseason games not in main scoreboard), the code
      queries the team's ESPN profile endpoint for season record + nextEvent.
    * If a record or a next opponent is found, returns ONE entry tagged
      mode="record" with a non-empty "record" field and "st" holding a
      human-readable next-game date/time.
    * This must NOT regress in-season teams that already have a scoreboard
      entry (live / recent-final / upcoming / next-game tiers take priority).

NOTE: Live ESPN data is real-time / non-deterministic. At test-run time
(server clock: Sept 24 2026) NBA and NHL preseason games exist but are not
surfaced by the main scoreboard endpoint, making them good real-world
candidates for the record-fallback tier. If ESPN's schedule changes such
that a chosen team unexpectedly has a scoreboard entry, this tier simply
won't trigger for that team (see assertions below, tolerant of either
correct outcome).
"""

import os
import pytest
import requests

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://smart-matrix-hub.preview.emergentagent.com"
).rstrip("/")

FEED = f"{BASE_URL}/api/matrix/feed"
LAT, LON = 40.7, -74.0


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "AuraMatrixTest/1.0"})
    return s


def _get_entry(api, team):
    r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": team,
                               "sports": 1, "weather": 0, "flights": 0}, timeout=25)
    assert r.status_code == 200, r.text
    body = r.json()
    entries = [s for s in body["scores"] if s["key"] == team]
    return entries, body


@pytest.mark.parametrize("team", ["NBA:LAL", "NHL:NJD", "NHL:TOR"])
def test_offseason_team_shows_record_and_next_game(api, team):
    """Teams with no games in the main scoreboard window get exactly one
    fallback entry with a non-empty record + next-game date, never blank."""
    entries, body = _get_entry(api, team)
    assert len(entries) == 1, f"{team}: expected 1 entry, got {entries!r}"
    e = entries[0]
    assert e["ok"] == 1
    assert e.get("mode") == "record", f"{team}: expected mode='record', got {e!r}"
    assert isinstance(e.get("record"), str) and e["record"] != "", f"{team}: empty record"
    assert isinstance(e.get("st"), str) and e["st"] != "", f"{team}: empty next-game st"
    # hs/as always 0 for record-mode (no live score to show)
    assert e["hs"] == 0 and e["as"] == 0


def test_inseason_team_not_using_record_fallback(api):
    """NFL:BAL is in-season with an upcoming game in the main scoreboard ->
    must use the normal fallback tier (no 'mode' key), not record mode."""
    entries, body = _get_entry(api, "NFL:BAL")
    assert len(entries) == 1
    e = entries[0]
    assert "mode" not in e or e.get("mode") != "record"


def test_record_fallback_top_level_score_matches_first_entry(api):
    r = requests.get(FEED, params={"lat": LAT, "lon": LON, "team": "NBA:LAL",
                                    "sports": 1, "weather": 0, "flights": 0}, timeout=25)
    body = r.json()
    assert body["score"] == body["scores"][0]
    assert body["score"].get("mode") == "record"
