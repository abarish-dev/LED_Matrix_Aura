from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import asyncio
import logging
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# One shared outbound HTTP client (connection pooling / TLS reuse across the
# feed's parallel upstream fetches and across warm serverless invocations).
# Created lazily so importing the module never needs a running event loop.
_http: "httpx.AsyncClient | None" = None
_http_loop = None


def _get_http() -> httpx.AsyncClient:
    """Return the shared client, (re)creating it if it was closed or belongs to
    a different event loop (pooled connections are loop-bound)."""
    global _http, _http_loop
    loop = asyncio.get_running_loop()
    if _http is None or _http.is_closed or _http_loop is not loop:
        _http = httpx.AsyncClient(timeout=10.0, follow_redirects=True)
        _http_loop = loop
    return _http


@asynccontextmanager
async def lifespan(_app):
    yield
    global _http
    if _http is not None and not _http.is_closed:
        await _http.aclose()
    _http = None


# Create the main app without a prefix
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Add your routes to the router instead of directly to app
@api_router.get("/app-icon.png")
async def app_icon():
    """Serve the current app icon so it can be saved on a phone and uploaded
    into the Android/iOS build 'App icon' field."""
    return FileResponse(ROOT_DIR / "app_icon.png", media_type="image/png")

@api_router.get("/")
async def root():
    return {"message": "Hello World"}

# ---------------------------------------------------------------------------
# Matrix feed proxy: the ESP32 makes ONE small HTTPS call here every 30s and we
# do all the heavy multi-source fetching server-side (reliable network, no bot
# blocks / rate-limit issues, off-day sports logic). Returns compact JSON.
# ---------------------------------------------------------------------------
import time as _time
import math as _math
from datetime import timezone, timedelta

_ESPN_PATHS = {"NFL": "football/nfl", "NBA": "basketball/nba",
               "MLB": "baseball/mlb", "NHL": "hockey/nhl"}
_BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
               "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
_feed_cache: dict = {}          # key -> (expires_ts, payload)
_last_temp: dict = {}           # "lat,lon" -> last good temp (survive rate-limits)
_FEED_TTL = 20                  # seconds


def _haversine_mi(lat1, lon1, lat2, lon2):
    R = 3958.8
    p1, p2 = _math.radians(lat1), _math.radians(lat2)
    dp = _math.radians(lat2 - lat1)
    dl = _math.radians(lon2 - lon1)
    a = _math.sin(dp / 2) ** 2 + _math.cos(p1) * _math.cos(p2) * _math.sin(dl / 2) ** 2
    return R * 2 * _math.atan2(_math.sqrt(a), _math.sqrt(1 - a))


_route_cache: dict = {}          # callsign -> (expires_ts, {airline, from, to})

# Latency budgets so /api/matrix/feed always answers well inside the ESP32's
# 12s HTTP timeout, even when adsb.lol / adsbdb / ESPN are slow. A source that
# misses its budget falls back to its last good value (or ok=0).
_FLIGHT_FETCH_TIMEOUT = 4.0      # adsb.lol request itself
_FLIGHT_BUDGET = 5.5             # adsb.lol + adsbdb enrichment, total
_SOURCE_BUDGET = 6.5             # every other feed source (ESPN, NWS, open-meteo)
_LAST_GOOD_TTL = 600             # seconds a last-good fallback may be reused
_last_good: dict = {}            # source key -> (ts, value)
_ET = ZoneInfo("America/New_York")


def _fmt_eastern(dt: datetime) -> str:
    """Format like ESPN's shortDetail, e.g. '10/2 - 7:00 PM EDT'."""
    return dt.astimezone(_ET).strftime("%-m/%-d - %-I:%M %p %Z")


def _is_good(v) -> bool:
    if isinstance(v, dict):
        return v.get("ok") == 1
    if isinstance(v, list):
        return any(isinstance(g, dict) and g.get("ok") == 1 for g in v)
    return False


async def _bounded(key: str, coro, timeout: float, default):
    """Run one feed source with a hard time budget. On success remember the
    value; on timeout/error return the last good value (<= _LAST_GOOD_TTL old)
    or `default`."""
    try:
        v = await asyncio.wait_for(coro, timeout)
    except Exception as e:  # asyncio.TimeoutError or anything upstream
        logger.info(f"[feed] {key} missed budget/failed: {type(e).__name__}")
        hit = _last_good.get(key)
        if hit and _time.time() - hit[0] < _LAST_GOOD_TTL:
            return hit[1]
        return default
    if _is_good(v):
        _last_good[key] = (_time.time(), v)
    return v


