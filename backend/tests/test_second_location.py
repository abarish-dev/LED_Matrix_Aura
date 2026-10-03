"""Offline tests: /api/matrix/feed watches an optional second location
(lat2/lon2) for weather alerts and returns it as `alert2`."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402


def run(c):
    return asyncio.new_event_loop().run_until_complete(c)


def _patch(monkeypatch):
    calls = []

    async def fake_alert(cx, lat, lon, sev):
        calls.append((round(lat, 2), round(lon, 2), sev))
        if round(lat) == 26:  # Miami
            return {"ok": 1, "head": "Hurricane Warning", "sev": "extreme"}
        return {"ok": 0}

    async def ok0(*a, **k):
        return {"ok": 0}

    monkeypatch.setattr(server, "_fetch_alert", fake_alert)
    monkeypatch.setattr(server, "_fetch_temp", ok0)
    monkeypatch.setattr(server, "_fetch_flight", ok0)
    server._feed_cache.clear()
    server._last_good.clear()
    return calls


def test_alert2_returned_for_second_location(monkeypatch):
    calls = _patch(monkeypatch)
    p = run(server.matrix_feed(lat=35.5, lon=-80.87, flights=0, sports=0, weather=1,
                               lat2=25.77, lon2=-80.19))
    assert p["alert"] == {"ok": 0}
    assert p["alert2"] == {"ok": 1, "head": "Hurricane Warning", "sev": "extreme"}
    assert (25.77, -80.19, "severe") in calls


def test_no_second_location_payload_unchanged(monkeypatch):
    _patch(monkeypatch)
    p = run(server.matrix_feed(lat=35.5, lon=-80.87, flights=0, sports=0, weather=1))
    assert "alert2" not in p


def test_second_location_needs_weather_and_valid_coords(monkeypatch):
    _patch(monkeypatch)
    p = run(server.matrix_feed(lat=35.5, lon=-80.87, flights=0, sports=0, weather=0,
                               lat2=25.77, lon2=-80.19))
    assert "alert2" not in p
    server._feed_cache.clear()
    p = run(server.matrix_feed(lat=35.5, lon=-80.87, flights=0, sports=0, weather=1,
                               lat2=125.0, lon2=-80.19))
    assert "alert2" not in p


def test_cache_key_includes_second_location(monkeypatch):
    _patch(monkeypatch)
    a = run(server.matrix_feed(lat=35.5, lon=-80.87, flights=0, sports=0, weather=1))
    b = run(server.matrix_feed(lat=35.5, lon=-80.87, flights=0, sports=0, weather=1,
                               lat2=25.77, lon2=-80.19))
    assert "alert2" not in a and b["alert2"]["ok"] == 1
