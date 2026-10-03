#pragma once
#include <string>
#include <vector>
#include <mutex>
struct ble_gap_conn_desc { int conn_handle; };
#define ESP_PWR_LVL_P9 9
namespace NIMBLE_PROPERTY { enum { READ = 1, WRITE = 2, NOTIFY = 4 }; }
class NimBLECharacteristic;
class NimBLECharacteristicCallbacks { public: virtual ~NimBLECharacteristicCallbacks() {} virtual void onWrite(NimBLECharacteristic*) {} };
class NimBLECharacteristic {
 public:
  std::string value; std::vector<std::string> notified; std::mutex m;
  NimBLECharacteristicCallbacks* cb = nullptr;
  std::string getValue() { std::lock_guard<std::mutex> g(m); return value; }
  void setValue(const std::string& v) { std::lock_guard<std::mutex> g(m); value = v; }
  void setValue(const char* v) { setValue(std::string(v)); }
  void notify() { std::lock_guard<std::mutex> g(m); notified.push_back(value); }
  void setCallbacks(NimBLECharacteristicCallbacks* c) { cb = c; }
  // test helper: what the NimBLE host task does on a GATT write
  void hostWrite(const std::string& v) { setValue(v); cb->onWrite(this); }
};
class NimBLEServer;
class NimBLEServerCallbacks { public: virtual ~NimBLEServerCallbacks() {} virtual void onConnect(NimBLEServer*, ble_gap_conn_desc*) {} };
class NimBLEService { public: NimBLECharacteristic* c = new NimBLECharacteristic(); NimBLECharacteristic* createCharacteristic(const char*, int) { return c; } void start() {} };
class NimBLEServer { public: void setCallbacks(NimBLEServerCallbacks*) {} NimBLEService* createService(const char*) { return new NimBLEService(); } void updateConnParams(int, int, int, int, int) {} };
class NimBLEAdvertising { public: void addServiceUUID(const char*) {} void setName(const char*) {} void start() {} };
struct NimBLEDevice {
  static void init(const char*) {} static void setPower(int) {} static void setMTU(int) {}
  static NimBLEServer* createServer() { return new NimBLEServer(); }
  static NimBLEAdvertising* getAdvertising() { static NimBLEAdvertising a; return &a; }
};
