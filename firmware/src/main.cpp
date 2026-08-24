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
#include "Config.h"
#include "DisplayManager.h"
#include "BleProvisioning.h"
#include "DataServices.h"

// ---- Global definitions (declared extern in Config.h) ----------------------
AuraSettings   gSettings;
volatile bool  gWifiCredsChanged = false;
volatile bool  gConfigChanged    = false;
volatile bool  gFlashTest        = false;

// ---- Timing ----------------------------------------------------------------
static const uint32_t CARD_MS  = 8000;    // seconds per card
static const uint32_t FETCH_MS = 30000;   // refresh live data every 30s

static uint32_t lastCard = 0, lastFetch = 0;
static uint8_t  cardIndex = 0;

// Cached fetch results.
static Data::FlightInfo  gFlight;
static Data::ScoreInfo   gScore;
static Data::WeatherInfo gWeather;

static bool wifiConnect() {
  if (gSettings.wifiSsid.isEmpty()) return false;
  Display::message("WI-FI", gSettings.wifiSsid.c_str());
  WiFi.mode(WIFI_STA);
  WiFi.begin(gSettings.wifiSsid.c_str(), gSettings.wifiPass.c_str());
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

static uint16_t severityColor(const String& s) {
  if (s.equalsIgnoreCase("extreme"))  return Display::rgb(239, 68, 68);
  if (s.equalsIgnoreCase("severe"))   return Display::rgb(249, 115, 22);
  if (s.equalsIgnoreCase("moderate")) return Display::rgb(234, 179, 8);
  return Display::rgb(14, 165, 233);
}

static void refreshData() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (gSettings.flights.enabled)
    gFlight = Data::nearestFlight(gSettings.flights.lat, gSettings.flights.lon,
                                  gSettings.flights.radiusMi);

  if (gSettings.sports.enabled && gSettings.sports.count > 0) {
    // Rotate through followed teams one per refresh.
    static uint8_t ti = 0;
    ti = ti % gSettings.sports.count;
    String entry = gSettings.sports.teams[ti];  // "NFL:DAL"
    int colon = entry.indexOf(':');
    if (colon > 0)
      gScore = Data::teamGame(entry.substring(0, colon), entry.substring(colon + 1));
    ti++;
  }

  if (gSettings.weather.enabled)
    gWeather = Data::activeAlert(gSettings.flights.lat, gSettings.flights.lon,
                                 gSettings.weather.severity);
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
  if (n == 0) { Display::message("AURA", "waiting for data"); return; }

  uint8_t t = types[cardIndex % n];
  if (t == 0)      Display::flight(gFlight.callsign, gFlight.distanceMi, gFlight.airline);
  else if (t == 1) Display::score(gScore.home, gScore.hs, gScore.away, gScore.as, gScore.status);
}

void setup() {
  Serial.begin(115200);
  Display::begin();
  Display::boot();
  AuraBLE::begin();
  delay(1500);
}

void loop() {
  // Flash test (one-shot from the app).
  if (gFlashTest) { gFlashTest = false; Display::flashTest(); lastCard = 0; }

  // New Wi-Fi credentials -> (re)connect and report result to the app.
  if (gWifiCredsChanged) {
    gWifiCredsChanged = false;
    bool ok = wifiConnect();
    AuraBLE::notifyWifi(ok, ok ? WiFi.localIP().toString() : String(""));
    if (ok) { refreshData(); lastFetch = millis(); }
  }

  uint32_t now = millis();

  if (now - lastFetch >= FETCH_MS) { lastFetch = now; refreshData(); }

  if (now - lastCard >= CARD_MS) {
    lastCard = now;
    cardIndex++;
    drawCurrentCard();
  }

  delay(20);
}
