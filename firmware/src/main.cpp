// ============================================================================
//  Aura Matrix — main.cpp
//  MatrixPortal ESP32-S3 driving a 128x64 HUB75 panel.
//
//  Flow:
//    1. Boot -> start HUB75 + BLE advertising ("AuraMatrix").
//    2. Aura phone app connects over BLE, sends Wi-Fi creds + display config.
//    3. Matrix joins Wi-Fi, notifies the app, then fetches live data itself:
//         flights (adsb.lol), scores (ESPN), weather alerts (NWS).
//    4. Cards rotate on the display; config updates apply live over BLE.
// ============================================================================
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPUpdate.h>
#include <Preferences.h>
#include <time.h>
#include <esp_heap_caps.h>
#include "Config.h"
#include "DisplayManager.h"
#include "BleProvisioning.h"
#include "DataServices.h"
#include "Logos.h"

// ---- Global definitions (declared extern in Config.h) ----------------------
AuraSettings   gSettings;
volatile bool  gWifiCredsChanged = false;
volatile bool  gConfigChanged    = false;
volatile bool  gFlashTest        = false;
volatile bool  gWeatherTest      = false;
volatile bool  gOtaRequested     = false;

// ---- Timing ----------------------------------------------------------------
static const uint32_t CARD_MS  = 8000;    // seconds per card
static const uint32_t ALERT_MS = 30000;   // weather-alert card dwell (scrolls)
static const uint32_t FETCH_MS = 30000;   // refresh live data every 30s

static uint32_t lastCard = 0, lastFetch = 0;
static uint8_t  cardIndex = 0;
static bool     gFirstCardShown = false; // true once any real card has rendered (gates the boot-time OTA check so it can't block the first render)

// Cached fetch results.
static Data::FlightInfo  gFlight;
static Data::FlightInfo  gFlightList[5];   // nearby planes (closest first)
static uint8_t           gFlightCount = 0;
static uint8_t           gFlightShown = 0; // rotating index for on-wall cycling
static int                gTrackedIdx = -1; // index of the tracked flight within gFlightList, -1 = not currently overhead
static String              gTrackedCallsign;  // callsign of the tracked flight when a landing alert fires
static Data::ScoreInfo   gScore;
static Data::ScoreInfo   gScoreList[8];   // one game per in-season followed team
static String            gScoreKeysArr[8];
static uint8_t           gScoreCount = 0;
static uint8_t           gScoreShown = 0; // rotating index for on-wall cycling
static Data::WeatherInfo gWeather;
static String            gScoreKey;   // "NFL:DAL" of the current score card
static int               gLandingFlash = 0; // 0 none, 1 descending, 2 landed
static int               gEtaMin = -1;      // rough arrival ETA for tracked flight
static int               gTempF = -999;     // current local temperature (°F)
static int               gFeelsF = -999;     // apparent ("feels like") temp (°F)
static int               gHiF = -999;        // today's high (°F)
static int               gLoF = -999;        // today's low (°F)
static int               gWxCode = -1;       // current weather code (open-meteo)
static int               gIsDay = 1;         // daylight flag (for sun/moon icon)

// Holiday accent color (RGB565) for the current date, or 0 for none/disabled.
static uint16_t holidayAccent() {
  if (!gSettings.holidayThemes) return 0;
  struct tm t;
  if (!getLocalTime(&t, 50)) return 0;
  int m = t.tm_mon + 1, d = t.tm_mday, md = m * 100 + d;
  if (md >= 1201 && md <= 1226) return Display::rgb(229, 72, 77);   // Winter (red)
  if (md >= 1227 || md <= 102)  return Display::rgb(200, 220, 255); // New Year (silver-blue, was gold)
  if (md >= 212 && md <= 215)   return Display::rgb(229, 72, 77);   // Valentine's
  if (md >= 315 && md <= 318)   return Display::rgb(48, 164, 108);  // St. Patrick's
  if (md >= 701 && md <= 705)   return Display::rgb(59, 130, 246);  // Independence
  if (md >= 1024 && md <= 1031) return Display::rgb(168, 85, 247);  // Halloween (purple, was orange)
  if (md >= 1120 && md <= 1130) return Display::rgb(219, 39, 119);  // Thanksgiving (deep red/magenta, was orange)
  return 0;
}

