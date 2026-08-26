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
#include <time.h>
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

// ---- Timing ----------------------------------------------------------------
static const uint32_t CARD_MS  = 8000;    // seconds per card
static const uint32_t FETCH_MS = 30000;   // refresh live data every 30s

static uint32_t lastCard = 0, lastFetch = 0;
static uint8_t  cardIndex = 0;

// Cached fetch results.
static Data::FlightInfo  gFlight;
static Data::ScoreInfo   gScore;
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
  if (md >= 1227 || md <= 102)  return Display::rgb(245, 217, 10);  // New Year (gold)
  if (md >= 212 && md <= 215)   return Display::rgb(229, 72, 77);   // Valentine's
  if (md >= 315 && md <= 318)   return Display::rgb(48, 164, 108);  // St. Patrick's
  if (md >= 701 && md <= 705)   return Display::rgb(59, 130, 246);  // Independence
  if (md >= 1024 && md <= 1031) return Display::rgb(247, 107, 21);  // Halloween
  if (md >= 1120 && md <= 1130) return Display::rgb(247, 107, 21);  // Thanksgiving
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
  Display::setBrightness(b);
}

static uint16_t severityColor(const String& s) {
  if (s.equalsIgnoreCase("extreme"))  return Display::rgb(239, 68, 68);
  if (s.equalsIgnoreCase("severe"))   return Display::rgb(249, 115, 22);
  if (s.equalsIgnoreCase("moderate")) return Display::rgb(234, 179, 8);
  return Display::rgb(14, 165, 233);
}

static void refreshData() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (gSettings.flights.enabled) {
    if (gSettings.flights.trackFlight && !gSettings.flights.flightIdent.isEmpty()) {
      gFlight = Data::flightByCallsign(gSettings.flights.flightIdent,
                                       gSettings.flights.lat, gSettings.flights.lon);
      // Landing / descent detection for the tracked flight.
      static int prevAlt = -1;
      gEtaMin = -1;
      if (gFlight.ok && gFlight.altFt > 0) {
        if (prevAlt > 0 && prevAlt > gFlight.altFt) {
          int perMin = (prevAlt - gFlight.altFt) * 2; // ~30s fetch -> per-minute
          if (perMin > 50) {
            int eta = gFlight.altFt / perMin;
            gEtaMin = eta > 120 ? -1 : eta;
          }
        }
        if (gSettings.flights.landingAlert) {
          if (gFlight.altFt < 1200) gLandingFlash = 2;              // very low / landing
          else if (prevAlt > 0 && (prevAlt - gFlight.altFt) > 1500 &&
                   gFlight.altFt < 12000) gLandingFlash = 1;        // descending
        }
        prevAlt = gFlight.altFt;
      }
    } else {
      gFlight = Data::nearestFlight(gSettings.flights.lat, gSettings.flights.lon,
                                    gSettings.flights.radiusMi);
    }
  }

  if (gSettings.sports.enabled && gSettings.sports.count > 0) {
    // Rotate through followed teams one per refresh.
    static uint8_t ti = 0;
    ti = ti % gSettings.sports.count;
    String entry = gSettings.sports.teams[ti];  // "NFL:DAL"
    int colon = entry.indexOf(':');
    if (colon > 0)
      gScore = Data::teamGame(entry.substring(0, colon), entry.substring(colon + 1),
                              gSettings.sports.showStreak);
    gScoreKey = entry;
    ti++;
  }

  if (gSettings.weather.enabled)
    gWeather = Data::activeAlert(gSettings.flights.lat, gSettings.flights.lon,
                                 gSettings.weather.severity);

  if (gSettings.weather.showClock) {
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

static void drawCurrentCard() {
  // Weather alerts always take priority when active.
  if (gSettings.weather.enabled && gWeather.ok) {
    Display::weather(gWeather.headline, severityColor(gWeather.severity));
    return;
  }

  // Build the list of enabled cards and pick one by index.
  uint8_t types[3]; uint8_t n = 0;
  if (gSettings.flights.enabled && gFlight.ok) types[n++] = 0;
  if (gSettings.sports.enabled  && gScore.ok)  types[n++] = 1;
  if (gSettings.weather.showClock)             types[n++] = 2;
  if (n == 0) { Display::message("AURA", "waiting for data"); return; }

  uint8_t t = types[cardIndex % n];
  uint16_t accent = holidayAccent();
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
    Display::flight(gFlight.callsign, gFlight.distanceMi, gFlight.airline,
                    gFlight.altFt, gFlight.headingDeg, accent, gEtaMin);
    // Overlay the airline logo if one has been added to Logos.h.
    String icao = gFlight.callsign.substring(0, 3);
    const LogoAsset* lg = airlineLogo(icao);
    if (lg) Display::drawLogo(lg->data, lg->w, lg->h, MATRIX_W - lg->w - 2, 2);
  } else if (t == 1) {
    // Brighten border for a starred rivalry team, else use the holiday accent.
    uint16_t border = accent;
    for (uint8_t i = 0; i < gSettings.sports.rivalCount; i++)
      if (gSettings.sports.rivals[i] == gScoreKey) { border = Display::rgb(245, 158, 11); break; }
    Display::score(gScore.home, gScore.hs, gScore.away, gScore.as, gScore.status, border, gScore.streak);
    int colon = gScoreKey.indexOf(':');
    if (colon > 0) {
      const LogoAsset* lg = teamLogo(gScoreKey.substring(0, colon),
                                     gScoreKey.substring(colon + 1));
      if (lg) Display::drawLogo(lg->data, lg->w, lg->h, 2, 2);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Display::begin();
  Display::setBrightness(gSettings.brightness);
  Display::boot();
  AuraBLE::begin();
  delay(1500);
}

void loop() {
  // Flash test (one-shot from the app).
  if (gFlashTest) { gFlashTest = false; Display::flashTest(); lastCard = 0; }

  // Weather preview (one-shot from the app).
  if (gWeatherTest) {
    gWeatherTest = false;
    Display::weather("SEVERE THUNDERSTORM WARNING", Display::rgb(249, 115, 22));
    delay(4000);
    lastCard = 0;
  }

  // Tracked-flight landing / descent alert.
  if (gLandingFlash) {
    int mode = gLandingFlash;
    gLandingFlash = 0;
    for (int i = 0; i < 3; i++) {
      Display::landing(gFlight.callsign, mode == 2);
      delay(500);
      Display::clear(); Display::flip();
      delay(250);
    }
    Display::landing(gFlight.callsign, mode == 2);
    delay(2500);
    lastCard = 0;
  }

  // Apply any live config change (e.g. brightness / night schedule) immediately.
  if (gConfigChanged) {
    gConfigChanged = false;
    applyBrightnessForNow();
    lastCard = 0; // redraw on next tick
  }

  // New Wi-Fi credentials -> (re)connect and report result to the app.
  if (gWifiCredsChanged) {
    gWifiCredsChanged = false;
    bool ok = wifiConnect();
    AuraBLE::notifyWifi(ok, ok ? WiFi.localIP().toString() : String(""));
    if (ok) { applyBrightnessForNow(); refreshData(); lastFetch = millis(); }
  }

  uint32_t now = millis();

  if (now - lastFetch >= FETCH_MS) { lastFetch = now; refreshData(); }

  if (now - lastCard >= CARD_MS) {
    lastCard = now;
    cardIndex++;
    applyBrightnessForNow();   // re-evaluate the night schedule each card
    drawCurrentCard();
  }

  delay(20);
}