async def _enrich_route(cx, cs):
    """Airline name + origin/destination IATA for a callsign (adsbdb.com,
    keyless). Cached 6h. Best-effort — returns {} on any failure."""
    cs = (cs or "").strip()
    if not cs:
        return {}
    hit = _route_cache.get(cs)
    if hit and hit[0] > _time.time():
        return hit[1]
    info = {}
    try:
        r = await cx.get(f"https://api.adsbdb.com/v0/callsign/{cs}",
                         headers={"User-Agent": "AuraMatrix/1.0"}, timeout=3.0)
        if r.status_code == 200:
            fr = ((r.json() or {}).get("response") or {}).get("flightroute") or {}
            info = {
                "airline": ((fr.get("airline") or {}).get("name") or "")[:18],
                "from": (fr.get("origin") or {}).get("iata_code") or "",
                "to": (fr.get("destination") or {}).get("iata_code") or "",
            }
    except Exception:
        info = {}
    _route_cache[cs] = (_time.time() + 6 * 3600, info)
    return info


# ---- Tracked ("pinned") flight resolution ---------------------------------
# ADS-B callsigns are ICAO (AAL786, JIA5584), but people type the IATA flight
# number off their boarding pass (AA786, AA5584). Map common IATA airline
# designators to ICAO, and for regional (3000+) numbers also try the regional
# operators that fly under that brand (American Eagle AA5584 = PSA "JIA5584").
import re as _re
_IATA_ICAO = {
    "AA": "AAL", "DL": "DAL", "UA": "UAL", "WN": "SWA", "B6": "JBU", "AS": "ASA",
    "NK": "NKS", "F9": "FFT", "G4": "AAY", "HA": "HAL", "SY": "SCX", "MX": "MXY",
    "XP": "VXP", "OH": "JIA", "PT": "PDT", "MQ": "ENY", "YX": "RPA", "OO": "SKW",
    "9E": "EDV", "YV": "ASH", "ZW": "AWI", "G7": "GJS", "QX": "QXE", "C5": "UCA",
    "AC": "ACA", "WS": "WJA", "BA": "BAW", "VS": "VIR", "LH": "DLH", "AF": "AFR",
    "KL": "KLM", "IB": "IBE", "EI": "EIN", "LX": "SWR", "TK": "THY", "EK": "UAE",
    "QR": "QTR", "AM": "AMX", "CM": "CMP", "AV": "AVA", "LA": "LAN", "JL": "JAL",
    "NH": "ANA", "QF": "QFA", "5X": "UPS", "FX": "FDX",
}
_REGIONALS = {
    "AA": ("JIA", "PDT", "ENY", "RPA"),
    "DL": ("EDV", "SKW", "RPA"),
    "UA": ("SKW", "RPA", "ASH", "GJS"),
    "AS": ("QXE", "SKW"),
}
_IDENT_RE = _re.compile(r"^([A-Z][A-Z0-9]|[0-9][A-Z]|[A-Z]{3})(\d{1,4})([A-Z]?)$")
_TRACK_LOOKUP_TIMEOUT = 2.0
_TRACK_RETRY_DELAY = 1.2
_track_cache: dict = {}          # callsign key -> (expires_ts, row or None)
_TRACK_HIT_TTL = 15              # a found flight is re-looked-up after 15s
_TRACK_MISS_TTL = 60             # "not airborne / no ADS-B" re-checked each minute
_TRACK_STALE_OK = 180            # reuse a found flight this long through upstream 429s
_nearby_last: dict = {}          # "lat,lon,radius" -> (ts, rows) for 429 fallback
_FLIGHT_BUDGET_TRACK = 7.0        # + worldwide pinned-flight lookup (still < ESP32 12s)


def _cs_key(cs) -> str:
    """Comparable callsign: upper-case, alphanumerics only, leading zeros of
    the flight number dropped (AAL0786 == AAL786)."""
    c = _re.sub(r"[^A-Z0-9]", "", str(cs or "").upper())
    m = _IDENT_RE.match(c)
    if m:
        return f"{m.group(1)}{int(m.group(2))}{m.group(3)}"
    return c


def _track_candidates(ident) -> tuple:
    """(keys, lookup_keys) for a pinned-flight entry (IATA or ICAO flight
    number, or a raw callsign / registration). `keys` are every callsign
    form it may appear as in ADS-B, most likely first; `lookup_keys` are the
    ones worth a worldwide callsign query (a mapped IATA number like AA786
    never appears verbatim in ADS-B, so it isn't queried)."""
    raw = _re.sub(r"[^A-Z0-9]", "", str(ident or "").upper())
    if not raw:
        return [], []
    m = _IDENT_RE.match(raw)
    lit = _cs_key(raw)
    if m and len(m.group(1)) == 2:
        pre, num, suf = m.group(1), int(m.group(2)), m.group(3)
        icao = _IATA_ICAO.get(pre)
        regional = [f"{op}{num}{suf}" for op in _REGIONALS.get(pre, ())] if num >= 3000 else []
        if icao:
            look = [f"{icao}{num}{suf}"] + regional
            keys = look + [lit]
        else:
            keys = look = [lit] + regional
    else:
        keys = look = [lit]
    dedup = lambda xs: list(dict.fromkeys(xs))
    return dedup(keys), dedup(look)


