// ============================================================================
//  BleProvisioning.h — NimBLE server that receives config from the Aura app.
//
//  The app writes a UTF-8 JSON string to the characteristic. Two shapes:
//    Full sync : {"flights":{...},"sports":{...},"weather":{...},"syncedAt":n}
//    Live cmd  : {"command":"flights|sports|weather|markets|wifi|flash_test", ...}
//
//  After the matrix joins Wi-Fi, notify the app on the same characteristic:
//    {"wifiStatus":"connected","ip":"192.168.1.42"}   or
//    {"wifiStatus":"failed"}
// ============================================================================
#pragma once
#include <NimBLEDevice.h>
#include <ArduinoJson.h>
#include "Config.h"

namespace AuraBLE {

static NimBLECharacteristic* sChar = nullptr;

static void applyFlights(JsonObjectConst o) {
  if (o["enabled"].is<bool>())  gSettings.flights.enabled  = o["enabled"];
  if (o["lat"].is<double>())    gSettings.flights.lat      = o["lat"];
  if (o["lon"].is<double>())    gSettings.flights.lon      = o["lon"];
  if (o["radiusMi"].is<int>())  gSettings.flights.radiusMi = o["radiusMi"];
  if (o["trackFlight"].is<bool>())        gSettings.flights.trackFlight = o["trackFlight"];
  if (o["flightIdent"].is<const char*>()) gSettings.flights.flightIdent = String((const char*)o["flightIdent"]);
  if (o["landingAlert"].is<bool>())       gSettings.flights.landingAlert = o["landingAlert"];
}

static void applySports(JsonObjectConst o) {
  if (o["enabled"].is<bool>()) gSettings.sports.enabled = o["enabled"];
  if (o["ufc"].is<bool>())     gSettings.sports.ufc     = o["ufc"];
  if (o["showStreak"].is<bool>()) gSettings.sports.showStreak = o["showStreak"];
  if (o["teams"].is<JsonArrayConst>()) {
    JsonArrayConst arr = o["teams"];
    uint8_t n = 0;
    for (JsonVariantConst v : arr) {
      if (n >= MAX_TEAMS) break;
      gSettings.sports.teams[n++] = String((const char*)v);
    }
    gSettings.sports.count = n;
  }
  if (o["rivals"].is<JsonArrayConst>()) {
    JsonArrayConst arr = o["rivals"];
    uint8_t n = 0;
    for (JsonVariantConst v : arr) {
      if (n >= MAX_TEAMS) break;
      gSettings.sports.rivals[n++] = String((const char*)v);
    }
    gSettings.sports.rivalCount = n;
  }
}

static void applyWeather(JsonObjectConst o) {
  // Second location: {"loc2":true,"lat2":25.77,"lon2":-80.19,"where2":"Miami FL"}
  // or {"loc2":false} to clear. Absent "loc2" (older apps) leaves it as is.
  if (o["loc2"].is<bool>()) {
    if ((bool)o["loc2"] && o["lat2"].is<double>() && o["lon2"].is<double>()) {
      gSettings.weather.loc2 = true;
      gSettings.weather.lat2 = o["lat2"];
      gSettings.weather.lon2 = o["lon2"];
      String w = String((const char*)(o["where2"] | ""));
      w.toUpperCase();
      gSettings.weather.where2 = w.substring(0, 20);
    } else {
      gSettings.weather.loc2 = false;
      gSettings.weather.where2 = "";
    }
  }
  if (o["enabled"].is<bool>())        gSettings.weather.enabled  = o["enabled"];
  if (o["severity"].is<const char*>())gSettings.weather.severity = String((const char*)o["severity"]);
  if (o["showClock"].is<bool>())      gSettings.weather.showClock = o["showClock"];
  if (o["showHiLo"].is<bool>())       gSettings.weather.showHiLo = o["showHiLo"];
  if (o["showFeels"].is<bool>())      gSettings.weather.showFeels = o["showFeels"];
  if (o["showWxIcon"].is<bool>())     gSettings.weather.showWxIcon = o["showWxIcon"];
}

static void applyNight(JsonObjectConst o) {
  if (o["enabled"].is<bool>())   gSettings.night.enabled   = o["enabled"];
  if (o["useSunset"].is<bool>()) gSettings.night.useSunset = o["useSunset"];
  if (o["startHour"].is<int>())  gSettings.night.startHour = o["startHour"];
  if (o["endHour"].is<int>())    gSettings.night.endHour   = o["endHour"];
  if (o["dimLevel"].is<int>())   gSettings.night.dimLevel  = o["dimLevel"];
  JsonObjectConst w = o["weekend"];
  if (!w.isNull()) {
    if (w["enabled"].is<bool>())  gSettings.night.weekend.enabled   = w["enabled"];
    if (w["startHour"].is<int>()) gSettings.night.weekend.startHour = w["startHour"];
    if (w["endHour"].is<int>())   gSettings.night.weekend.endHour   = w["endHour"];
    if (w["dimLevel"].is<int>())  gSettings.night.weekend.dimLevel  = w["dimLevel"];
  }
}

static void applyMarkets(JsonObjectConst o) {
  if (o["enabled"].is<bool>()) gSettings.markets.enabled = o["enabled"];
}

// BLE writes arrive on the NimBLE host task (core 0) while loop() runs on
// core 1 and reads gSettings' Strings (team lists, server URL, flight ident)
// in the middle of HTTPS fetches and card draws. Applying a write directly
// from the BLE task raced those reads (a String freed on one core while the
// other was copying it) — a burst of writes like the app's Sync could crash
// and reboot the board, dropping the BLE link right after "Synced". Now the
// BLE task only queues the raw frame; loop() applies it via processPending().
static const uint8_t PENDING_MAX = 24;
static std::string   sPending[PENDING_MAX];
static uint8_t       sPendHead = 0, sPendCount = 0;
static portMUX_TYPE  sPendMux = portMUX_INITIALIZER_UNLOCKED;
static volatile uint32_t sDropped = 0;
static uint32_t sDroppedTotal = 0;   // for diagnostics / tests

static void notifyJson(JsonDocument& d) {
  if (!sChar) return;
  std::string out;
  serializeJson(d, out);
  sChar->setValue(out);
  sChar->notify();
}

// The app always writes {"command":"<name>",...} with the command first.
// Settings sections carry their full state, so a newer frame of the same
// section replaces a still-queued older one (loop() may be busy in an HTTPS
// fetch for several seconds while the user drags a slider). One-shot actions
// (wifi, flash_test, ota, ...) are never merged.
static std::string frameKey(const std::string& raw) {
  static const char kPre[] = "{\"command\":\"";
  if (raw.compare(0, sizeof(kPre) - 1, kPre) != 0) return "";
  size_t b = sizeof(kPre) - 1, e = raw.find('"', b);
  if (e == std::string::npos) return "";
  std::string k = raw.substr(b, e - b);
  static const char* kSections[] = {"flights", "sports", "weather", "night", "brightness",
                                    "holiday", "markets", "server"};
  for (const char* s : kSections) if (k == s) return k;
  return "";
}

class CharCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    std::string raw = c->getValue();
    if (raw.empty() || raw.size() > 1024) return;
    std::string key = frameKey(raw);   // allocations stay outside the lock
    bool ok = false;
    portENTER_CRITICAL(&sPendMux);
    if (!key.empty()) {
      for (uint8_t i = 0; i < sPendCount && !ok; i++) {
        std::string& slot = sPending[(sPendHead + i) % PENDING_MAX];
        // compare the key in place (no allocation inside the critical section)
        if (slot.size() > 12 + key.size() && slot.compare(12, key.size(), key) == 0 &&
            slot[12 + key.size()] == '"') {
          slot.swap(raw);
          ok = true;
        }
      }
    }
    if (!ok && sPendCount < PENDING_MAX) {
      sPending[(sPendHead + sPendCount) % PENDING_MAX].swap(raw);  // no alloc inside the lock
      sPendCount++;
      ok = true;
    }
    portEXIT_CRITICAL(&sPendMux);
    if (!ok) sDropped++;
  }
};

