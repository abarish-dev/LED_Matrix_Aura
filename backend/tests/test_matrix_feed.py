"""
Backend tests for the Aura 2 / TheFlightWall FastAPI backend.

Focus: GET /api/matrix/feed proxy endpoint (aggregates flights, sports,
weather alerts, and temperature server-side into one compact JSON payload)
plus regression on the pre-existing endpoints:
    - GET /api/
    - GET /health
    - POST /api/status
    - GET /api/status

Per test brief:
    * ESPN blocks datacenter IPs -> score.ok == 0 is EXPECTED, NOT a failure.
    * NWS often has no active alerts at the test location -> alert.ok == 0 is fine.
    * flight.ok can be 0 or 1 depending on live air traffic -> either acceptable
      as long as the shape is well-formed.
    * temp.ok should be 1 with a numeric `f` (Fahrenheit) — this is the strong
      external dependency we assert on.
"""

import os
import time
import pytest
import requests


# Use the EXTERNAL preview URL so we exercise the /api ingress routing exactly
# like the user (ESP32) would. The env var is defined in frontend/.env.
BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
    or "https://smart-matrix-hub.preview.emergentagent.com"
).rstrip("/")

FEED = f"{BASE_URL}/api/matrix/feed"

# Charlotte, NC-ish coordinates from the review request
LAT = 35.5563
LON = -80.8713


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "AuraMatrixTest/1.0"})
    return s


# ---------------------------------------------------------------------------
# Regression tests for the pre-existing endpoints
# ---------------------------------------------------------------------------
class TestRegressionExisting:
    def test_root_api(self, api):
        r = api.get(f"{BASE_URL}/api/", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"message": "Hello World"}

    def test_health(self, api):
        # /health is registered without the /api prefix and is meant for the
        # in-cluster orchestrator probe. The external ingress only forwards
        # /api/* to the backend, so we must hit it on localhost:8001 directly.
        r = api.get("http://localhost:8001/health", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json() == {"status": "ok"}

    def test_status_post_and_get(self, api):
        payload = {"client_name": "TEST_matrix_feed_regression"}
        rp = api.post(f"{BASE_URL}/api/status", json=payload, timeout=15)
        assert rp.status_code == 200, rp.text
        created = rp.json()
        assert created["client_name"] == payload["client_name"]
        assert "id" in created and "timestamp" in created

        rg = api.get(f"{BASE_URL}/api/status", timeout=15)
        assert rg.status_code == 200
        items = rg.json()
        assert isinstance(items, list)
        assert any(i.get("id") == created["id"] for i in items), \
            "Newly created status_check not returned by GET /api/status"


# ---------------------------------------------------------------------------
# /api/matrix/feed shape helpers
# ---------------------------------------------------------------------------
def _assert_feed_shape(body):
    """All four top-level keys are objects that each contain an int `ok` field."""
    assert isinstance(body, dict), f"body not a dict: {body!r}"
    for k in ("flight", "score", "alert", "temp"):
        assert k in body, f"missing key {k!r} in response: {body!r}"
        assert isinstance(body[k], dict), f"{k} not an object: {body[k]!r}"
        assert "ok" in body[k], f"{k}.ok missing: {body[k]!r}"
        assert body[k]["ok"] in (0, 1), f"{k}.ok not 0/1: {body[k]!r}"


# ---------------------------------------------------------------------------
# /api/matrix/feed feature tests
# ---------------------------------------------------------------------------
class TestMatrixFeed:
    def test_full_query_returns_well_formed_payload(self, api):
        params = {"lat": LAT, "lon": LON, "radius": 40, "severity": "severe"}
        r = api.get(FEED, params=params, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        _assert_feed_shape(body)

        # temp.ok must be 1 with a numeric fahrenheit reading (open-meteo works)
        assert body["temp"]["ok"] == 1, f"temp.ok expected 1, got: {body['temp']!r}"
        assert isinstance(body["temp"].get("f"), (int, float)), \
            f"temp.f not numeric: {body['temp']!r}"
        # Loose sanity range for Fahrenheit anywhere on earth
        assert -80 <= body["temp"]["f"] <= 140, f"unrealistic temp.f: {body['temp']!r}"

        # flight.ok either 0 or 1 - just needs to be well-formed
        # (already validated by _assert_feed_shape)

    def test_defaults_when_only_lat_lon(self, api):
        r = api.get(FEED, params={"lat": LAT, "lon": LON}, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        _assert_feed_shape(body)
        # temp still expected to work with defaults
        assert body["temp"]["ok"] == 1, f"temp.ok expected 1 on defaults: {body['temp']!r}"

    def test_missing_required_params_returns_422(self, api):
        r = api.get(FEED, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"

    def test_missing_only_lon_returns_422(self, api):
        r = api.get(FEED, params={"lat": LAT}, timeout=15)
        assert r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}"

    def test_sports_with_team_returns_well_formed(self, api):
        # ESPN blocks datacenter IPs -> score.ok is likely 0. Only check shape.
        params = {"lat": LAT, "lon": LON, "team": "MLB:NYY", "sports": 1}
        r = api.get(FEED, params=params, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        _assert_feed_shape(body)
        assert "score" in body and isinstance(body["score"], dict)

    def test_toggles_flights_and_weather_off(self, api):
        params = {"lat": LAT, "lon": LON, "flights": 0, "weather": 0}
        r = api.get(FEED, params=params, timeout=25)
        assert r.status_code == 200, r.text
        body = r.json()
        _assert_feed_shape(body)
        # When flights=0 and weather=0, those fetches are skipped so ok must be 0
        assert body["flight"] == {"ok": 0}, f"expected flight skipped: {body['flight']!r}"
        assert body["alert"] == {"ok": 0}, f"expected alert skipped: {body['alert']!r}"
        # temp still fetched
        assert body["temp"]["ok"] == 1, f"temp still expected ok: {body['temp']!r}"

    def test_response_is_reasonably_fast_and_cache_hit(self, api):
        """First request under ~15s, second identical request should be fast (cache)."""
        params = {"lat": LAT, "lon": LON, "radius": 40, "severity": "severe",
                  "team": "MLB:NYY", "sports": 1}

        t0 = time.perf_counter()
        r1 = api.get(FEED, params=params, timeout=20)
        t1 = time.perf_counter() - t0
        assert r1.status_code == 200, r1.text
        assert t1 < 15.0, f"first feed call too slow: {t1:.2f}s"

        t0 = time.perf_counter()
        r2 = api.get(FEED, params=params, timeout=20)
        t2 = time.perf_counter() - t0
        assert r2.status_code == 200, r2.text
        # Cache TTL is 20s - the second call should be markedly faster.
        assert t2 < 3.0, f"cached feed call too slow (t2={t2:.2f}s, t1={t1:.2f}s)"

        # And return byte-identical JSON (same cached object).
        assert r1.json() == r2.json(), "cached response body differs from first"

    def test_response_is_compact_json(self, api):
        """Compact JSON = small payload (a few hundred bytes). ESP32-friendly."""
        r = api.get(FEED, params={"lat": LAT, "lon": LON}, timeout=25)
        assert r.status_code == 200
        size = len(r.content)
        assert size < 4096, f"feed payload unexpectedly large: {size} bytes"
        # And it should be valid JSON with the expected top-level keys
        body = r.json()
        assert set(body.keys()) >= {"flight", "score", "alert", "temp"}
