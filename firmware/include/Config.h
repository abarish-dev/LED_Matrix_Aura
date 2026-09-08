// ============================================================================
//  Config.h — shared settings struct + globals for Aura Matrix.
// ============================================================================
#pragma once
#include <Arduino.h>

// ---- Panel geometry --------------------------------------------------------
// A 128x64 wall is usually two 64x64 HUB75 modules chained left-to-right.
// If you use a single native 128x64 module, set PANEL_RES_X 128 / CHAIN 1.
#define PANEL_RES_X   128     // width of ONE module (single native 128x64)
#define PANEL_RES_Y   64      // height of ONE module
#define PANEL_CHAIN   1       // number of chained modules  -> total 128x64

#define MATRIX_W      (PANEL_RES_X * PANEL_CHAIN)   // 128
#define MATRIX_H      (PANEL_RES_Y)                 // 64

// ---- BLE contract (must match the Aura app) --------------------------------
#define AURA_DEVICE_NAME   "AuraMatrix"
#define AURA_SERVICE_UUID  "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define AURA_CHAR_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// Firmware version, reported to the app over BLE (hidden "About" reveal in the
// Device tab). Bump this on every firmware change so field troubleshooting can
// confirm which build is actually flashed.
#define AURA_FW_VERSION    "1.5.1"

// ---- Persisted settings ----------------------------------------------------
static const uint8_t MAX_TEAMS = 16;

struct FlightCfg {
  bool   enabled     = true;
  double lat         = 0.0;
  double lon         = 0.0;
  int    radiusMi    = 25;
  bool   trackFlight = false;   // follow one specific flight
  String flightIdent = "";      // callsign / flight number to follow
  bool   landingAlert = true;   // flash when tracked flight descends/lands
};

struct SportsCfg {
  bool    enabled = true;
  bool    ufc     = false;
  bool    showStreak = false;   // fetch + show W/L streak on score cards
  uint8_t count   = 0;
  String  teams[MAX_TEAMS];   // stored as "NFL:DAL"
  uint8_t rivalCount = 0;
  String  rivals[MAX_TEAMS];  // starred rivalry teams "NFL:DAL"
};

struct WeatherCfg {
  bool   enabled   = true;
  String severity  = "severe"; // minor | moderate | severe | extreme
  bool   showClock = false;    // show a time + temperature card
  bool   showHiLo  = false;    // add today's high/low to the clock card
  bool   showFeels = false;    // add the "feels like" temp to the clock card
  bool   showWxIcon = false;   // draw a sun/cloud/rain/storm symbol on the clock card
};

struct NightWindow {
  bool enabled   = false;
  int  startHour = 23;
  int  endHour   = 8;
  int  dimLevel  = 20;
};

struct NightCfg {
  bool       enabled   = false;
  bool       useSunset = false;  // dim from local sunset to sunrise
  int        startHour = 22;  // 0-23
  int        endHour   = 7;   // 0-23
  int        dimLevel  = 20;  // 0-100 (%)
  NightWindow weekend;        // separate Sat/Sun schedule
};

struct AuraSettings {
  FlightCfg  flights;
  SportsCfg  sports;
  WeatherCfg weather;
  NightCfg   night;
  int        brightness = 80;   // 0-100 (%)
  bool       holidayThemes = true;
  String     wifiSsid = "";
  String     wifiPass = "";
  String     serverUrl = "";    // optional backend proxy base (from the app)
};

// Single global instance, defined in main.cpp.
extern AuraSettings gSettings;

// Cross-module flags (set by BLE, consumed by the main loop).
extern volatile bool gWifiCredsChanged;   // new SSID/pass received
extern volatile bool gConfigChanged;      // any display config changed
extern volatile bool gFlashTest;          // one-shot test pattern requested
extern volatile bool gWeatherTest;        // one-shot sample weather alert
extern volatile bool gOtaRequested;       // one-shot OTA firmware update requested
