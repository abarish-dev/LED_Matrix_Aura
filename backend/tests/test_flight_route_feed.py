"""
Tests specific to the new backend flight-feed enrichment (Aura 2, iteration 28):

  * payload.flight (when ok==1) must include airline / from / to strings
    plus a 'list' array (<=5) whose items each have cs, dist, alt, hdg,
    airline, from, to.
  * Toggle regression: sports=1&team=MLB:NYY&weather=1 still returns
    well-formed score + alert + temp blocks without a 500.

JFK coordinates (40.6413,-73.7781) are used because JFK almost always has
active traffic (the review request uses this same point).
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
LAT, LON = 40.6413, -73.7781  # JFK


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "AuraMatrixTest/1.0"})
    return s


class TestFlightRouteEnrichment:
    def test_flight_shape_and_route_fields(self, api):
        params = {"lat": LAT, "lon": LON, "radius": 40,
                  "flights": 1, "sports": 0, "weather": 0}
        r = api.get(FEED, params=params, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()

        # Top-level shape - still returns temp block, not a 500
        assert isinstance(body, dict)
        assert body.get("temp", {}).get("ok") == 1, f"temp not ok: {body.get('temp')!r}"
        assert body.get("score") == {"ok": 0}
        assert body.get("alert") == {"ok": 0}

        flight = body.get("flight")
        assert isinstance(flight, dict), f"flight not dict: {flight!r}"
        assert flight.get("ok") in (0, 1)

        # If aircraft are up (nearly always at JFK), assert the new fields.
        if flight["ok"] == 1:
            # Primary (first) plane fields at the top level
            for k in ("cs", "dist", "alt", "hdg", "airline", "from", "to"):
                assert k in flight, f"top-level flight missing {k!r}: {flight!r}"
            assert isinstance(flight["airline"], str)
            assert isinstance(flight["from"], str)
            assert isinstance(flight["to"], str)

            # 'list' present, up to 5, per-item shape.
            lst = flight.get("list")
            assert isinstance(lst, list), f"flight.list not a list: {lst!r}"
            assert 1 <= len(lst) <= 5, f"flight.list length out of range: {len(lst)}"
            for i, p in enumerate(lst):
                assert isinstance(p, dict), f"list[{i}] not dict: {p!r}"
                for k in ("cs", "dist", "alt", "hdg", "airline", "from", "to"):
                    assert k in p, f"list[{i}] missing {k!r}: {p!r}"
                assert isinstance(p["cs"], str) and p["cs"], f"empty cs at list[{i}]: {p!r}"
                assert isinstance(p["dist"], int)
                assert isinstance(p["alt"], int)
                assert isinstance(p["hdg"], int)
                assert isinstance(p["airline"], str)
                assert isinstance(p["from"], str)
                assert isinstance(p["to"], str)

            # At least one enriched entry should have non-empty airline OR route
            # (adsbdb usually resolves the majority of commercial callsigns).
            enriched = [p for p in lst if p["airline"] or p["from"] or p["to"]]
            assert enriched, f"no enrichment on any of {len(lst)} planes: {lst!r}"

    def test_regression_sports_weather_no_500(self, api):
        params = {"lat": LAT, "lon": LON, "sports": 1, "team": "MLB:NYY",
                  "weather": 1}
        r = api.get(FEED, params=params, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        # All four blocks present, none error out
        for k in ("flight", "score", "alert", "temp"):
            assert k in body, f"missing {k!r}"
            assert isinstance(body[k], dict)
            assert body[k].get("ok") in (0, 1)
        # Temp still healthy
        assert body["temp"]["ok"] == 1
        assert isinstance(body["temp"].get("f"), (int, float))