def _ac_row(a, lat, lon):
    cs = (a.get("flight") or "").strip()
    if not cs or a.get("lat") is None or a.get("lon") is None:
        return None
    d = _haversine_mi(lat, lon, a["lat"], a["lon"])
    alt = a.get("alt_baro")
    return {
        "cs": cs, "dist": int(round(d)),
        "alt": int(alt) if isinstance(alt, (int, float)) else 0,
        "hdg": int(round(a.get("track"))) if isinstance(a.get("track"), (int, float)) else -1,
        "_d": d,
    }


async def _lookup_callsign(cx, cs, lat, lon):
    """Worldwide adsb.lol lookup of one exact callsign -> (row|None, ok).
    ok=False means the upstream call itself failed (429/timeout)."""
    try:
        for attempt in range(2):
            r = await cx.get(f"https://api.adsb.lol/v2/callsign/{cs}",
                             headers={"User-Agent": "AuraMatrix/1.0 (LED matrix flight display)"},
                             timeout=_TRACK_LOOKUP_TIMEOUT)
            # adsb.lol rate-limits bursts (the nearby call just went out):
            # one short back-off retry, still inside the flight budget.
            if r.status_code == 429 and attempt == 0:
                await asyncio.sleep(_TRACK_RETRY_DELAY)
                continue
            break
        if r.status_code != 200:
            return None, False
        for a in (r.json() or {}).get("ac") or []:
            row = _ac_row(a, lat, lon)
            if row and _cs_key(row["cs"]) == _cs_key(cs):
                return row, True
        return None, True
    except Exception:
        return None, False


async def _find_tracked(cx, cands_rows, track, lat, lon):
    """Locate the pinned flight: first in the nearby list (anywhere in the
    radius, not just the closest 5), then worldwide by callsign so a family
    member's flight still shows when it's outside the local radius. Lookups
    are cached briefly (hits 15s, misses 60s) so the panel's 30s polling
    doesn't trip adsb.lol's rate limit, and a recent hit rides through a
    failed (429/timeout) lookup for up to 3 minutes."""
    keys, look = _track_candidates(track)
    if not keys:
        return None
    for k in keys:  # most-likely form first
        for c in cands_rows:
            if _cs_key(c["cs"]) == k:
                return c
    now = _time.time()
    found, todo = None, []
    for k in look:
        hit = _track_cache.get((k, f"{lat:.2f},{lon:.2f}"))
        if hit and hit[0] > now:
            if hit[1] and found is None:
                found = hit[1]
        else:
            todo.append(k)
    if found is not None:
        return found
    if todo:
        res = await asyncio.gather(*[_lookup_callsign(cx, k, lat, lon) for k in todo],
                                   return_exceptions=True)
        for k, r in zip(todo, res):
            ck = (k, f"{lat:.2f},{lon:.2f}")
            row, ok = r if isinstance(r, tuple) else (None, False)
            if row:
                _track_cache[ck] = (now + _TRACK_HIT_TTL, row, now)
            elif ok:
                _track_cache[ck] = (now + _TRACK_MISS_TTL, None, now)
            if row and found is None:
                found = row
    if found is None:
        # Nothing fresh (upstream 429/timeout): a stale-but-recent real hit
        # beats a blank pinned flight.
        for k in look:
            old = _track_cache.get((k, f"{lat:.2f},{lon:.2f}"))
            if old and old[1] and now - old[2] < _TRACK_STALE_OK:
                return old[1]
    return found


