from fastapi import FastAPI, APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/app-icon.png")
async def app_icon():
    """Serve the current app icon so it can be saved on a phone and uploaded
    into the Android/iOS build 'App icon' field."""
    return FileResponse(ROOT_DIR / "app_icon.png", media_type="image/png")

@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

# ---------------------------------------------------------------------------
# Matrix feed proxy: the ESP32 makes ONE small HTTPS call here every 30s and we
# do all the heavy multi-source fetching server-side (reliable network, no bot
# blocks / rate-limit issues, off-day sports logic). Returns compact JSON.
# ---------------------------------------------------------------------------
import httpx
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
                         headers={"User-Agent": "AuraMatrix/1.0"})
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


async def _fetch_flight(cx, lat, lon, radius_mi):
    out = {"ok": 0}
    try:
        nm = max(1, int(radius_mi / 1.15078))
        url = f"https://api.adsb.lol/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{nm}"
        r = await cx.get(url, headers={"User-Agent": "AuraMatrix/1.0 (LED matrix flight display)"})
        if r.status_code != 200:
            return out
        ac = (r.json() or {}).get("ac") or []
        cands = []
        for a in ac:
            if a.get("lat") is None or a.get("lon") is None:
                continue
            cs = (a.get("flight") or "").strip()
            if not cs:
                continue
            d = _haversine_mi(lat, lon, a["lat"], a["lon"])
            alt = a.get("alt_baro")
            cands.append({
                "cs": cs, "dist": int(round(d)),
                "alt": int(alt) if isinstance(alt, (int, float)) else 0,
                "hdg": int(round(a.get("track"))) if isinstance(a.get("track"), (int, float)) else -1,
                "_d": d,
            })
        if not cands:
            return out
        cands.sort(key=lambda c: c["_d"])
        top = cands[:5]
        # Enrich each with airline name + route (parallel, best-effort).
        import asyncio
        routes = await asyncio.gather(*[_enrich_route(cx, c["cs"]) for c in top],
                                      return_exceptions=True)
        planes = []
        for c, rt in zip(top, routes):
            rt = rt if isinstance(rt, dict) else {}
            planes.append({"cs": c["cs"], "dist": c["dist"], "alt": c["alt"], "hdg": c["hdg"],
                           "airline": rt.get("airline", ""), "from": rt.get("from", ""),
                           "to": rt.get("to", "")})
        first = planes[0]
        return {"ok": 1, **first, "list": planes}
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
                        st_text = ev_dt.strftime("%-m/%-d %-I:%M %p UTC")
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
        url = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
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


@api_router.get("/matrix/feed")
async def matrix_feed(lat: float, lon: float, radius: int = 40,
                      team: str = "", severity: str = "severe",
                      flights: int = 1, sports: int = 1, weather: int = 1, ufc: int = 0):
    """One-shot aggregated feed for the LED matrix so the ESP32 makes a single
    small HTTPS call instead of 4+ heavy ones. Cached ~20s per param set."""
    key = f"{lat:.4f},{lon:.4f},{radius},{team},{severity},{flights}{sports}{weather}{ufc}"
    hit = _feed_cache.get(key)
    if hit and hit[0] > _time.time():
        return hit[1]

    payload = {"flight": {"ok": 0}, "score": {"ok": 0}, "scores": [], "alert": {"ok": 0}, "temp": {"ok": 0}, "ufc": {"ok": 0}}
    # `team` may be a comma-separated list of "LEAGUE:ABBR" so we can return a
    # game for EVERY followed team (the matrix then cycles through them all).
    team_list = [t.strip() for t in (team or "").split(",") if t.strip()][:8]
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as cx:
        import asyncio
        tasks = {}
        if flights:
            tasks["flight"] = _fetch_flight(cx, lat, lon, radius)
        if weather:
            tasks["alert"] = _fetch_alert(cx, lat, lon, severity)
        if ufc:
            tasks["ufc"] = _fetch_ufc(cx)
        tasks["temp"] = _fetch_temp(cx, lat, lon)
        score_tasks = [_fetch_score(cx, t) for t in team_list] if sports else []
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
_FW_DIR = ROOT_DIR / "fw_store"
_FW_DIR.mkdir(exist_ok=True)
_FW_BIN = _FW_DIR / "firmware.bin"
_FW_META = _FW_DIR / "meta.json"


def _fw_meta() -> dict:
    if _FW_META.exists():
        try:
            return _json.loads(_FW_META.read_text())
        except Exception:
            pass
    return {"version": "", "size": 0}


@api_router.post("/firmware/upload")
async def firmware_upload(version: str = Form(...), file: UploadFile = File(...)):
    """Upload a compiled firmware .bin + its version string (e.g. 1.2.0)."""
    data = await file.read()
    if not data or len(data) < 1000:
        raise HTTPException(status_code=400, detail="empty or invalid .bin")
    _FW_BIN.write_bytes(data)
    _FW_META.write_text(_json.dumps({"version": version.strip(), "size": len(data)}))
    logger.info(f"[ota] uploaded firmware v{version} ({len(data)} bytes)")
    return {"ok": True, "version": version.strip(), "size": len(data)}


@api_router.get("/firmware/latest")
async def firmware_latest(current: str = ""):
    """Matrix polls this to learn the latest version. `update` is true when the
    hosted version differs from the caller's `current`."""
    m = _fw_meta()
    has = bool(m.get("version")) and _FW_BIN.exists()
    return {
        "version": m.get("version", ""),
        "size": m.get("size", 0),
        "available": has,
        "update": has and m.get("version", "") != (current or ""),
        "url": "/api/firmware/download",
    }


@api_router.get("/firmware/download")
async def firmware_download():
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

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