static bool wifiConnect() {
  if (gSettings.wifiSsid.isEmpty()) return false;
  Display::message("WI-FI", gSettings.wifiSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(gSettings.wifiSsid.c_str(), gSettings.wifiPass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) delay(250);
  if (WiFi.status() == WL_CONNECTED) {
    // Use the router's DHCP-provided DNS (calling WiFi.config() post-connect to
    // force public DNS proved unreliable — it can break the resolver, and some
    // routers block clients from using external DNS). The DNS cache in
    // DataServices keeps our query volume low so the router doesn't rate-limit.
    Serial.printf("[NET] ip=%s gw=%s dns=%s\n",
                  WiFi.localIP().toString().c_str(), WiFi.gatewayIP().toString().c_str(),
                  WiFi.dnsIP(0).toString().c_str());
    // NOTE: do NOT disable Wi-Fi modem sleep here — ESP-IDF *requires* modem
    // sleep to stay enabled when Wi-Fi and BLE run together (disabling it
    // aborts with "Should enable WiFi modem sleep..."). Coexistence airtime is
    // instead reclaimed by relaxing the BLE connection params (see
    // BleProvisioning ServerCallbacks) + retrying transient fetch failures.
    // NTP for the Night Dimming schedule. Change TZ_INFO to your timezone
    // (POSIX TZ string). Default is US Eastern.
    #ifndef TZ_INFO
    #define TZ_INFO "EST5EDT,M3.2.0,M11.1.0"
    #endif
    configTzTime(TZ_INFO, "pool.ntp.org", "time.nist.gov");
    return true;
  }
  return false;
}

// Is hour `h` inside the [start,end) night window (may wrap past midnight)?
static bool inNightWindow(int h, int start, int end) {
  if (start == end) return false;
  if (start < end)  return h >= start && h < end;
  return h >= start || h < end;
}

// Apply brightness, honoring the Night Dimming schedule if enabled.
static void applyBrightnessForNow() {
  int b = gSettings.brightness;
  if (gSettings.night.enabled) {
    struct tm t;
    if (getLocalTime(&t, 50)) {
      if (gSettings.night.useSunset) {
        // Dim from local sunset to sunrise; sun times cached per day.
        static int cachedYday = -1, srMin = -1, ssMin = -1;
        if (t.tm_yday != cachedYday || srMin < 0 || ssMin < 0) {
          Data::sunTimes(gSettings.flights.lat, gSettings.flights.lon, srMin, ssMin);
          if (srMin >= 0 && ssMin >= 0) cachedYday = t.tm_yday;
        }
        if (srMin >= 0 && ssMin >= 0) {
          int nowMin = t.tm_hour * 60 + t.tm_min;
          if (nowMin >= ssMin || nowMin < srMin) b = gSettings.night.dimLevel;
        }
      } else {
        int sh = gSettings.night.startHour;
        int eh = gSettings.night.endHour;
        int dl = gSettings.night.dimLevel;
        bool weekend = (t.tm_wday == 0 || t.tm_wday == 6); // Sun / Sat
        if (weekend && gSettings.night.weekend.enabled) {
          sh = gSettings.night.weekend.startHour;
          eh = gSettings.night.weekend.endHour;
          dl = gSettings.night.weekend.dimLevel;
        }
        if (inNightWindow(t.tm_hour, sh, eh)) b = dl;
      }
    }
  }
  static int lastLogged = -999;
  if (b != lastLogged) {
    struct tm tt; bool haveT = getLocalTime(&tt, 10);
    Serial.printf("[BRIGHT] base=%d night.en=%d sunset=%d applied=%d  time=%02d:%02d\n",
                  gSettings.brightness, gSettings.night.enabled, gSettings.night.useSunset,
                  b, haveT ? tt.tm_hour : -1, haveT ? tt.tm_min : -1);
    lastLogged = b;
  }
  Display::setBrightness(b);
}

static uint16_t severityColor(const String& s) {
  // Avoid orange/yellow (R+G mixed colors) — they're the ones that show the
  // color-split/bleed on this panel. Red -> magenta -> purple -> blue instead.
  if (s.equalsIgnoreCase("extreme"))  return Display::rgb(239, 68, 68);   // red
  if (s.equalsIgnoreCase("severe"))   return Display::rgb(219, 39, 119);  // magenta
  if (s.equalsIgnoreCase("moderate")) return Display::rgb(168, 85, 247);  // purple
  return Display::rgb(14, 165, 233);                                     // blue
}

// ---- Persisted settings (NVS) ----------------------------------------------
// Wi-Fi creds + full config are cached to flash so the matrix survives a
// power cut without needing the phone app to re-pair over BLE. Writes are
// debounced (gSettingsDirty) so rapid slider drags don't hammer the flash.
static Preferences gPrefs;
static bool         gSettingsDirty = false;
static uint32_t     gLastSaveMs = 0;

static void saveSettings() {
  JsonDocument doc;
  doc["ssid"] = gSettings.wifiSsid;
  doc["pass"] = gSettings.wifiPass;
  doc["server"] = gSettings.serverUrl;
  JsonObject f = doc["flights"].to<JsonObject>();
  f["enabled"] = gSettings.flights.enabled;
  f["lat"] = gSettings.flights.lat;
  f["lon"] = gSettings.flights.lon;
  f["radiusMi"] = gSettings.flights.radiusMi;
  f["trackFlight"] = gSettings.flights.trackFlight;
  f["flightIdent"] = gSettings.flights.flightIdent;
  f["landingAlert"] = gSettings.flights.landingAlert;
  JsonObject sp = doc["sports"].to<JsonObject>();
  sp["enabled"] = gSettings.sports.enabled;
  sp["ufc"] = gSettings.sports.ufc;
  sp["showStreak"] = gSettings.sports.showStreak;
  JsonArray teams = sp["teams"].to<JsonArray>();
  for (uint8_t i = 0; i < gSettings.sports.count; i++) teams.add(gSettings.sports.teams[i]);
  JsonArray rivals = sp["rivals"].to<JsonArray>();
  for (uint8_t i = 0; i < gSettings.sports.rivalCount; i++) rivals.add(gSettings.sports.rivals[i]);
  JsonObject w = doc["weather"].to<JsonObject>();
  w["enabled"] = gSettings.weather.enabled;
  w["severity"] = gSettings.weather.severity;
  w["showClock"] = gSettings.weather.showClock;
  w["showHiLo"] = gSettings.weather.showHiLo;
  w["showFeels"] = gSettings.weather.showFeels;
  w["showWxIcon"] = gSettings.weather.showWxIcon;
  JsonObject n = doc["night"].to<JsonObject>();
  n["enabled"] = gSettings.night.enabled;
  n["useSunset"] = gSettings.night.useSunset;
  n["startHour"] = gSettings.night.startHour;
  n["endHour"] = gSettings.night.endHour;
  n["dimLevel"] = gSettings.night.dimLevel;
  JsonObject nw = n["weekend"].to<JsonObject>();
  nw["enabled"] = gSettings.night.weekend.enabled;
  nw["startHour"] = gSettings.night.weekend.startHour;
  nw["endHour"] = gSettings.night.weekend.endHour;
  nw["dimLevel"] = gSettings.night.weekend.dimLevel;
  doc["brightness"] = gSettings.brightness;
  doc["holidayThemes"] = gSettings.holidayThemes;

  String out;
  serializeJson(doc, out);
  gPrefs.begin("aura", false);
  gPrefs.putString("cfg", out);
  gPrefs.end();
  Serial.printf("[NVS] saved config (%d bytes)\n", (int)out.length());
}

// Returns true if a saved config was found and applied to gSettings.
static bool loadSettings() {
  gPrefs.begin("aura", true);
  String raw = gPrefs.getString("cfg", "");
  gPrefs.end();
  if (raw.isEmpty()) return false;
  JsonDocument doc;
  if (deserializeJson(doc, raw)) return false;

  gSettings.wifiSsid  = String((const char*)(doc["ssid"] | ""));
  gSettings.wifiPass  = String((const char*)(doc["pass"] | ""));
  gSettings.serverUrl = String((const char*)(doc["server"] | ""));

  JsonObjectConst f = doc["flights"];
  if (!f.isNull()) {
    gSettings.flights.enabled      = f["enabled"] | true;
    gSettings.flights.lat          = f["lat"] | 0.0;
    gSettings.flights.lon          = f["lon"] | 0.0;
    gSettings.flights.radiusMi     = f["radiusMi"] | 25;
    gSettings.flights.trackFlight  = f["trackFlight"] | false;
    gSettings.flights.flightIdent  = String((const char*)(f["flightIdent"] | ""));
    gSettings.flights.landingAlert = f["landingAlert"] | true;
  }
  JsonObjectConst sp = doc["sports"];
  if (!sp.isNull()) {
    gSettings.sports.enabled    = sp["enabled"] | true;
    gSettings.sports.ufc        = sp["ufc"] | false;
    gSettings.sports.showStreak = sp["showStreak"] | false;
    uint8_t n = 0;
    for (JsonVariantConst v : sp["teams"].as<JsonArrayConst>()) {
      if (n >= MAX_TEAMS) break;
      gSettings.sports.teams[n++] = String((const char*)v);
    }
    gSettings.sports.count = n;
    n = 0;
    for (JsonVariantConst v : sp["rivals"].as<JsonArrayConst>()) {
      if (n >= MAX_TEAMS) break;
      gSettings.sports.rivals[n++] = String((const char*)v);
    }
    gSettings.sports.rivalCount = n;
  }
  JsonObjectConst w = doc["weather"];
  if (!w.isNull()) {
    gSettings.weather.enabled   = w["enabled"] | true;
    gSettings.weather.severity  = String((const char*)(w["severity"] | "severe"));
    gSettings.weather.showClock = w["showClock"] | false;
    gSettings.weather.showHiLo  = w["showHiLo"] | false;
    gSettings.weather.showFeels = w["showFeels"] | false;
    gSettings.weather.showWxIcon= w["showWxIcon"] | false;
  }
  JsonObjectConst n = doc["night"];
  if (!n.isNull()) {
    gSettings.night.enabled   = n["enabled"] | false;
    gSettings.night.useSunset = n["useSunset"] | false;
    gSettings.night.startHour = n["startHour"] | 22;
    gSettings.night.endHour   = n["endHour"] | 7;
    gSettings.night.dimLevel  = n["dimLevel"] | 20;
    JsonObjectConst nw = n["weekend"];
    if (!nw.isNull()) {
      gSettings.night.weekend.enabled   = nw["enabled"] | false;
      gSettings.night.weekend.startHour = nw["startHour"] | 23;
      gSettings.night.weekend.endHour   = nw["endHour"] | 8;
      gSettings.night.weekend.dimLevel  = nw["dimLevel"] | 20;
    }
  }
  gSettings.brightness   = doc["brightness"] | 80;
  gSettings.holidayThemes= doc["holidayThemes"] | true;
  return true;
}

// ---- Over-the-air firmware update -----------------------------------------
// Checks the backend for a newer firmware .bin and, if found, downloads + flashes
// it over Wi-Fi (no USB cable). Called once after Wi-Fi connects and on demand
// via the BLE "ota" command.

// Parses "X.Y.Z" into three ints for comparison (missing/short parts = 0).
static void parseVersion(const String& v, int out[3]) {
  out[0] = out[1] = out[2] = 0;
  int idx = 0, start = 0;
  for (uint32_t i = 0; i <= v.length() && idx < 3; i++) {
    if (i == v.length() || v[i] == '.') {
      if (i > (uint32_t)start) out[idx] = v.substring(start, i).toInt();
      idx++;
      start = i + 1;
    }
  }
}

// True only if `server` is a strictly HIGHER version than `current`. Guards
// against re-flashing forever when the backend's stored .bin is stale or was
// uploaded with a mismatched version label (the string just won't equal
// AURA_FW_VERSION, which used to be treated as "always update").
static bool isNewerVersion(const String& server, const String& current) {
  int s[3], c[3];
  parseVersion(server, s);
  parseVersion(current, c);
  for (int i = 0; i < 3; i++) {
    if (s[i] != c[i]) return s[i] > c[i];
  }
  return false; // equal
}

static void otaCheck() {
  if (gSettings.serverUrl.isEmpty() || WiFi.status() != WL_CONNECTED) return;
  String base = gSettings.serverUrl;
  if (base.endsWith("/")) base.remove(base.length() - 1);
  String body = Data::httpGet(base + "/api/firmware/latest?current=" AURA_FW_VERSION, "AuraMatrix/1.0");
  if (body.isEmpty()) return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;
  if (!(doc["update"] | false)) { Serial.println("[OTA] up to date"); return; }

  String ver = String((const char*)(doc["version"] | ""));
  if (!isNewerVersion(ver, AURA_FW_VERSION)) {
    Serial.printf("[OTA] server has v%s, not newer than running v%s -> skipping "
                  "(stale or mislabeled upload)\n", ver.c_str(), AURA_FW_VERSION);
    return;
  }
  String url = base + String((const char*)(doc["url"] | "/api/firmware/download"));
  Serial.printf("[OTA] new firmware v%s -> installing from %s\n", ver.c_str(), url.c_str());
  Display::message("UPDATE", ("v" + ver).c_str());
  delay(800);

  WiFiClientSecure client;
  client.setInsecure();
  httpUpdate.rebootOnUpdate(true);   // auto-reboot into the new firmware
  t_httpUpdate_return ret = httpUpdate.update(client, url);
  if (ret == HTTP_UPDATE_FAILED) {
    Serial.printf("[OTA] FAILED (%d): %s\n", httpUpdate.getLastError(),
                  httpUpdate.getLastErrorString().c_str());
    Display::message("UPDATE", "failed");
    delay(1500);
  }
}

static void refreshData() {
  if (WiFi.status() != WL_CONNECTED) return;

  bool wantTrack = gSettings.flights.trackFlight && !gSettings.flights.flightIdent.isEmpty();
  bool proxyFlight = false, proxyWeather = false, proxyTemp = false, proxyScore = false;

  // Send ALL followed teams (comma-joined) so the server returns a game for
  // each one and the matrix can cycle through every team that's playing.
  String entry;
  if (gSettings.sports.enabled && gSettings.sports.count > 0) {
    for (uint8_t i = 0; i < gSettings.sports.count; i++) {
      if (entry.length()) entry += ",";
      entry += gSettings.sports.teams[i];   // e.g. "MLB:NYY,NFL:BAL"
    }
  }

  // If the app gave us a backend URL, fetch flight + sports + weather + temp in
  // ONE reliable call (server does the heavy lifting, bypasses ESPN's datacenter
  // block via site.web.api.espn.com, and dodges adsb rate-limits). Always fetch
  // the full nearby-planes list (even in "track a flight" mode) so a tracked
  // flight is found by matching its callsign in that list, instead of a
  // separate direct call that goes blank whenever adsb.lol 403s/has no data
  // for that one flight (e.g. cancelled).
  if (!gSettings.serverUrl.isEmpty()) {
    Data::FeedResult fr = Data::matrixFeed(
        gSettings.serverUrl, gSettings.flights.lat, gSettings.flights.lon,
        gSettings.flights.radiusMi, gSettings.weather.severity,
        gSettings.flights.enabled, gSettings.weather.enabled,
        entry, gSettings.sports.enabled && entry.length() > 0);
    if (fr.ok) {
      if (gSettings.flights.enabled) {
        gFlight = fr.flight; proxyFlight = true;
        gFlightCount = fr.planeCount;
        for (uint8_t i = 0; i < fr.planeCount; i++) gFlightList[i] = fr.planes[i];
        if (gFlightShown >= gFlightCount) gFlightShown = 0;
      }
      if (gSettings.weather.enabled) { gWeather = fr.alert; proxyWeather = true; }
      if (entry.length() > 0 && fr.scoreCount > 0) {
        gScoreCount = fr.scoreCount;
        for (uint8_t i = 0; i < fr.scoreCount; i++) {
          gScoreList[i] = fr.scores[i];
          gScoreKeysArr[i] = fr.scoreKeys[i];
        }
        if (gScoreShown >= gScoreCount) gScoreShown = 0;
        gScore = fr.scores[0]; gScoreKey = fr.scoreKeys[0]; proxyScore = true;
      }
      if (fr.haveTemp) {
        gTempF  = fr.tempF;
        gFeelsF = gSettings.weather.showFeels ? fr.feelsF : -999;
        gWxCode = gSettings.weather.showWxIcon ? fr.wxCode : -1;
        gIsDay  = fr.isDay;
        gHiF    = gSettings.weather.showHiLo ? fr.hiF : -999;
        gLoF    = gSettings.weather.showHiLo ? fr.loF : -999;
        proxyTemp = true;
      }
    }
  }

  // No backend proxy configured -> fetch the nearby list directly.
  if (gSettings.flights.enabled && !proxyFlight) {
    gFlight = Data::nearestFlight(gSettings.flights.lat, gSettings.flights.lon,
                                  gSettings.flights.radiusMi);
    gFlightCount = gFlight.ok ? 1 : 0;
    if (gFlightCount) gFlightList[0] = gFlight;
    gFlightShown = 0;
  }

  // If tracking a specific flight, find it inside the nearby list (rather than
  // a separate direct lookup). When found it's highlighted in the normal
  // cycle; when not (cancelled, landed, out of range) the overhead traffic
  // still shows instead of leaving the whole flight card blank.
  gTrackedIdx = -1;
  static int prevTrackedAlt = -1;
  if (wantTrack) {
    String want = gSettings.flights.flightIdent; want.trim(); want.toUpperCase();
    for (uint8_t i = 0; i < gFlightCount; i++) {
      String cs = gFlightList[i].callsign; cs.trim(); cs.toUpperCase();
      if (cs == want) { gTrackedIdx = i; break; }
    }
    gEtaMin = -1;
    if (gTrackedIdx >= 0) {
      int alt = gFlightList[gTrackedIdx].altFt;
      if (alt > 0) {
        if (prevTrackedAlt > 0 && prevTrackedAlt > alt) {
          int perMin = (prevTrackedAlt - alt) * 2; // ~30s fetch -> per-minute
          if (perMin > 50) {
            int eta = alt / perMin;
            gEtaMin = eta > 120 ? -1 : eta;
          }
        }
        if (gSettings.flights.landingAlert) {
          if (alt < 1200) { gLandingFlash = 2; gTrackedCallsign = gFlightList[gTrackedIdx].callsign; }          // very low / landing
          else if (prevTrackedAlt > 0 && (prevTrackedAlt - alt) > 1500 &&
                   alt < 12000) { gLandingFlash = 1; gTrackedCallsign = gFlightList[gTrackedIdx].callsign; }    // descending
        }
        prevTrackedAlt = alt;
      }
    } else {
      prevTrackedAlt = -1; // reset so a stale altitude doesn't fake a landing later
    }
  }

  // Direct ESPN fetch only as a fallback (no server URL, or proxy had no
  // score). Fetches just the FIRST team to stay light on the ESP32.
  if (gSettings.sports.enabled && gSettings.sports.count > 0 && !proxyScore) {
    String first = gSettings.sports.teams[0];
    int colon = first.indexOf(':');
    if (colon > 0) {
      gScore = Data::teamGame(first.substring(0, colon), first.substring(colon + 1),
                              gSettings.sports.showStreak);
      gScoreKey = first;
      gScoreCount = gScore.ok ? 1 : 0;
      if (gScoreCount) { gScoreList[0] = gScore; gScoreKeysArr[0] = first; }
      gScoreShown = 0;
    }
  }

  if (gSettings.weather.enabled && !proxyWeather)
    gWeather = Data::activeAlert(gSettings.flights.lat, gSettings.flights.lon,
                                 gSettings.weather.severity);

  // Fetch temp when the clock is enabled, OR when nothing else has data (so the
  // fallback clock still shows the temperature instead of an empty panel).
  bool anyOther = (gSettings.weather.enabled && gWeather.ok) ||
                  (gSettings.flights.enabled && gFlightCount > 0) ||
                  (gSettings.sports.enabled && gScore.ok);
  if ((gSettings.weather.showClock || !anyOther) && !proxyTemp) {
    int feels = -999, code = -1, isDay = 1;
    gTempF = Data::currentTempF(gSettings.flights.lat, gSettings.flights.lon,
                                gSettings.weather.showFeels ? &feels : nullptr,
                                gSettings.weather.showWxIcon ? &code : nullptr,
                                gSettings.weather.showWxIcon ? &isDay : nullptr);
    gFeelsF = gSettings.weather.showFeels ? feels : -999;
    gWxCode = gSettings.weather.showWxIcon ? code : -1;
    gIsDay = isDay;
    if (gSettings.weather.showHiLo)
      Data::dailyHiLo(gSettings.flights.lat, gSettings.flights.lon, gHiF, gLoF);
    else { gHiF = -999; gLoF = -999; }
  }
}

// Draw a single card of the given type: 0=flight, 1=sports, 2=clock, 3=alert.
static void drawCard(uint8_t t) {
  uint16_t accent = holidayAccent();
  if (t == 3) {
    // Initial alert frame; the marquee scroll is animated from loop().
    Display::weatherScroll(gWeather.headline, severityColor(gWeather.severity), 0);
    return;
  }
  if (t == 2) {
    struct tm tmv;
    String ts = "--:--";
    if (getLocalTime(&tmv, 50)) {
      int hr = tmv.tm_hour % 12; if (hr == 0) hr = 12;
      char b[8]; snprintf(b, sizeof(b), "%d:%02d", hr, tmv.tm_min);
      ts = b;
    }
    Display::clock(ts, gTempF, accent,
                   gSettings.weather.showHiLo ? gHiF : -999,
                   gSettings.weather.showHiLo ? gLoF : -999,
                   gSettings.weather.showFeels ? gFeelsF : -999,
                   gSettings.weather.showWxIcon ? gWxCode : -1,
                   gIsDay != 0);
    return;
  }
  if (t == 0) {
    // Cycle through nearby planes: show the next one each time the flight card
    // comes up (mirrors the app's Overhead card). If a specific flight is
    // being tracked and it's currently among the nearby planes, highlight it
    // (green border + label) instead of hiding the rest of the traffic.
    Data::FlightInfo* fp = &gFlight;
    int shownIdx = -1;
    if (gFlightCount > 1) {
      gFlightShown = gFlightShown % gFlightCount;
      shownIdx = gFlightShown;
      fp = &gFlightList[gFlightShown];
      gFlightShown++;
    } else if (gFlightCount == 1) {
      fp = &gFlightList[0]; shownIdx = 0;
    }
    bool tracked = (gTrackedIdx >= 0 && shownIdx == gTrackedIdx);
    uint16_t cardAccent = tracked ? Display::rgb(16, 185, 129) : accent;
    Display::flight(fp->callsign, fp->distanceMi, fp->airline,
                    fp->altFt, fp->headingDeg, cardAccent, tracked ? gEtaMin : -1,
                    fp->origin, fp->dest, tracked);
    // Bitmap logo overlay disabled: on this panel, dense multi-color logo
    // bitmaps rendered with missing/wrong red (confirmed persisting across
    // two different draw-path fixes — drawRGBBitmap AND per-pixel
    // drawPixel), and some source logos (e.g. JetBlue's solid-background
    // wordmark) didn't downscale legibly at 24x24 either way. The callsign/
    // airline text already carries all the info cleanly, so we're keeping
    // cards text-only rather than shipping a logo that renders wrong.
    // String icao = fp->callsign.substring(0, 3);
    // const LogoAsset* lg = airlineLogo(icao);
    // if (lg) Display::drawLogo(lg->data, lg->w, lg->h, MATRIX_W - lg->w - 2, 2);
  } else if (t == 1) {
    // Cycle through every followed team's game, one each time the sports card
    // comes up (mirrors the flight card + the app).
    if (gScoreCount > 1) gScoreShown = gScoreShown % gScoreCount;
    else gScoreShown = 0;
    Data::ScoreInfo& s = (gScoreCount > 0) ? gScoreList[gScoreShown] : gScore;
    String key = (gScoreCount > 0) ? gScoreKeysArr[gScoreShown] : gScoreKey;
    // Brighten border for a starred rivalry team, else use the holiday accent.
    uint16_t border = accent;
    for (uint8_t i = 0; i < gSettings.sports.rivalCount; i++)
      if (gSettings.sports.rivals[i] == key) { border = Display::rgb(56, 189, 248); break; }
    Display::score(s.home, s.hs, s.away, s.as, s.status, border, s.streak, s.isRecord, s.record);
    // Team logo overlay disabled — same red-rendering issue as the airline
    // logo above (see comment there). Team abbreviation text already shown
    // by Display::score() above.
    // int colon = key.indexOf(':');
    // if (colon > 0) {
    //   const LogoAsset* lg = teamLogo(key.substring(0, colon), key.substring(colon + 1));
    //   if (lg) Display::drawLogo(lg->data, lg->w, lg->h, 2, 2);
    // }
    if (gScoreCount > 1) gScoreShown++;
  }
}

// Build the current rotation of enabled cards (alert leads when active).
static uint8_t buildSeq(uint8_t* seq) {
  uint8_t n = 0;
  if (gSettings.weather.enabled && gWeather.ok)  seq[n++] = 3; // alert (30s, scrolls)
  if (gSettings.flights.enabled && gFlightCount > 0) seq[n++] = 0;
  if (gSettings.sports.enabled  && gScoreCount > 0) seq[n++] = 1;
  // Clock shows when enabled OR as a fallback so the panel is never blank.
  if (gSettings.weather.showClock || n == 0)     seq[n++] = 2;
  return n;
}

void setup() {
  Serial.begin(115200);
  // Route large heap allocations (e.g. the ~16KB mbedTLS/HTTPS buffers) into
  // PSRAM so internal RAM stays free. This lets Wi-Fi + BLE + HTTPS all run at
  // once, so Bluetooth can stay connected while the matrix fetches data.
  heap_caps_malloc_extmem_enable(4096);
  Serial.printf("[MEM] internal free=%u  total heap=%u  psram free=%u\n",
                heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                ESP.getFreeHeap(), ESP.getFreePsram());
  // Start BLE advertising FIRST so the phone app can always connect, even if
  // the HUB75 panel init below ever stalls. Provisioning must never depend on
  // the display coming up cleanly.
  AuraBLE::begin();
  Serial.println("[BLE] advertising as AuraMatrix");
  Display::begin();
  Display::setBrightness(gSettings.brightness);
  Display::boot();
  Serial.println("[DISP] panel init done");
  delay(1500);

  // Auto-reconnect using settings saved from the last successful session, so
  // the matrix keeps working after a power cut without needing the phone app
  // to re-pair over BLE and resend Wi-Fi credentials.
  if (loadSettings()) {
    Serial.println("[NVS] restored saved settings");
    if (!gSettings.wifiSsid.isEmpty()) {
      Display::message("AURA", "reconnecting...", Display::rgb(245, 158, 11));
      bool ok = wifiConnect();
      AuraBLE::notifyWifi(ok, ok ? WiFi.localIP().toString() : String(""));
      if (ok) {
        // Don't block setup() with the data fetch (sun-times + matrix feed +
        // OTA check can chain into a multi-minute wait if the network is
        // having a genuinely bad stretch — DNS/TLS failing repeatedly across
        // every host, not just the usual one-retry-and-it's-fine hiccup).
        // Show a quick "loading" message, then let loop()'s normal fetch
        // timer + "waiting for data" fallback handle it — that keeps the
        // board responsive (BLE, card rotation, brightness) the whole time
        // instead of looking frozen on a single static message.
        Display::message("AURA", "loading data...", Display::rgb(245, 158, 11));
        lastFetch = millis() - FETCH_MS + 1000;   // fetch ~1s into the main loop
      }
    }
  } else {
    Serial.println("[NVS] no saved settings yet");
  }
}

void loop() {
  // Flash test (one-shot from the app).
  if (gFlashTest) { gFlashTest = false; Display::flashTest(); lastCard = 0; }

  // OTA firmware update (one-shot from the app's "Install update" button).
  if (gOtaRequested) { gOtaRequested = false; otaCheck(); lastCard = 0; }

  // Weather preview (one-shot from the app).
  if (gWeatherTest) {
    gWeatherTest = false;
    Display::weather("SEVERE THUNDERSTORM WARNING", Display::rgb(219, 39, 119));
    delay(4000);
    lastCard = 0;
  }

  // Tracked-flight landing / descent alert.
  if (gLandingFlash) {
    int mode = gLandingFlash;
    gLandingFlash = 0;
    for (int i = 0; i < 3; i++) {
      Display::landing(gTrackedCallsign, mode == 2);
      delay(500);
      Display::clear(); Display::flip();
      delay(250);
    }
    Display::landing(gTrackedCallsign, mode == 2);
    delay(2500);
    lastCard = 0;
  }

  // Apply any live config change (e.g. brightness / night schedule) immediately.
  if (gConfigChanged) {
    gConfigChanged = false;
    applyBrightnessForNow();
    gSettingsDirty = true;   // flush to flash (debounced below)
    lastCard = 0; // redraw on next tick
  }

  // New Wi-Fi credentials -> (re)connect and report result to the app.
  if (gWifiCredsChanged) {
    gWifiCredsChanged = false;
    bool ok = wifiConnect();
    AuraBLE::notifyWifi(ok, ok ? WiFi.localIP().toString() : String(""));
    // Save the new credentials to flash RIGHT NOW instead of letting the
    // usual 4s-debounced flush (below) handle it. Previously this branch
    // went straight into a synchronous refreshData() — which, on a flaky
    // network, can chain into a minute-plus of retried HTTPS calls (see the
    // [GET] retry logging) — with the *actual* NVS write only happening
    // after that returned. If the board got power-cycled during that
    // window (very plausible right after a fresh "it joined!" moment), the
    // Wi-Fi password never made it to flash: exactly the "doesn't remember
    // my Wi-Fi password after a restart" symptom.
    saveSettings();
    gLastSaveMs = millis();
    gSettingsDirty = false;
    if (ok) {
      // Don't block here with a synchronous refreshData() either — same
      // fix as the async-boot change in v1.6.1: show "loading data...",
      // then let loop()'s normal fetch timer + fallback message pick it up
      // so BLE stays responsive (and can ack further app commands quickly)
      // even if the network is having a bad stretch right after joining.
      Display::message("AURA", "loading data...", Display::rgb(245, 158, 11));
      lastFetch = millis() - FETCH_MS + 1000;
    }
  }

  uint32_t now = millis();

  // Flush settings to flash a few seconds after the last change, so quick
  // successive edits (e.g. dragging a slider) don't hammer the flash.
  if (gSettingsDirty && now - gLastSaveMs > 4000) {
    gLastSaveMs = now;
    gSettingsDirty = false;
    saveSettings();
  }

  // Auto OTA check once after the panel has shown real data (so a slow/flaky
  // first connection can't block the very first card from ever rendering —
  // this check alone can take 30s+ when the fresh Wi-Fi/TLS session needs a
  // couple of retries, see [GET] retry comments above).
  static bool otaBootChecked = false;
  if (!otaBootChecked && gFirstCardShown && now > 15000 && WiFi.status() == WL_CONNECTED &&
      !gSettings.serverUrl.isEmpty()) {
    otaBootChecked = true;
    otaCheck();
    lastCard = 0;
  }

  if (now - lastFetch >= FETCH_MS) { lastFetch = now; refreshData(); }

  static int alertScrollX = 0;
  static uint32_t lastScroll = 0;

  uint8_t seq[4];
  uint8_t n = buildSeq(seq);
  static int lastN = -1;
  if ((int)n != lastN) {
    Serial.printf("[CARD] n=%d  wxAlert=%d flight=%d score=%d clock=%d\n", n,
                  (gSettings.weather.enabled && gWeather.ok),
                  (gSettings.flights.enabled && gFlightCount > 0),
                  (gSettings.sports.enabled && gScoreCount > 0),
                  gSettings.weather.showClock);
    lastN = n;
  }

  if (n == 0) {
    if (now - lastCard >= CARD_MS) { lastCard = now; Display::message("AURA", "waiting for data", Display::rgb(245, 158, 11)); }
    delay(20);
    return;
  }

  uint8_t cur = seq[cardIndex % n];
  uint32_t dwell = (cur == 3) ? ALERT_MS : CARD_MS;

  // Advance to the next card once its dwell time elapses.
  if (now - lastCard >= dwell) {
    lastCard = now;
    cardIndex++;
    cur = seq[cardIndex % n];
    alertScrollX = 0;              // fresh marquee each time the alert comes up
    applyBrightnessForNow();       // re-evaluate the night schedule each card
    drawCard(cur);
    gFirstCardShown = true;
  }

  // While the alert card is showing, keep scrolling the headline.
  if (cur == 3 && now - lastScroll >= 40) {
    lastScroll = now;
    Display::weatherScroll(gWeather.headline, severityColor(gWeather.severity), alertScrollX);
    int textW = (int)gWeather.headline.length() * 6;
    alertScrollX += 2;                                  // scroll speed (px/frame)
    if (alertScrollX > textW + MATRIX_W) alertScrollX = 0;
  }

  delay(20);
}