async def _fetch_flight(cx, lat, lon, radius_mi, track: str = ""):
    out = {"ok": 0}
    track = (track or "").strip()
    if track:
        out["trk"] = {"ok": 0, "ident": track}
    try:
        nm = max(1, int(radius_mi / 1.15078))
        url = f"https://api.adsb.lol/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{nm}"
        t0 = _time.monotonic()
        nkey = f"{lat:.4f},{lon:.4f},{radius_mi}"
        cands = []
        try:
            r = await cx.get(url, headers={"User-Agent": "AuraMatrix/1.0 (LED matrix flight display)"},
                             timeout=_FLIGHT_FETCH_TIMEOUT)
            if r.status_code == 200:
                for a in (r.json() or {}).get("ac") or []:
                    row = _ac_row(a, lat, lon)
                    if row:
                        cands.append(row)
                _nearby_last[nkey] = (_time.time(), cands)
            elif not track:
                return out
            else:
                # Rate-limited/failed while tracking: reuse the last nearby
                # list so the pinned flight doesn't arrive alone.
                hit = _nearby_last.get(nkey)
                if hit and _time.time() - hit[0] < _LAST_GOOD_TTL:
                    cands = [dict(c) for c in hit[1]]
        except Exception:
            if not track:
                raise
        cands.sort(key=lambda c: c["_d"])
        tracked = await _find_tracked(cx, cands, track, lat, lon) if track else None
        if not cands and not tracked:
            return out
        top = cands[:5]
        if tracked:
            # Pinned flight always rides first in the list (the firmware's
            # list holds 5), whether or not it's among the closest.
            tk = _cs_key(tracked["cs"])
            top = [tracked] + [c for c in top if _cs_key(c["cs"]) != tk][:4]
        # Enrich each with airline name + route (parallel, best-effort).
        # Bounded by whatever is left of the flight budget: any lookup still
        # pending is cancelled and that plane is returned without route info
        # (a later feed call will pick it up from _route_cache).
        total = _FLIGHT_BUDGET_TRACK if track else _FLIGHT_BUDGET
        budget = max(0.5, total - 0.3 - (_time.monotonic() - t0))
        tasks = [asyncio.ensure_future(_enrich_route(cx, c["cs"])) for c in top]
        _done, pending = await asyncio.wait(tasks, timeout=budget)
        for t in pending:
            t.cancel()
        routes = [t.result() if (t.done() and not t.cancelled() and t.exception() is None) else {}
                  for t in tasks]
        planes = []
        for i, (c, rt) in enumerate(zip(top, routes)):
            rt = rt if isinstance(rt, dict) else {}
            p = {"cs": c["cs"], "dist": c["dist"], "alt": c["alt"], "hdg": c["hdg"],
                 "airline": rt.get("airline", ""), "from": rt.get("from", ""),
                 "to": rt.get("to", "")}
            if tracked and i == 0:
                p["trk"] = 1
            planes.append(p)
        first = planes[0]
        res = {"ok": 1, **first, "list": planes}
        if track:
            res["trk"] = ({"ok": 1, "ident": track, "cs": tracked["cs"],
                           "inRange": 1 if tracked["_d"] <= radius_mi else 0}
                          if tracked else {"ok": 0, "ident": track})
        return res
    except Exception as e:
        logger.info(f"[feed] flight error: {e}")
        return out


