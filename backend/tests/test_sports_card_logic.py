"""
Backend tests for the new sports-card windowing logic in GET /api/matrix/feed
(functions _fetch_score / matrix_feed in server.py).

Spec under test (per PRD "Sun icon ghosting fix + smarter sports card logic"):
    * payload has both 'score' (single, back-compat) and 'scores' (list) keys.
    * Each scores[] entry has: ok, home, hs, away, as, st, key.
    * A team with a LIVE game (state=in) shows ONLY that game (no stale final).
    * A team with a final within the last 12h AND a game starting within the
      next 12h shows BOTH as separate entries.
    * A team with neither (recent final aged out, nothing starting soon)
      falls back to a single "next scheduled game" entry, regardless of how
      far out it is.
    * A team with genuinely no events in the ESPN scoreboard window (e.g.
      off-season league) is silently OMITTED from scores (no error entry).
    * Multi-team comma-separated `team=` param returns independent per-team
      results, total capped at 8.
    * sports=0 excludes 'scores' entirely (empty list) and legacy 'score' is
      {"ok": 0}.

NOTE: Live ESPN data is real-time / non-deterministic. At test-run time
(Sept 2026) there were no live (state=in) games and no "post" finals within
12h across MLB/NFL/NBA/NHL, so the live-game-hides-previous and
recent-final+upcoming-together branches could not be exercised against a
real fixture. Those two behaviors are validated by direct code review of
_fetch_score in addition to the runtime checks below; see test report.
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

# NYC-ish coords, arbitrary but stable for the run
LAT = 40.7
LON = -74.0

REQUIRED_KEYS = {"ok", "home", "hs", "away", "as", "st", "key"}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "AuraMatrixTest/1.0"})
    return s


def _assert_score_entry_shape(entry):
    assert isinstance(entry, dict)
    missing = REQUIRED_KEYS - set(entry.keys())
    assert not missing, f"score entry missing keys {missing}: {entry!r}"
    assert entry["ok"] == 1
    assert isinstance(entry["home"], str) and isinstance(entry["away"], str)
    assert isinstance(entry["hs"], int) and isinstance(entry["as"], int)
    assert isinstance(entry["st"], str)
    assert isinstance(entry["key"], str)


class TestFeedShape:
    def test_score_and_scores_keys_present(self, api):
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": "MLB:NYY",
                                   "sports": 1, "weather": 0, "flights": 0}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "score" in body and isinstance(body["score"], dict)
        assert "scores" in body and isinstance(body["scores"], list)
        assert "ok" in body["score"]

    def test_scores_entries_well_formed_when_present(self, api):
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": "MLB:NYY",
                                   "sports": 1, "weather": 0, "flights": 0}, timeout=25)
        body = r.json()
        for entry in body["scores"]:
            _assert_score_entry_shape(entry)

    def test_legacy_score_matches_first_scores_entry(self, api):
        r = api.get(FEED, params={"lat": LAT, "lon": LON,
                                   "team": "MLB:NYY,NFL:BAL", "sports": 1,
                                   "weather": 0, "flights": 0}, timeout=25)
        body = r.json()
        if body["scores"]:
            assert body["score"] == body["scores"][0]
        else:
            assert body["score"] == {"ok": 0}


class TestFallbackAndOmission:
    def test_offseason_team_gets_record_fallback_not_omitted(self, api):
        """NHL is off-season in September -> ESPN scoreboard window (today-2d
        .. today+8d) has zero NHL events -> team now falls back to the
        record+next-game tier (mode='record') instead of being silently
        omitted (this is the new behavior under test this session)."""
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": "NHL:NJD",
                                   "sports": 1, "weather": 0, "flights": 0}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        entries = [s for s in body["scores"] if s["key"] == "NHL:NJD"]
        assert len(entries) == 1, f"expected exactly 1 record-fallback entry, got: {body['scores']!r}"
        entry = entries[0]
        assert entry["mode"] == "record"
        assert entry["ok"] == 1
        assert isinstance(entry.get("record"), str) and entry["record"] != ""
        assert isinstance(entry.get("st"), str) and entry["st"] != ""

    def test_in_season_team_with_no_game_within_12h_falls_back_to_next_game(self, api):
        """NFL:BAL has no live game and its next game is several days out
        (>12h) -> single fallback 'next scheduled game' entry expected."""
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": "NFL:BAL",
                                   "sports": 1, "weather": 0, "flights": 0}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        entries = [s for s in body["scores"] if s["key"] == "NFL:BAL"]
        assert len(entries) == 1, f"expected exactly 1 fallback entry, got {entries!r}"
        _assert_score_entry_shape(entries[0])

    def test_team_with_game_within_12h_shows_that_game(self, api):
        """MLB:NYY has a game later today (within 12h at test-run time) ->
        exactly one entry, matching today's matchup."""
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": "MLB:NYY",
                                   "sports": 1, "weather": 0, "flights": 0}, timeout=25)
        body = r.json()
        entries = [s for s in body["scores"] if s["key"] == "MLB:NYY"]
        assert len(entries) == 1
        _assert_score_entry_shape(entries[0])
        assert entries[0]["home"] == "NYY" or entries[0]["away"] == "NYY"


class TestMultiTeam:
    def test_multiple_teams_independent_results_capped_at_8(self, api):
        teams = "MLB:NYY,NFL:BAL,NHL:NJD"
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": teams,
                                   "sports": 1, "weather": 0, "flights": 0}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["scores"]) <= 8
        keys_present = {s["key"] for s in body["scores"]}
        # NYY (game today) and BAL (fallback next game) should be present;
        # NJD (off-season) now gets the record-fallback tier too (also present).
        assert "MLB:NYY" in keys_present
        assert "NFL:BAL" in keys_present
        assert "NHL:NJD" in keys_present
        njd_entry = next(s for s in body["scores"] if s["key"] == "NHL:NJD")
        assert njd_entry.get("mode") == "record"

    def test_more_than_8_teams_truncated_to_8_team_list(self, api):
        teams = ",".join([f"MLB:{a}" for a in
                          ["NYY", "LAD", "BOS", "HOU", "ATL", "PHI", "SD",
                           "CHC", "SF", "TEX"]])  # 10 teams
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": teams,
                                   "sports": 1, "weather": 0, "flights": 0}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["scores"]) <= 8


class TestSportsToggle:
    def test_sports_0_excludes_scores(self, api):
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": "MLB:NYY",
                                   "sports": 0, "weather": 0, "flights": 0}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["scores"] == []
        assert body["score"] == {"ok": 0}


class TestRegressionFlightsWeather:
    def test_flights_and_weather_still_work_alongside_sports(self, api):
        r = api.get(FEED, params={"lat": 40.6413, "lon": -73.7781,
                                   "team": "MLB:NYY", "sports": 1,
                                   "flights": 1, "weather": 1,
                                   "severity": "severe"}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        for k in ("flight", "score", "scores", "alert", "temp"):
            assert k in body
        assert body["temp"]["ok"] == 1
        assert body["flight"]["ok"] in (0, 1)
        assert body["alert"]["ok"] in (0, 1)

    def test_flights_weather_off_sports_on(self, api):
        r = api.get(FEED, params={"lat": LAT, "lon": LON, "team": "MLB:NYY",
                                   "sports": 1, "flights": 0, "weather": 0}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["flight"] == {"ok": 0}
        assert body["alert"] == {"ok": 0}
        assert isinstance(body["scores"], list)
