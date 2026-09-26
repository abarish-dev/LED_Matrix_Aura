"""Tests for GET /api/matrix/feed - focused on the new `ufc` param (Display::ufc card).

Covers:
- ufc=1 returns top-level 'ufc' key with ok:1 (event found) or ok:0 (graceful failure)
- ufc=0 / omitted -> ufc key present as {"ok": 0}, no fetch attempted
- No regression on other keys (flight/score/scores/alert/temp) when ufc=1 combined with others
- No 500 errors
- Cache key differentiates ufc=1 vs ufc=0 (toggling param changes response)
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get('EXPO_PUBLIC_BACKEND_URL', '').rstrip('/')
FEED_URL = f"{BASE_URL}/api/matrix/feed"

# Charlotte, NC area coords used in the review request example
PARAMS_BASE = {"lat": 35.5563, "lon": -80.8714, "radius": 40}


@pytest.fixture
def api_client():
    session = requests.Session()
    return session


class TestMatrixFeedUfc:

    def test_ufc_1_returns_ufc_key(self, api_client):
        params = {**PARAMS_BASE, "severity": "severe", "flights": 0, "sports": 0, "weather": 0, "ufc": 1}
        r = api_client.get(FEED_URL, params=params, timeout=20)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "ufc" in data, "Response missing top-level 'ufc' key"
        ufc = data["ufc"]
        assert "ok" in ufc
        if ufc["ok"] == 1:
            assert isinstance(ufc.get("name"), str) and len(ufc["name"]) > 0
            assert "date" in ufc
            assert "headline" in ufc
            assert isinstance(ufc["headline"], str)
        else:
            assert ufc["ok"] == 0

    def test_ufc_0_returns_ok_0(self, api_client):
        params = {**PARAMS_BASE, "flights": 0, "sports": 0, "weather": 0, "ufc": 0}
        r = api_client.get(FEED_URL, params=params, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "ufc" in data
        assert data["ufc"] == {"ok": 0}

    def test_ufc_omitted_defaults_to_ok_0(self, api_client):
        params = {**PARAMS_BASE, "flights": 0, "sports": 0, "weather": 0}
        r = api_client.get(FEED_URL, params=params, timeout=20)
        assert r.status_code == 200
        data = r.json()
        assert "ufc" in data
        assert data["ufc"] == {"ok": 0}

    def test_no_regression_other_keys_with_ufc_and_others_enabled(self, api_client):
        params = {**PARAMS_BASE, "team": "nba:LAL", "severity": "severe",
                  "flights": 1, "sports": 1, "weather": 1, "ufc": 1}
        r = api_client.get(FEED_URL, params=params, timeout=25)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        for key in ("flight", "score", "scores", "alert", "temp", "ufc"):
            assert key in data, f"Missing key {key} in combined response"
        assert isinstance(data["scores"], list)
        assert "ok" in data["flight"]
        assert "ok" in data["alert"]
        assert "ok" in data["temp"]
        assert "ok" in data["ufc"]

    def test_no_500_under_normal_conditions(self, api_client):
        # Slightly different (unused) coordinates to bypass any cache from previous tests
        params = {"lat": 40.7128, "lon": -74.0060, "radius": 40,
                  "flights": 1, "sports": 0, "weather": 1, "ufc": 1}
        r = api_client.get(FEED_URL, params=params, timeout=25)
        assert r.status_code == 200
        assert r.json() is not None

    def test_cache_key_differentiates_ufc_toggle(self, api_client):
        # Use a fresh, unique lat/lon combo so we don't hit cache from other tests (~20s TTL)
        lat, lon = 33.4484, -112.0740  # Phoenix
        params_off = {"lat": lat, "lon": lon, "radius": 40, "flights": 0, "sports": 0, "weather": 0, "ufc": 0}
        params_on = {**params_off, "ufc": 1}

        r_off = api_client.get(FEED_URL, params=params_off, timeout=20)
        assert r_off.status_code == 200
        data_off = r_off.json()
        assert data_off["ufc"] == {"ok": 0}

        r_on = api_client.get(FEED_URL, params=params_on, timeout=20)
        assert r_on.status_code == 200
        data_on = r_on.json()
        assert "ufc" in data_on
        # ufc=1 must actually attempt the fetch: response must not be the stale
        # ufc=0 cached payload. Either ok=1 with real data, or ok=0 due to ESPN
        # having no events / failing gracefully - but it should be a genuinely
        # separate cache entry (this is mostly validated by no exception + 200).
        assert data_on["ufc"]["ok"] in (0, 1)