async def _fetch_score(cx, team):
    """Returns a LIST of 0-2 game dicts for this team:
      - a LIVE game takes over completely (previous/finished game is hidden).
      - otherwise, a game that finished within the last 12h AND/OR a game that
        starts within the next 12h are both included together.
      - if neither applies (i.e. more than ~12h since the last final, and
        nothing else starting soon), fall back to the single next scheduled
        game so the card always has something once the recent result ages out.
    NOTE: ESPN's scoreboard only gives each game's START time, not an actual
    "finished at" timestamp, so "finished within the last 12h" is approximated
    using the start time of games ESPN already marks as final (state=="post").
    """
    try:
        league, _, abbr = team.partition(":")
        path = _ESPN_PATHS.get(league.upper())
        if not path or not abbr:
            return []
        now = datetime.now(timezone.utc)
        now_ts = now.timestamp()
        start = (now - timedelta(days=2)).strftime("%Y%m%d")
        end = (now + timedelta(days=8)).strftime("%Y%m%d")
        # site.web.api.espn.com is NOT Akamai-blocked from datacenter IPs
        # (site.api.espn.com returns 403), and serves the same scoreboard.
        url = (f"https://site.web.api.espn.com/apis/site/v2/sports/{path}/scoreboard"
               f"?dates={start}-{end}&limit=100")
        r = await cx.get(url, headers={"User-Agent": _BROWSER_UA})
        if r.status_code != 200:
            # fall back to today-only scoreboard
            r = await cx.get(url.split("?")[0], headers={"User-Agent": _BROWSER_UA})
            if r.status_code != 200:
                return []
        events = (r.json() or {}).get("events") or []

        def to_dict(comp, comps):
            home = away = ""
            hs = as_ = 0
            for c in comps:
                ab = (c.get("team") or {}).get("abbreviation", "").upper()
                sc = int(c.get("score")) if str(c.get("score", "")).isdigit() else 0
                if c.get("homeAway") == "home":
                    home, hs = ab, sc
                else:
                    away, as_ = ab, sc
            st = ((comp.get("status") or {}).get("type") or {}).get("shortDetail", "")
            return {"ok": 1, "home": home, "hs": hs, "away": away, "as": as_, "st": st}

        HOUR = 3600
        live = None
        recent_final, recent_delta = None, 1e18       # smallest hours-since-start, <=12h
        upcoming_12h, upcoming_delta = None, 1e18      # smallest hours-until-start, <=12h
        next_game, next_delta = None, 1e18             # smallest hours-until-start, any distance

        for ev in events:
            comp = (ev.get("competitions") or [{}])[0]
            comps = comp.get("competitors") or []
            if not any((c.get("team") or {}).get("abbreviation", "").upper() == abbr.upper() for c in comps):
                continue
            try:
                ets = datetime.fromisoformat(ev.get("date", "").replace("Z", "+00:00")).timestamp()
            except Exception:
                continue
            state = ((comp.get("status") or {}).get("type") or {}).get("state")  # "pre" | "in" | "post"

            if state == "in":
                live = (comp, comps)
            elif state == "post":
                delta = now_ts - ets
                if 0 <= delta <= 12 * HOUR and delta < recent_delta:
                    recent_delta, recent_final = delta, (comp, comps)
            elif state == "pre":
                delta = ets - now_ts
                if delta >= 0:
                    if delta <= 12 * HOUR and delta < upcoming_delta:
                        upcoming_delta, upcoming_12h = delta, (comp, comps)
                    if delta < next_delta:
                        next_delta, next_game = delta, (comp, comps)

        if live:
            return [to_dict(*live)]   # live game only — hide any previous result

        out = []
        if recent_final:
            out.append(to_dict(*recent_final))
        if upcoming_12h:
            out.append(to_dict(*upcoming_12h))
        if not out and next_game:
            out.append(to_dict(*next_game))
        if out:
            return out

        # Nothing in the +/-8ish day scoreboard window at all (a real
        # off-season gap, e.g. before the season opener) — fall back to the
        # team's profile endpoint for their season record + next scheduled
        # game however far out, so a followed team is never just silently
        # blank. Tagged mode="record" so the UI shows "record + next game"
        # instead of a live score line.
        try:
            r2 = await cx.get(
                f"https://site.web.api.espn.com/apis/site/v2/sports/{path}/teams/{abbr.lower()}",
                headers={"User-Agent": _BROWSER_UA},
            )
            if r2.status_code == 200:
                team_d = (r2.json() or {}).get("team") or {}
                rec_items = (team_d.get("record") or {}).get("items") or []
                record = rec_items[0].get("summary") if rec_items else None
                ne = (team_d.get("nextEvent") or [None])[0]
                opp_abbr, st_text = "", "Season"
                if ne:
                    comp2 = (ne.get("competitions") or [{}])[0]
                    comps2 = comp2.get("competitors") or []
                    mine2 = next(
                        (c for c in comps2
                         if (c.get("team") or {}).get("abbreviation", "").upper() == abbr.upper()),
                        None,
                    )
                    opp2 = next((c for c in comps2 if c is not mine2), None)
                    opp_abbr = ((opp2 or {}).get("team") or {}).get("abbreviation", "").upper()
                    try:
                        ev_dt = datetime.fromisoformat(ne.get("date", "").replace("Z", "+00:00"))
                        st_text = _fmt_eastern(ev_dt)
                    except Exception:
                        st_text = "Upcoming"
                if record or opp_abbr:
                    return [{"ok": 1, "mode": "record", "home": abbr.upper(), "away": opp_abbr,
                             "hs": 0, "as": 0, "record": record or "", "st": st_text}]
        except Exception as e:
            logger.info(f"[feed] record fallback error: {e}")
        return []
    except Exception as e:
        logger.info(f"[feed] score error: {e}")
        return []


async def _fetch_alert(cx, lat, lon, min_sev):
    out = {"ok": 0}
    rank = {"minor": 1, "moderate": 2, "severe": 3, "extreme": 4}
    try:
        url = f"https://api.weather.gov/alerts/active?point={lat:.4f},{lon:.4f}"
        r = await cx.get(url, headers={"User-Agent": "AuraMatrix/1.0 (contact@auramatrix.app)",
                                       "Accept": "application/geo+json"})
        if r.status_code != 200:
            return out
        feats = (r.json() or {}).get("features") or []
        want = rank.get((min_sev or "severe").lower(), 3)
        best = None
        for f in feats:
            p = f.get("properties") or {}
            sev = (p.get("severity") or "").lower()
            if rank.get(sev, 0) >= want:
                if best is None or rank.get(sev, 0) >= rank.get(best.get("sev", ""), 0):
                    best = {"head": p.get("event") or p.get("headline") or "Weather Alert", "sev": sev}
        if best:
            return {"ok": 1, **best}
        return out
    except Exception as e:
        logger.info(f"[feed] alert error: {e}")
        return out


