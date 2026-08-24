// ============================================================================
//  Config.h — shared settings struct + globals for Aura Matrix.
// ============================================================================
#pragma once
#include <Arduino.h>

// ---- Panel geometry --------------------------------------------------------
// A 128x64 wall is usually two 64x64 HUB75 modules chained left-to-right.
// If you use a single native 128x64 module, set PANEL_RES_X 128 / CHAIN 1.
#define PANEL_RES_X   64      // width of ONE module
#define PANEL_RES_Y   64      // height of ONE module
#define PANEL_CHAIN   2       // number of chained modules  -> total 128x64

#define MATRIX_W      (PANEL_RES_X * PANEL_CHAIN)   // 128
#define MATRIX_H      (PANEL_RES_Y)                 // 64

// ---- BLE contract (must match the Aura app) --------------------------------
#define AURA_DEVICE_NAME   "AuraMatrix"
#define AURA_SERVICE_UUID  "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define AURA_CHAR_UUID     "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ---- Persisted settings ----------------------------------------------------
static const uint8_t MAX_TEAMS = 16;

struct FlightCfg {
  bool   enabled  = true;
  double lat      = 0.0;
  double lon      = 0.0;
  int    radiusMi = 25;
};

struct SportsCfg {
  bool    enabled = true;
  bool    ufc     = false;
  uint8_t count   = 0;
  String  teams[MAX_TEAMS];   // stored as "NFL:DAL"
};

struct WeatherCfg {
  bool   enabled  = true;
  String severity = "severe"; // minor | moderate | severe | extreme
};

struct AuraSettings {
  FlightCfg  flights;
  SportsCfg  sports;
  WeatherCfg weather;
  String     wifiSsid = "";
  String     wifiPass = "";
};

// Single global instance, defined in main.cpp.
extern AuraSettings gSettings;

// Cross-module flags (set by BLE, consumed by the main loop).
extern volatile bool gWifiCredsChanged;   // new SSID/pass received
extern volatile bool gConfigChanged;      // any display config changed
extern volatile bool gFlashTest;          // one-shot test pattern requested
