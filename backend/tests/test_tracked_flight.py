"""Offline unit tests for the pinned ("Track a specific flight") resolution
in /api/matrix/feed: IATA->ICAO mapping, regional operators, flights beyond
the closest 5 / outside the radius, rate-limit fallback. No network."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import server  # noqa: E402

LAT, LON = 35.501, -80.874  # Lake Norman


class Resp:
    def __init__(self, code, body):
        self.status_code, self._b = code, body

    def json(self):
        return self._b


def ac(cs, dlat, alt=10000):
    return {"flight": cs + "  ", "lat": LAT + dlat, "lon": LON, "alt_baro": alt, "track": 90}


class FakeCx:
    """nearby: list of ac dicts; world: callsign -> ac; codes override status."""

    def __init__(self, nearby, world=None, nearby_code=200, world_code=200):
        self.nearby, self.world = nearby, world or {}
        self.nearby_code, self.world_code = nearby_code, world_code
        self.calls = []

    async def get(self, url, **kw):
        self.calls.append(url)
        if "/v2/lat/" in url:
            return Resp(self.nearby_code, {"ac": self.nearby})
        if "/v2/callsign/" in url:
            cs = url.rsplit("/", 1)[1]
            if self.world_code != 200:
                return Resp(self.world_code, {})
            return Resp(200, {"ac": [self.world[cs]] if cs in self.world else []})
        if "adsbdb" in url:
            return Resp(404, {})
        return Resp(404, {})


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def busy_sky():
    # 8 planes within ~8 mi; the pinned one is the farthest (not in top 5).
    return [ac(f"PDT{6000 + i}", 0.01 * (i + 1)) for i in range(7)] + [ac("AAL1909", 0.3)]


def setup_function(_):
    server._track_cache.clear()
    server._nearby_last.clear()
    server._route_cache.clear()


def test_candidates_iata_icao_regional():
    keys, look = server._track_candidates("AA786")
    assert keys[0] == "AAL786" and "AA786" in keys and "AA786" not in look
    keys, look = server._track_candidates("aal0786")
    assert keys == ["AAL786"] and look == ["AAL786"]
    keys, look = server._track_candidates("AA5584")
    assert look[:2] == ["AAL5584", "JIA5584"] and "PDT5584" in look
    keys, look = server._track_candidates("N8414Y")  # registration stays literal first
    assert keys[0] == "N8414Y"
    assert server._cs_key("DAL0042") == server._cs_key("DAL42")


def test_old_behaviour_tracked_beyond_top5_is_dropped():
    r = run(server._fetch_flight(FakeCx(busy_sky()), LAT, LON, 25))
    assert "AAL1909" not in [p["cs"] for p in r["list"]]  # the bug Jessica hit


def test_iata_entry_pinned_first_even_if_not_closest():
    for ident in ("AA1909", "AAL1909", "aa 1909"):
        setup_function(None)
        r = run(server._fetch_flight(FakeCx(busy_sky()), LAT, LON, 25, ident))
        assert r["ok"] == 1
        assert r["list"][0]["cs"] == "AAL1909" and r["list"][0]["trk"] == 1
        assert len(r["list"]) == 5
        assert r["trk"] == {"ok": 1, "ident": ident, "cs": "AAL1909", "inRange": 1}


def test_regional_operator_resolved():
    sky = busy_sky() + [ac("JIA5584", 0.2)]
    r = run(server._fetch_flight(FakeCx(sky), LAT, LON, 25, "AA5584"))
    assert r["list"][0]["cs"] == "JIA5584" and r["trk"]["cs"] == "JIA5584"


def test_outside_radius_found_worldwide_and_cached():
    cx = FakeCx(busy_sky(), world={"AAL1783": ac("AAL1783", 4.0, 30000)})
    r = run(server._fetch_flight(cx, LAT, LON, 25, "AA1783"))
    assert r["list"][0]["cs"] == "AAL1783" and r["trk"]["inRange"] == 0
    assert r["list"][0]["dist"] > 250
    # only the ICAO form is queried worldwide (never the literal IATA "AA1783")
    assert not any(u.endswith("/callsign/AA1783") for u in cx.calls)
    n = len([u for u in cx.calls if "/callsign/" in u])
    run(server._fetch_flight(cx, LAT, LON, 25, "AA1783"))
    assert len([u for u in cx.calls if "/callsign/" in u]) == n  # cached


def test_not_airborne_yet_falls_back_to_nearby():
    r = run(server._fetch_flight(FakeCx(busy_sky()), LAT, LON, 25, "AA2999"))
    assert r["ok"] == 1 and r["trk"] == {"ok": 0, "ident": "AA2999"}
    assert all("trk" not in p for p in r["list"])


def test_tracked_shown_even_with_empty_local_sky():
    cx = FakeCx([], world={"AAL1783": ac("AAL1783", 4.0)})
    r = run(server._fetch_flight(cx, LAT, LON, 25, "AA1783"))
    assert r["ok"] == 1 and [p["cs"] for p in r["list"]] == ["AAL1783"]


def test_rate_limited_keeps_recent_hit_and_nearby():
    cx = FakeCx(busy_sky(), world={"AAL1783": ac("AAL1783", 4.0)})
    run(server._fetch_flight(cx, LAT, LON, 25, "AA1783"))
    # expire the hit, then adsb.lol starts 429-ing everything
    for k, v in list(server._track_cache.items()):
        server._track_cache[k] = (0, v[1], v[2])
    cx.world_code = cx.nearby_code = 429
    r = run(server._fetch_flight(cx, LAT, LON, 25, "AA1783"))
    assert r["list"][0]["cs"] == "AAL1783"
    assert len(r["list"]) == 5  # nearby list reused from the last good fetch


def test_feed_passes_track_and_keys_cache(monkeypatch):
    seen = []

    async def fake_fetch(cx, lat, lon, radius, track=""):
        seen.append(track)
        return {"ok": 1, "cs": "X", "list": []}

    async def fake_temp(*a):
        return {"ok": 0}

    monkeypatch.setattr(server, "_fetch_flight", fake_fetch)
    monkeypatch.setattr(server, "_fetch_temp", fake_temp)
    server._feed_cache.clear()
    run(server.matrix_feed(lat=LAT, lon=LON, radius=25, sports=0, weather=0, track="aa-1909"))
    run(server.matrix_feed(lat=LAT, lon=LON, radius=25, sports=0, weather=0, track=""))
    assert seen == ["AA1909", ""]


def test_lookup_retries_once_on_429(monkeypatch):
    monkeypatch.setattr(server, "_TRACK_RETRY_DELAY", 0)

    class Flaky(FakeCx):
        n = 0

        async def get(self, url, **kw):
            if "/v2/callsign/" in url:
                Flaky.n += 1
                if Flaky.n == 1:
                    return Resp(429, {})
            return await super().get(url, **kw)

    cx = Flaky(busy_sky(), world={"AAL1783": ac("AAL1783", 4.0)})
    r = run(server._fetch_flight(cx, LAT, LON, 25, "AA1783"))
    assert r["list"][0]["cs"] == "AAL1783"