async def _fetch_ufc(cx):
    """Next (or in-progress) UFC event summary, mirroring the app's
    getNextUfc() in espn.ts so the matrix + app show the same thing."""
    out = {"ok": 0}
    try:
        # site.web.api.espn.com is NOT Akamai-blocked from datacenter IPs
        # (site.api.espn.com returns 403 here — confirmed the hard way), and
        # serves the same MMA scoreboard data. Same fix as _fetch_score/_fetch_streak.
        url = "https://site.web.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
        r = await cx.get(url, headers={"User-Agent": _BROWSER_UA})
        if r.status_code != 200:
            return out
        events = (r.json() or {}).get("events") or []
        if not events:
            return out
        ev = next(
            (e for e in events
             if (((e.get("competitions") or [{}])[0].get("status") or {}).get("type") or {}).get("state") != "post"),
            events[0],
        )
        comp = (ev.get("competitions") or [{}])[0]
        comps = comp.get("competitors") or []
        headline = ""
        if len(comps) >= 2:
            a = (comps[0].get("athlete") or {}).get("displayName") or (comps[0].get("team") or {}).get("displayName") or "TBD"
            b = (comps[1].get("athlete") or {}).get("displayName") or (comps[1].get("team") or {}).get("displayName") or "TBD"
            headline = f"{a} vs {b}"
        date_str = ""
        try:
            dt = datetime.fromisoformat((ev.get("date") or "").replace("Z", "+00:00"))
            date_str = dt.strftime("%a %b %d").replace(" 0", " ")
        except Exception:
            date_str = ""
        return {
            "ok": 1,
            "name": (ev.get("shortName") or ev.get("name") or "UFC")[:24],
            "date": date_str,
            "headline": headline[:40],
        }
    except Exception as e:
        logger.info(f"[feed] ufc error: {e}")
        return out


async def _fetch_temp(cx, lat, lon):
    out = {"ok": 0}
    key = f"{lat:.4f},{lon:.4f}"
    try:
        url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat:.4f}&longitude={lon:.4f}"
               f"&current=temperature_2m,apparent_temperature,weather_code,is_day"
               f"&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit"
               f"&timezone=auto&forecast_days=1")
        r = await cx.get(url, headers={"User-Agent": "AuraMatrix/1.0 (LED matrix)"})
        if r.status_code != 200:
            return _last_temp.get(key, out)   # graceful: reuse last good on 429/etc
        j = r.json() or {}
        cur = j.get("current") or {}
        daily = j.get("daily") or {}
        hi = (daily.get("temperature_2m_max") or [None])[0]
        lo = (daily.get("temperature_2m_min") or [None])[0]
        res = {"ok": 1,
               "f": int(round(cur.get("temperature_2m"))) if cur.get("temperature_2m") is not None else -999,
               "feels": int(round(cur.get("apparent_temperature"))) if cur.get("apparent_temperature") is not None else -999,
               "code": int(cur.get("weather_code")) if cur.get("weather_code") is not None else -1,
               "day": int(cur.get("is_day", 1)),
               "hi": int(round(hi)) if hi is not None else -999,
               "lo": int(round(lo)) if lo is not None else -999}
        _last_temp[key] = res
        return res
    except Exception as e:
        logger.info(f"[feed] temp error: {e}")
        return _last_temp.get(key, out)


# ---------------------------------------------------------------------------
# Market indices card (optional; the app's "Market Indices" toggle adds
# &markets=1 to the feed). Keyless Yahoo chart API, browser UA, <=5s per
# symbol, cached 60s. Values are pre-formatted so the ESP32 only draws.
# ---------------------------------------------------------------------------
_MARKET_SYMBOLS = (("^GSPC", "S&P 500"), ("^DJI", "DOW 30"), ("^IXIC", "NASDAQ"))
_MARKET_TTL = 60
_MARKET_TIMEOUT = 5.0
_MARKET_SPARK_POINTS = 64
_market_cache: dict = {"exp": 0.0, "data": None}


