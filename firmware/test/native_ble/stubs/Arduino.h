// Minimal host-side Arduino shim for native tests of BleProvisioning.h.
#pragma once
#include <string>
#include <cstring>
#include <cstdio>
#include <cstdint>
#include <cctype>
#include <mutex>
#include <algorithm>

class String {
 public:
  std::string s;
  String() {}
  String(const char* c) : s(c ? c : "") {}
  String(const std::string& x) : s(x) {}
  String(const String&) = default;
  String& operator=(const String&) = default;
  String& operator=(const char* c) { s = c ? c : ""; return *this; }
  const char* c_str() const { return s.c_str(); }
  unsigned int length() const { return (unsigned)s.size(); }
  bool isEmpty() const { return s.empty(); }
  bool concat(const char* c) { s += c; return true; }
  bool concat(const char* c, unsigned n) { s.append(c, n); return true; }
  bool concat(char c) { s += c; return true; }
  String& operator+=(const char* c) { s += c; return *this; }
  String& operator+=(const String& o) { s += o.s; return *this; }
  String& operator+=(char c) { s += c; return *this; }
  bool operator==(const String& o) const { return s == o.s; }
  bool operator==(const char* c) const { return s == (c ? c : ""); }
  bool operator!=(const char* c) const { return !(*this == c); }
  void toUpperCase() { for (auto& ch : s) ch = (char)toupper((unsigned char)ch); }
  String substring(unsigned a, unsigned b) const { if (a > s.size()) return String(); return String(s.substr(a, std::min<size_t>(b, s.size()) - a)); }
  String substring(unsigned a) const { return a > s.size() ? String() : String(s.substr(a)); }
  void trim() {}
};
inline String operator+(const String& a, const String& b) { return String(a.s + b.s); }
inline String operator+(const String& a, const char* b) { return String(a.s + b); }
inline String operator+(const char* a, const String& b) { return String(std::string(a) + b.s); }

struct SerialShim { template <class... A> void printf(const char* f, A... a) { std::printf(f, a...); } void println(const char* s) { std::puts(s); } };
static SerialShim Serial;
struct EspShim { uint64_t getEfuseMac() { return 0x123456783F2AULL; } };
static EspShim ESP;

// FreeRTOS spinlock shim
typedef std::mutex portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED {}
#define portENTER_CRITICAL(m) (m)->lock()
#define portEXIT_CRITICAL(m) (m)->unlock()