static bool popPending(std::string& out) {
  bool have = false;
  portENTER_CRITICAL(&sPendMux);
  if (sPendCount) {
    out.swap(sPending[sPendHead]);
    sPending[sPendHead].clear();
    sPendHead = (sPendHead + 1) % PENDING_MAX;
    sPendCount--;
    have = true;
  }
  portEXIT_CRITICAL(&sPendMux);
  return have;
}

// Reset reason of this boot, reported to the app ("rst") so an unexpected
// reboot (panic / watchdog / brownout) is visible instead of a silent drop.
static const char* sResetReason = "unknown";

static void applyFrame(const std::string& raw) {
  JsonDocument doc;
  if (deserializeJson(doc, raw)) return;   // ignore malformed frames

  const char* cmd = doc["command"];
  if (cmd) {
    String command = cmd;
    bool known = true;
    if (command == "wifi") {
      gSettings.wifiSsid = String((const char*)(doc["ssid"] | ""));
      gSettings.wifiPass = String((const char*)(doc["pass"] | ""));
      gWifiCredsChanged = true;
    } else if (command == "flights") {
      applyFlights(doc.as<JsonObjectConst>());
      gConfigChanged = true;
    } else if (command == "sports") {
      applySports(doc.as<JsonObjectConst>());
      gConfigChanged = true;
    } else if (command == "weather") {
      applyWeather(doc.as<JsonObjectConst>());
      gConfigChanged = true;
    } else if (command == "brightness") {
      if (doc["value"].is<int>()) gSettings.brightness = doc["value"];
      gConfigChanged = true;
    } else if (command == "night") {
      applyNight(doc.as<JsonObjectConst>());
      gConfigChanged = true;
    } else if (command == "markets") {
      applyMarkets(doc.as<JsonObjectConst>());
      gConfigChanged = true;
    } else if (command == "holiday") {
      if (doc["enabled"].is<bool>()) gSettings.holidayThemes = doc["enabled"];
      gConfigChanged = true;
    } else if (command == "flash_test") {
      gFlashTest = true;
    } else if (command == "weather_test") {
      gWeatherTest = true;
    } else if (command == "ota") {
      gOtaRequested = true;
    } else if (command == "server") {
      if (doc["url"].is<const char*>()) gSettings.serverUrl = (const char*)doc["url"];
      gConfigChanged = true;
    } else if (command == "version") {
      known = false;  // answered below with fw + reset reason
      JsonDocument v;
      v["fw"] = AURA_FW_VERSION;
      v["rst"] = sResetReason;
      notifyJson(v);
    } else {
      known = false;
    }
    // Confirm every applied settings command so the app can tell the user
    // the panel actually received it (e.g. the second ZIP).
    if (known && command != "wifi") {
      JsonDocument a;
      a["ack"] = command;
      if (command == "weather") a["loc2"] = gSettings.weather.loc2;
      notifyJson(a);
    }
    return;
  }

  // Full sync payload.
  if (doc["flights"].is<JsonObjectConst>()) applyFlights(doc["flights"]);
  if (doc["sports"].is<JsonObjectConst>())  applySports(doc["sports"]);
  if (doc["weather"].is<JsonObjectConst>()) applyWeather(doc["weather"]);
  if (doc["nightMode"].is<JsonObjectConst>()) applyNight(doc["nightMode"]);
  if (doc["markets"].is<JsonObjectConst>()) applyMarkets(doc["markets"]);
  if (doc["brightness"].is<int>())          gSettings.brightness = doc["brightness"];
  if (doc["holidayThemes"].is<bool>())      gSettings.holidayThemes = doc["holidayThemes"];
  gConfigChanged = true;

  JsonDocument ack;
  ack["ack"] = true;
  ack["syncedAt"] = doc["syncedAt"];
  notifyJson(ack);
}