def _spark(stamps, closes, prev, session_start, n=_MARKET_SPARK_POINTS,
           session_len=6.5 * 3600):
    """Place intraday closes on a fixed n-slot timeline for the regular
    session (9:30-16:00 ET), so the line fills left-to-right as the day
    goes on. Scaled 0-100 to the day's own range. Returns
    (points so far, baseline 0-100 or -1)."""
    pairs = [(t, c) for t, c in zip(stamps or [], closes or [])
             if isinstance(c, (int, float)) and t]
    if len(pairs) < 2:
        return [], -1
    start = session_start or pairs[0][0]
    pts, j, last = [], 0, None
    for k in range(n):
        slot_t = start + k * session_len / (n - 1)
        if slot_t > pairs[-1][0] + 300:
            break
        while j < len(pairs) and pairs[j][0] <= slot_t:
            last = pairs[j][1]
            j += 1
        pts.append(last if last is not None else pairs[0][1])
    if len(pts) < 2:
        pts = [pairs[0][1], pairs[-1][1]]
    lo, hi = min(pts), max(pts)
    span = (hi - lo) or 1.0
    scaled = [round((v - lo) / span * 100) for v in pts]
    # Baseline only when the prior close falls inside the day's range;
    # otherwise the 8px-tall line would flatten against it.
    base = round((prev - lo) / span * 100) if prev and lo <= prev <= hi else -1
    return scaled, base


def _market_status(meta, now=None) -> str:
    now = now or _time.time()
    tp = (meta or {}).get("currentTradingPeriod") or {}
    def inside(k):
        p = tp.get(k) or {}
        return p.get("start", 0) <= now < p.get("end", 0)
    if inside("regular"):
        # Holiday guard: a session with no fresh trade is not really open.
        last = (meta or {}).get("regularMarketTime") or 0
        return "OPEN" if now - last < 1800 else "CLOSED"
    if inside("pre"):
        return "PRE"
    if inside("post"):
        return "AFTER"
    return "CLOSED"


async def _fetch_index(cx, sym, label):
    r = await cx.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
                     params={"range": "1d", "interval": "5m"},
                     headers={"User-Agent": _BROWSER_UA}, timeout=_MARKET_TIMEOUT)
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    meta = res.get("meta") or {}
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    if price is None or not prev:
        raise ValueError("no price")
    chg = price - prev
    closes = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    stamps = res.get("timestamp") or []
    start = reg.get("start") if stamps and reg.get("start", 0) <= stamps[0] else None
    sp, base = _spark(stamps, closes, prev, start)
    return meta, {"n": label, "v": f"{price:,.2f}", "c": f"{chg:+,.2f}",
                  "p": round(chg / prev * 100, 2), "sp": sp, "b": base,
                  "spn": _MARKET_SPARK_POINTS}


async def _fetch_markets(cx):
    if _market_cache["data"] and _market_cache["exp"] > _time.time():
        return _market_cache["data"]
    results = await asyncio.gather(*[_fetch_index(cx, s, l) for s, l in _MARKET_SYMBOLS],
                                   return_exceptions=True)
    idx, status = [], "CLOSED"
    for i, res in enumerate(results):
        if isinstance(res, Exception):
            logger.info(f"[markets] {_MARKET_SYMBOLS[i][0]} failed: {type(res).__name__}")
            continue
        meta, row = res
        if not idx:
            status = _market_status(meta)
        idx.append(row)
    out = {"ok": 1 if idx else 0, "status": status, "idx": idx}
    if idx:
        _market_cache.update(exp=_time.time() + _MARKET_TTL, data=out)
    return out


@api_router.get("/markets")
async def markets():
    """Market indices as fed to the matrix (debug / app preview)."""
    return await _bounded("markets", _fetch_markets(_get_http()), _SOURCE_BUDGET, {"ok": 0})


