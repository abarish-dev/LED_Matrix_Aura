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


async def _fetch_flight(cx, lat, lon, radius_mi):
    out = {"ok": 0}
    try:
        nm = max(1, int(radius_mi / 1.15078))
        url = f"https://api.adsb.lol/v2/lat/{lat:.4f}/lon/{lon:.4f}/dist/{nm}"
        r = await cx.get(url, headers={"User-Agent": "AuraMatrix/1.0 (LED matrix flight display)"})
        if r.status_code != 200:
            return out
        ac = (r.json() or {}).get("ac") or []
        best, bd = None, 1e9
        for a in ac:
            if a.get("lat") is None or a.get("lon") is None:
                continue
            d = _haversine_mi(lat, lon, a["lat"], a["lon"])
            if d < bd:
                bd, best = d, a
        if not best:
            return out
        cs = (best.get("flight") or "").strip()
        alt = best.get("alt_baro")
        return {"ok": 1, "cs": cs, "dist": int(round(bd)),
                "alt": int(alt) if isinstance(alt, (int, float)) else 0,
                "hdg": int(round(best.get("track"))) if isinstance(best.get("track"), (int, float)) else -1}
    except Exception as e:
        logger.info(f"[feed] flight error: {e}")
        return out


async def _fetch_score(cx, team):
    out = {"ok": 0}
    try:
        league, _, abbr = team.partition(":")
        path = _ESPN_PATHS.get(league.upper())
        if not path or not abbr:
            return out
        now = datetime.now(timezone.utc)
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
                return out
        events = (r.json() or {}).get("events") or []
        chosen, best_delta = None, 1e18
        now_ts = now.timestamp()
        for ev in events:
            comp = (ev.get("competitions") or [{}])[0]
            comps = comp.get("competitors") or []
            if not any((c.get("team") or {}).get("abbreviation", "").upper() == abbr.upper() for c in comps):
                continue
            try:
                ets = datetime.fromisoformat(ev.get("date", "").replace("Z", "+00:00")).timestamp()
            except Exception:
                ets = now_ts
            state = ((comp.get("status") or {}).get("type") or {}).get("state")
            delta = 0 if state == "in" else abs(ets - now_ts)
            if delta < best_delta:
                best_delta, chosen = delta, (comp, comps)
        if not chosen:
            return out
        comp, comps = chosen
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
    except Exception as e:
        logger.info(f"[feed] score error: {e}")
        return out


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
                      flights: int = 1, sports: int = 1, weather: int = 1):
    """One-shot aggregated feed for the LED matrix so the ESP32 makes a single
    small HTTPS call instead of 4+ heavy ones. Cached ~20s per param set."""
    key = f"{lat:.4f},{lon:.4f},{radius},{team},{severity},{flights}{sports}{weather}"
    hit = _feed_cache.get(key)
    if hit and hit[0] > _time.time():
        return hit[1]

    payload = {"flight": {"ok": 0}, "score": {"ok": 0}, "alert": {"ok": 0}, "temp": {"ok": 0}}
    async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as cx:
        import asyncio
        tasks = {}
        if flights:
            tasks["flight"] = _fetch_flight(cx, lat, lon, radius)
        if sports and team:
            tasks["score"] = _fetch_score(cx, team)
        if weather:
            tasks["alert"] = _fetch_alert(cx, lat, lon, severity)
        tasks["temp"] = _fetch_temp(cx, lat, lon)
        results = await asyncio.gather(*tasks.values(), return_exceptions=True)
        for k, res in zip(tasks.keys(), results):
            payload[k] = res if isinstance(res, dict) else {"ok": 0}

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
