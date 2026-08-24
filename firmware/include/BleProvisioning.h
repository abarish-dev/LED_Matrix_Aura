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
}

static void applySports(JsonObjectConst o) {
  if (o["enabled"].is<bool>()) gSettings.sports.enabled = o["enabled"];
  if (o["ufc"].is<bool>())     gSettings.sports.ufc     = o["ufc"];
  if (o["teams"].is<JsonArrayConst>()) {
    JsonArrayConst arr = o["teams"];
    uint8_t n = 0;
    for (JsonVariantConst v : arr) {
      if (n >= MAX_TEAMS) break;
      gSettings.sports.teams[n++] = String((const char*)v);
    }
    gSettings.sports.count = n;
  }
}

static void applyWeather(JsonObjectConst o) {
  if (o["enabled"].is<bool>())        gSettings.weather.enabled  = o["enabled"];
  if (o["severity"].is<const char*>())gSettings.weather.severity = String((const char*)o["severity"]);
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
      } else if (command == "flash_test") {
        gFlashTest = true;
      }
      return;
    }

    // Full sync payload.
    if (doc["flights"].is<JsonObjectConst>()) applyFlights(doc["flights"]);
    if (doc["sports"].is<JsonObjectConst>())  applySports(doc["sports"]);
    if (doc["weather"].is<JsonObjectConst>()) applyWeather(doc["weather"]);
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

inline void begin() {
  NimBLEDevice::init(AURA_DEVICE_NAME);
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);

  NimBLEServer* server = NimBLEDevice::createServer();
  NimBLEService* svc   = server->createService(AURA_SERVICE_UUID);

  sChar = svc->createCharacteristic(
      AURA_CHAR_UUID,
      NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::NOTIFY);
  sChar->setCallbacks(new CharCallbacks());
  sChar->setValue("{\"ready\":true}");

  svc->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(AURA_SERVICE_UUID);
  adv->setName(AURA_DEVICE_NAME);
  adv->start();
}

// Push Wi-Fi join result back to the app.
inline void notifyWifi(bool ok, const String& ip) {
  if (!sChar) return;
  JsonDocument doc;
  doc["wifiStatus"] = ok ? "connected" : "failed";
  if (ok) doc["ip"] = ip;
  std::string out;
  serializeJson(doc, out);
  sChar->setValue(out);
  sChar->notify();
}

} // namespace AuraBLE