@api_router.get("/matrix/feed")
async def matrix_feed(lat: float, lon: float, radius: int = 40,
                      team: str = "", severity: str = "severe",
                      flights: int = 1, sports: int = 1, weather: int = 1, ufc: int = 0,
                      markets: int = 0, track: str = ""):
    """One-shot aggregated feed for the LED matrix so the ESP32 makes a single
    small HTTPS call instead of 4+ heavy ones. Cached ~20s per param set."""
    track = _re.sub(r"[^A-Za-z0-9]", "", track or "").upper()[:10]
    key = f"{lat:.4f},{lon:.4f},{radius},{team},{severity},{flights}{sports}{weather}{ufc}{markets},{track}"
    hit = _feed_cache.get(key)
    if hit and hit[0] > _time.time():
        return hit[1]

    payload = {"flight": {"ok": 0}, "score": {"ok": 0}, "scores": [], "alert": {"ok": 0}, "temp": {"ok": 0}, "ufc": {"ok": 0}}
    # `team` may be a comma-separated list of "LEAGUE:ABBR" so we can return a
    # game for EVERY followed team (the matrix then cycles through them all).
    team_list = [t.strip() for t in (team or "").split(",") if t.strip()][:8]
    cx = _get_http()
    loc = f"{lat:.4f},{lon:.4f}"
    tasks = {}
    if flights:
        tasks["flight"] = _bounded(f"flight:{loc}:{radius}:{track}", _fetch_flight(cx, lat, lon, radius, track),
                                   _FLIGHT_BUDGET_TRACK if track else _FLIGHT_BUDGET, {"ok": 0})
    if weather:
        tasks["alert"] = _bounded(f"alert:{loc}:{severity}", _fetch_alert(cx, lat, lon, severity),
                                  _SOURCE_BUDGET, {"ok": 0})
    if ufc:
        tasks["ufc"] = _bounded("ufc", _fetch_ufc(cx), _SOURCE_BUDGET, {"ok": 0})
    if markets:
        tasks["markets"] = _bounded("markets", _fetch_markets(cx), _SOURCE_BUDGET, {"ok": 0})
    tasks["temp"] = _bounded(f"temp:{loc}", _fetch_temp(cx, lat, lon), _SOURCE_BUDGET, {"ok": 0})
    score_tasks = ([_bounded(f"score:{t}", _fetch_score(cx, t), _SOURCE_BUDGET, [])
                    for t in team_list] if sports else [])
    results = await asyncio.gather(*tasks.values(), *score_tasks, return_exceptions=True)
    n = len(tasks)
    for k, res in zip(tasks.keys(), results[:n]):
        payload[k] = res if isinstance(res, dict) else {"ok": 0}
    # Build the per-team scores list. `_fetch_score` now returns a LIST
    # per team (0-2 entries: live-only, or recent-final + upcoming-soon
    # together, or a single next-game fallback) — flatten them all,
    # capped to the firmware's fixed-size array (8).
    scores = []
    for t, res in zip(team_list, results[n:]):
        if isinstance(res, list):
            for g in res:
                if isinstance(g, dict) and g.get("ok") == 1:
                    scores.append({**g, "key": t})
    scores = scores[:8]
    payload["scores"] = scores
    payload["score"] = scores[0] if scores else {"ok": 0}

    _feed_cache[key] = (_time.time() + _FEED_TTL, payload)
    return payload



# ---------------------------------------------------------------------------
# Firmware OTA: host a compiled .bin + version so matrices self-update over
# Wi-Fi. The .bin is built in the user's PlatformIO (this env can't compile
# ESP32); they upload it here once, then every matrix pulls it automatically.
# ---------------------------------------------------------------------------
import json as _json
# Firmware is published as static files in backend/public/fw/ (served by the
# Vercel CDN at /fw/firmware.bin). The serverless filesystem is read-only, so
# uploads through the API are no longer possible — see public/fw/README.md.
_FW_DIR = ROOT_DIR / "public" / "fw"
_FW_BIN = _FW_DIR / "firmware.bin"
_FW_META = _FW_DIR / "meta.json"
_FW_URL = "/fw/firmware.bin"


def _fw_meta() -> dict:
    if _FW_META.exists():
        try:
            return _json.loads(_FW_META.read_text())
        except Exception:
            pass
    return {"version": "", "size": 0}


@api_router.post("/firmware/upload")
async def firmware_upload():
    """Retired: the deployment is read-only. Publish builds via git instead."""
    return JSONResponse(
        status_code=410,
        content={
            "ok": False,
            "detail": "Firmware upload is no longer supported. Commit the new "
                      "build to backend/public/fw/ (firmware.bin + meta.json) "
                      "and redeploy — see backend/public/fw/README.md.",
        },
    )


@api_router.get("/firmware/latest")
async def firmware_latest(current: str = ""):
    """Matrix polls this to learn the latest version. `update` is true when the
    hosted version differs from the caller's `current`."""
    m = _fw_meta()
    has = bool(m.get("version")) and _FW_BIN.exists()
    size = m.get("size", 0)
    if has and not size:
        size = _FW_BIN.stat().st_size
    return {
        "version": m.get("version", ""),
        "size": size,
        "available": has,
        "update": has and m.get("version", "") != (current or ""),
        "url": _FW_URL,
    }


@api_router.get("/firmware/download")
async def firmware_download():
    # Legacy path (older firmware falls back to it if `url` is missing).
    # Served directly (no redirect — ESP32 HTTPUpdate doesn't follow them).
    if not _FW_BIN.exists():
        raise HTTPException(status_code=404, detail="no firmware uploaded")
    return FileResponse(str(_FW_BIN), media_type="application/octet-stream",
                        filename="firmware.bin")


# Include the router in the main app
app.include_router(api_router)

# Health check endpoint for the deployment/orchestrator probe (no /api prefix).
@app.get("/health")
async def health():
    return {"status": "ok"}

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