// Apply every queued BLE frame. Call from loop() only.
inline void processPending() {
  std::string raw;
  while (popPending(raw)) { applyFrame(raw); raw.clear(); }
  if (sDropped) { Serial.printf("[BLE] dropped %u frames (queue full)\n", (unsigned)sDropped); sDroppedTotal += sDropped; sDropped = 0; }
}

// Relax the BLE link the moment the phone connects: a long connection interval
// + slave latency means the radio spends almost no time on BLE when idle,
// leaving airtime for Wi-Fi/TLS. The link stays "connected" (standing by) so
// the app can push config any time. Units: interval x1.25ms, timeout x10ms.
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, ble_gap_conn_desc* desc) override {
    s->updateConnParams(desc->conn_handle, 24, 60, 4, 600); // 30-75ms, latency 4, 6s timeout
  }
};

// Every board otherwise advertises the exact same "AuraMatrix" name, so with
// 2+ boards in range there was no way to tell them apart in a BLE scan. This
// appends a short, stable-per-chip suffix from the factory-burned MAC (via
// efuse — doesn't need Wi-Fi/BT to already be up) so each board shows up as
// e.g. "AuraMatrix-3F2A" and the app can offer a proper picker.
static String gBleDeviceName;

inline const char* deviceName() {
  if (gBleDeviceName.isEmpty()) {
    uint64_t mac = ESP.getEfuseMac();
    char suffix[6];
    snprintf(suffix, sizeof(suffix), "%04X", (unsigned)(mac & 0xFFFF));
    gBleDeviceName = String(AURA_DEVICE_NAME) + "-" + suffix;
  }
  return gBleDeviceName.c_str();
}

inline void begin(const char* resetReason = "unknown") {
  sResetReason = resetReason;
  const char* name = deviceName();
  NimBLEDevice::init(name);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  NimBLEDevice::setMTU(512);   // allow larger single writes (config payloads)

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* svc   = server->createService(AURA_SERVICE_UUID);

  sChar = svc->createCharacteristic(
      AURA_CHAR_UUID,
      NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
  sChar->setCallbacks(new CharCallbacks());
  {
    String ready = String("{\"ready\":true,\"fw\":\"" AURA_FW_VERSION "\",\"rst\":\"") + sResetReason + "\"}";
    sChar->setValue(ready.c_str());
  }

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(AURA_SERVICE_UUID);
  adv->setName(name);
  adv->start();
}

// Push Wi-Fi join result back to the app.
inline void notifyWifi(bool ok, const String& ip) {
  if (!sChar) return;
  JsonDocument doc;
  doc["wifiStatus"] = ok ? "connected" : "failed";
  doc["fw"] = AURA_FW_VERSION;
  if (ok) doc["ip"] = ip;
  std::string out;
  serializeJson(doc, out);
  sChar->setValue(out);
  sChar->notify();
}

} // namespace AuraBLE
