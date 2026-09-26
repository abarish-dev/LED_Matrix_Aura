// ============================================================================
//  BleProvisioning.h — NimBLE server that receives config from the Aura app.
//
//  The app writes a UTF-8 JSON string to the characteristic. Two shapes:
//    Full sync : {"flights":{...},"sports":{...},"weather":{...},"syncedAt":n}
//    Live cmd  : {"command":"flights|sports|weather|wifi|flash_test", ...}
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

class CharCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c) override {
    std::string raw = c->getValue();
    if (raw.empty()) return;

    JsonDocument doc;
    if (deserializeJson(doc, raw)) return;   // ignore malformed frames

    const char* cmd = doc["command"];
    if (cmd) {
      String command = cmd;
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
        // App is asking which firmware is flashed -> notify it back.
        JsonDocument v;
        v["fw"] = AURA_FW_VERSION;
        std::string vs;
        serializeJson(v, vs);
        c->setValue(vs);
        c->notify();
      }
      return;
    }

    // Full sync payload.
    if (doc["flights"].is<JsonObjectConst>()) applyFlights(doc["flights"]);
    if (doc["sports"].is<JsonObjectConst>())  applySports(doc["sports"]);
    if (doc["weather"].is<JsonObjectConst>()) applyWeather(doc["weather"]);
    if (doc["nightMode"].is<JsonObjectConst>()) applyNight(doc["nightMode"]);
    if (doc["brightness"].is<int>())          gSettings.brightness = doc["brightness"];
    if (doc["holidayThemes"].is<bool>())      gSettings.holidayThemes = doc["holidayThemes"];
    gConfigChanged = true;

    // Echo current settings back so the app's read-back "confirmed" succeeds.
    JsonDocument ack;
    ack["ack"] = true;
    ack["syncedAt"] = doc["syncedAt"];
    std::string out;
    serializeJson(ack, out);
    c->setValue(out);
  }
};

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

inline void begin() {
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
  sChar->setValue("{\"ready\":true,\"fw\":\"" AURA_FW_VERSION "\"}");

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
