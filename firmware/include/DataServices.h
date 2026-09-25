// ============================================================================
//  DataServices.h — Wi-Fi data fetchers (flights / sports / weather).
//  Keyless sources: adsb.lol (ADS-B), ESPN public JSON, NWS api.weather.gov.
//  All fetches use HTTPS with setInsecure() for a simple starter; harden with
//  a root CA bundle for production.
// ============================================================================
#pragma once
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <math.h>
#include <time.h>
#include <limits.h>
#include <stdlib.h>
#include <stdio.h>
#include <esp_heap_caps.h>
#include "Config.h"

namespace Data {

struct FlightInfo { bool ok=false; String callsign; int distanceMi=0; String airline; int altFt=0; int headingDeg=-1; String origin; String dest; };
struct ScoreInfo  { bool ok=false; String home; int hs=0; String away; int as=0; String status; String streak; bool isRecord=false; String record; };
struct WeatherInfo{ bool ok=false; String headline; String severity; };

static double haversineMi(double la1, double lo1, double la2, double lo2) {
  const double R = 3958.8; // miles
  double dLa = radians(la2 - la1), dLo = radians(lo2 - lo1);
  double a = sin(dLa/2)*sin(dLa/2) +
             cos(radians(la1))*cos(radians(la2))*sin(dLo/2)*sin(dLo/2);
  return R * 2 * atan2(sqrt(a), sqrt(1-a));
}

static String airlineFromCallsign(const String& cs) {
  String p = cs.substring(0, 3); p.toUpperCase();
  if (p == "AAL") return "American";
  if (p == "DAL") return "Delta";
  if (p == "UAL") return "United";
  if (p == "SWA") return "Southwest";
  if (p == "JBU") return "JetBlue";
  if (p == "FDX") return "FedEx";
  if (p == "UPS") return "UPS";
  if (p == "SKW") return "SkyWest";
  if (p == "NKS") return "Spirit";
  if (p == "FFT") return "Frontier";
  if (p == "ASA") return "Alaska";
  if (p == "HAL") return "Hawaiian";
  if (p == "AAY") return "Allegiant";
  if (p == "EJA") return "NetJets";
  if (p == "EJM") return "Exec Jet";
  if (p == "LXJ") return "Flexjet";
  if (p == "DPJ") return "PlaneSense";
  return cs; // fall back to raw callsign (e.g. GA tail number)
}

// Tiny per-host DNS cache. Cheap routers rate-limit / ban a client that sends
// too many DNS queries; resolving each host once and reusing the result keeps
// our query volume minimal. DHCP supplies the DNS server.
struct DnsEntry { String host; IPAddress ip; };
static DnsEntry gDnsCache[8];
static int gDnsCacheN = 0;
static uint32_t gDnsRetryAfterMs = 0;  // one failed router lookup pauses uncached hosts

inline void resetDnsCache() {
  gDnsCacheN = 0;
  gDnsRetryAfterMs = 0;
}

static bool resolveCached(const String& host, IPAddress& out) {
  for (int i = 0; i < gDnsCacheN; i++)
    if (gDnsCache[i].host == host) { out = gDnsCache[i].ip; return true; }
  if ((int32_t)(millis() - gDnsRetryAfterMs) < 0) return false;
  IPAddress ip;
  if (!WiFi.hostByName(host.c_str(), ip)) {
    gDnsRetryAfterMs = millis() + 60000;
    Serial.println("[DNS] lookup failed; backing off for 60s");
    return false;
  }
  if (gDnsCacheN < 8) { gDnsCache[gDnsCacheN] = { host, ip }; gDnsCacheN++; }
  out = ip;
  return true;
}

// Drop a host from the cache so it re-resolves (CDNs like Akamai/ESPN rotate
// IPs; a cached one can go stale). Called after a transport failure.
static void dnsForget(const String& host) {
  for (int i = 0; i < gDnsCacheN; i++)
    if (gDnsCache[i].host == host) {
      gDnsCache[i] = gDnsCache[gDnsCacheN - 1];
      gDnsCacheN--;
      return;
    }
}

static String httpGet(const String& url, const char* userAgent = nullptr) {
  int s = url.indexOf("://"); s = (s < 0) ? 0 : s + 3;
  int e = url.indexOf('/', s); if (e < 0) e = url.length();
  String host = url.substring(s, e);

  // User-Agent selection:
  //   nullptr    -> browser UA (ESPN/open-meteo want a browser-like UA)
  //   "" (empty) -> send NO User-Agent header (adsb.lol 403s browser UAs but
  //                 is perfectly happy with none — its originally-working state)
  //   any string -> use it verbatim (weather.gov requires its own UA)
  const char* ua = userAgent;
  bool sendUa = true;
  if (userAgent == nullptr) {
    ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
         "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  } else if (userAgent[0] == '\0') {
    sendUa = false;
  }

  // Retry transient transport failures (BLE<->Wi-Fi coexistence causes sporadic
  // TLS EOF/-29312, connect -1 and read-timeout -11). Up to 3 tries.
  for (int attempt = 1; attempt <= 3; attempt++) {
    IPAddress rip;
    bool ok = resolveCached(host, rip);
    Serial.printf("[GET] try=%d intFree=%u  psram=%u  dns(%s)=%s  %s\n",
                  attempt, heap_caps_get_free_size(MALLOC_CAP_INTERNAL),
                  ESP.getFreePsram(), host.c_str(),
                  ok ? rip.toString().c_str() : "FAIL", url.c_str());
    if (!ok) return "";   // one failed DNS lookup already costs ~7s; skip this cycle

    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    http.setConnectTimeout(12000);
    http.setTimeout(12000);
    if (!http.begin(client, url)) { Serial.println("[GET] begin() failed"); delay(400); continue; }
    if (sendUa) http.addHeader("User-Agent", ua);
    http.addHeader("Accept", "application/json");
    http.addHeader("Accept-Language", "en-US,en;q=0.9");
    int code = http.GET();
    String body = (code == 200) ? http.getString() : "";
    Serial.printf("[GET] code=%d (%s)  len=%d  heapAfter=%u\n",
                  code, http.errorToString(code).c_str(), (int)body.length(), ESP.getFreeHeap());
    http.end();
    if (code == 200) return body;
    if (code > 0) return "";     // server answered (e.g. 403/404) -> no point retrying
    dnsForget(host);             // transport error -> drop possibly-stale IP
    delay(400);                  // and retry
  }
  return "";
}

// Like httpGet but parses the response directly from the socket stream using an
// ArduinoJson filter, so a huge payload (e.g. a multi-day ESPN scoreboard, which
// can be hundreds of KB) never has to be buffered whole in RAM. Returns true on
// a parsed 200. Shares the DNS cache + retry behavior.
static bool httpGetToDoc(const String& url, JsonDocument& doc, JsonDocument& filter,
                         const char* userAgent = nullptr) {
  int s = url.indexOf("://"); s = (s < 0) ? 0 : s + 3;
  int e = url.indexOf('/', s); if (e < 0) e = url.length();
  String host = url.substring(s, e);

  const char* ua = userAgent ? userAgent :
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  for (int attempt = 1; attempt <= 3; attempt++) {
    IPAddress rip;
    if (!resolveCached(host, rip)) return false;

    WiFiClientSecure client; client.setInsecure();
    HTTPClient http;
    http.setConnectTimeout(12000);
    http.setTimeout(12000);
    if (!http.begin(client, url)) { delay(400); continue; }
    http.addHeader("User-Agent", ua);
    http.addHeader("Accept", "application/json");
    int code = http.GET();
    Serial.printf("[GETDOC] try=%d code=%d intFree=%u  %s\n",
                  attempt, code, heap_caps_get_free_size(MALLOC_CAP_INTERNAL), url.c_str());
    if (code == 200) {
      DeserializationError err =
          deserializeJson(doc, http.getStream(), DeserializationOption::Filter(filter));
      http.end();
      if (!err) return true;
      Serial.printf("[GETDOC] parse err: %s\n", err.c_str());
      return false;
    }
    http.end();
    if (code > 0) return false;   // server answered non-200 -> don't retry
    dnsForget(host);
    delay(400);
  }
  return false;
}


// ---- Flights: nearest aircraft from adsb.lol -------------------------------
inline FlightInfo nearestFlight(double lat, double lon, int radiusMi) {
  FlightInfo out;
  int nm = max(1, (int)(radiusMi / 1.15078));  // miles -> nautical miles
  String url = "https://api.adsb.lol/v2/lat/" + String(lat, 4) +
               "/lon/" + String(lon, 4) + "/dist/" + String(nm);
  // adsb.lol rate-limits/403s bots; their docs ask for a descriptive UA (and
  // reject browser-looking ones). Identify ourselves clearly.
  String body = httpGet(url, "AuraMatrix/1.0 (ESP32 LED matrix; +https://github.com)");
  if (body.isEmpty()) return out;

  JsonDocument doc;
  JsonDocument filter;
  filter["ac"][0]["flight"] = true;
  filter["ac"][0]["lat"] = true;
  filter["ac"][0]["lon"] = true;
  filter["ac"][0]["alt_baro"] = true;
  filter["ac"][0]["track"] = true;
  if (deserializeJson(doc, body, DeserializationOption::Filter(filter))) return out;

  double best = 1e9;
  for (JsonObjectConst ac : doc["ac"].as<JsonArrayConst>()) {
    if (!ac["lat"].is<double>() || !ac["lon"].is<double>()) continue;
    double d = haversineMi(lat, lon, ac["lat"], ac["lon"]);
    if (d < best) {
      best = d;
      String cs = String((const char*)(ac["flight"] | "")); cs.trim();
      out.callsign = cs.isEmpty() ? "UNKNOWN" : cs;
      out.distanceMi = (int)round(d);
      out.airline = airlineFromCallsign(out.callsign);
      out.altFt = ac["alt_baro"].is<int>() ? (int)ac["alt_baro"] : 0;
      out.headingDeg = ac["track"].is<float>() ? (int)round((float)ac["track"]) : -1;
      out.ok = true;
    }
  }
  return out;
}

// ---- Flights: a specific flight by callsign from adsb.lol ------------------
inline FlightInfo flightByCallsign(const String& callsign, double homeLat, double homeLon) {
  FlightInfo out;
  String cs = callsign; cs.trim(); cs.toUpperCase();
  if (cs.isEmpty()) return out;
  String url = "https://api.adsb.lol/v2/callsign/" + cs;
  // adsb.lol rate-limits/403s bots; their docs ask for a descriptive UA.
  String body = httpGet(url, "AuraMatrix/1.0 (ESP32 LED matrix; +https://github.com)");
  if (body.isEmpty()) return out;

  JsonDocument doc;
  JsonDocument filter;
  filter["ac"][0]["flight"] = true;
  filter["ac"][0]["lat"] = true;
  filter["ac"][0]["lon"] = true;
  filter["ac"][0]["alt_baro"] = true;
  filter["ac"][0]["track"] = true;
  if (deserializeJson(doc, body, DeserializationOption::Filter(filter))) return out;

  JsonArrayConst arr = doc["ac"].as<JsonArrayConst>();
  if (arr.isNull() || arr.size() == 0) return out;
  JsonObjectConst ac = arr[0];
  out.callsign = cs;
  out.airline = airlineFromCallsign(cs);
  out.altFt = ac["alt_baro"].is<int>() ? (int)ac["alt_baro"] : 0;
  out.headingDeg = ac["track"].is<float>() ? (int)round((float)ac["track"]) : -1;
  if (ac["lat"].is<double>() && ac["lon"].is<double>())
    out.distanceMi = (int)round(haversineMi(homeLat, homeLon, ac["lat"], ac["lon"]));
  out.ok = true;
  return out;
}

// ---- Sports: W/L streak for a team from ESPN team endpoint -----------------
static String teamStreak(const String& path, const String& teamId) {
  if (teamId.isEmpty()) return "";
  String url = "https://site.api.espn.com/apis/site/v2/sports/" + path + "/teams/" + teamId;
  String body = httpGet(url);
  if (body.isEmpty()) return "";
  JsonDocument doc;
  if (deserializeJson(doc, body)) return "";
  JsonArrayConst items = doc["team"]["record"]["items"].as<JsonArrayConst>();
  if (items.isNull() || items.size() == 0) return "";
  for (JsonObjectConst st : items[0]["stats"].as<JsonArrayConst>()) {
    String name = String((const char*)(st["name"] | ""));
    if (name == "streak") {
      float v = st["value"].is<float>() ? (float)st["value"] : 0;
      int n = (int)round(fabs(v));
      if (n == 0) return "";
      return (v > 0 ? "W" : "L") + String(n);
    }
  }
  return "";
}

// ---- Sports: latest game for a team from ESPN ------------------------------
inline ScoreInfo teamGame(const String& league, const String& abbr, bool wantStreak = false) {
  ScoreInfo out;
  String path;
  if (league == "NFL") path = "football/nfl";
  else if (league == "NBA") path = "basketball/nba";
  else if (league == "MLB") path = "baseball/mlb";
  else if (league == "NHL") path = "hockey/nhl";
  else return out;

  // The bare /scoreboard only returns TODAY's games, so on a team's off-day it
  // finds nothing. Query a date window (yesterday .. +3 days) and pick the game
  // closest to now (recent final / live / next matchup), like the phone app.
  String url = "https://site.api.espn.com/apis/site/v2/sports/" + path + "/scoreboard";
  struct tm t;
  time_t nowT = 0;
  if (getLocalTime(&t, 50)) {
    nowT = mktime(&t);
    char sd[9], ed[9];
    time_t startT = nowT - 1 * 86400, endT = nowT + 3 * 86400;
    struct tm st, et;
    localtime_r(&startT, &st); localtime_r(&endT, &et);
    strftime(sd, sizeof(sd), "%Y%m%d", &st);
    strftime(ed, sizeof(ed), "%Y%m%d", &et);
    url += "?dates=" + String(sd) + "-" + String(ed) + "&limit=100";
  }

  // Filter: keep only the few fields we need so even a big multi-day payload
  // parses in a tiny amount of RAM (streamed, never buffered whole).
  JsonDocument filter;
  JsonObject fe = filter["events"][0].to<JsonObject>();
  fe["date"] = true;
  JsonObject fc = fe["competitions"][0].to<JsonObject>();
  fc["status"]["type"]["shortDetail"] = true;
  JsonObject fcomp = fc["competitors"][0].to<JsonObject>();
  fcomp["homeAway"] = true;
  fcomp["score"] = true;
  fcomp["team"]["abbreviation"] = true;
  fcomp["team"]["id"] = true;

  JsonDocument doc;
  if (!httpGetToDoc(url, doc, filter)) return out;

  // Among this team's games in the window, choose the one closest to now.
  String myId;
  long bestDelta = LONG_MAX;
  for (JsonObjectConst ev : doc["events"].as<JsonArrayConst>()) {
    JsonObjectConst comp = ev["competitions"][0];
    JsonArrayConst cs = comp["competitors"];
    bool match = false;
    for (JsonObjectConst c : cs)
      if (String((const char*)(c["team"]["abbreviation"] | "")).equalsIgnoreCase(abbr)) { match = true; break; }
    if (!match) continue;

    // Parse the event's ISO date (e.g. 2026-09-03T23:05Z) to seconds for ranking.
    long delta = 0;
    const char* ds = ev["date"] | "";
    if (nowT && ds && strlen(ds) >= 16) {
      struct tm et = {};
      if (sscanf(ds, "%d-%d-%dT%d:%d", &et.tm_year, &et.tm_mon, &et.tm_mday,
                 &et.tm_hour, &et.tm_min) == 5) {
        et.tm_year -= 1900; et.tm_mon -= 1;
        time_t evT = mktime(&et);            // approx (UTC vs local); fine for ranking
        delta = labs((long)(evT - nowT));
      }
    }
    if (delta > bestDelta) continue;         // keep the closest-to-now match
    bestDelta = delta;

    out.home = ""; out.away = ""; out.hs = 0; out.as = 0;
    for (JsonObjectConst c : cs) {
      String ha = String((const char*)(c["homeAway"] | ""));
      String a  = String((const char*)(c["team"]["abbreviation"] | ""));
      int sc    = atoi((const char*)(c["score"] | "0"));
      if (a.equalsIgnoreCase(abbr)) myId = String((const char*)(c["team"]["id"] | ""));
      if (ha == "home") { out.home = a; out.hs = sc; }
      else              { out.away = a; out.as = sc; }
    }
    out.status = String((const char*)(comp["status"]["type"]["shortDetail"] | ""));
    out.ok = true;
  }
  Serial.printf("[SPORTS] %s:%s -> ok=%d %s %d-%d %s\n", league.c_str(), abbr.c_str(),
                out.ok, out.home.c_str(), out.hs, out.as, out.status.c_str());
  if (out.ok && wantStreak) out.streak = teamStreak(path, myId);
  return out;
}

// ---- Weather: active NWS alerts for a point --------------------------------
static int sevRank(const String& s) {
  if (s.equalsIgnoreCase("minor")) return 1;
  if (s.equalsIgnoreCase("moderate")) return 2;
  if (s.equalsIgnoreCase("severe")) return 3;
  if (s.equalsIgnoreCase("extreme")) return 4;
  return 0;
}

inline WeatherInfo activeAlert(double lat, double lon, const String& minSeverity) {
  WeatherInfo out;
  String url = "https://api.weather.gov/alerts/active?point=" +
               String(lat, 4) + "," + String(lon, 4);
  String body = httpGet(url, "AuraMatrix/1.0 (contact@example.com)");
  if (body.isEmpty()) return out;

  JsonDocument doc;
  JsonDocument filter;
  filter["features"][0]["properties"]["event"] = true;
  filter["features"][0]["properties"]["headline"] = true;
  filter["features"][0]["properties"]["severity"] = true;
  if (deserializeJson(doc, body, DeserializationOption::Filter(filter))) return out;

  int minRank = sevRank(minSeverity);
  for (JsonObjectConst feat : doc["features"].as<JsonArrayConst>()) {
    JsonObjectConst p = feat["properties"];
    String sev = String((const char*)(p["severity"] | "Unknown"));
    if (sevRank(sev) < minRank) continue;
    out.headline = String((const char*)(p["event"] | "Alert"));
    out.severity = sev;
    out.ok = true;
    break; // most severe first is not guaranteed; first-at-threshold is fine
  }
  return out;
}

// ---- Weather: current temperature (°F) from open-meteo (keyless) -----------
// Optionally also returns apparent ("feels like") temp, weather code, and day flag.
inline int currentTempF(double lat, double lon, int* feels = nullptr,
                        int* code = nullptr, int* isDay = nullptr) {
  if (feels) *feels = -999;
  if (code)  *code = -1;
  if (isDay) *isDay = 1;
  String url = "https://api.open-meteo.com/v1/forecast?latitude=" + String(lat, 4) +
               "&longitude=" + String(lon, 4) +
               "&current=temperature_2m,apparent_temperature,weather_code,is_day" +
               "&temperature_unit=fahrenheit";
  String body = httpGet(url);
  if (body.isEmpty()) return -999;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return -999;
  JsonObjectConst cur = doc["current"];
  if (feels && cur["apparent_temperature"].is<float>())
    *feels = (int)round((float)cur["apparent_temperature"]);
  if (code && cur["weather_code"].is<int>()) *code = (int)cur["weather_code"];
  if (isDay && cur["is_day"].is<int>()) *isDay = (int)cur["is_day"];
  if (cur["temperature_2m"].is<float>())
    return (int)round((float)cur["temperature_2m"]);
  return -999;
}

// ---- Weather: today's high/low (°F) from open-meteo (keyless) --------------
inline void dailyHiLo(double lat, double lon, int& hi, int& lo) {
  hi = -999; lo = -999;
  String url = "https://api.open-meteo.com/v1/forecast?latitude=" + String(lat, 4) +
               "&longitude=" + String(lon, 4) +
               "&daily=temperature_2m_max,temperature_2m_min" +
               "&temperature_unit=fahrenheit&timezone=auto&forecast_days=1";
  String body = httpGet(url);
  if (body.isEmpty()) return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;
  if (doc["daily"]["temperature_2m_max"][0].is<float>())
    hi = (int)round((float)doc["daily"]["temperature_2m_max"][0]);
  if (doc["daily"]["temperature_2m_min"][0].is<float>())
    lo = (int)round((float)doc["daily"]["temperature_2m_min"][0]);
}

// ---- Sun times: today's sunrise/sunset as minutes-of-day (open-meteo) ------
// Returns -1 for each on failure. ISO looks like "2026-06-28T06:12".
inline void sunTimes(double lat, double lon, int& sunriseMin, int& sunsetMin) {
  sunriseMin = -1; sunsetMin = -1;
  String url = "https://api.open-meteo.com/v1/forecast?latitude=" + String(lat, 4) +
               "&longitude=" + String(lon, 4) +
               "&daily=sunrise,sunset&timezone=auto&forecast_days=1";
  String body = httpGet(url);
  if (body.isEmpty()) return;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return;
  const char* sr = doc["daily"]["sunrise"][0];
  const char* ss = doc["daily"]["sunset"][0];
  auto parseMin = [](const char* iso) -> int {
    if (!iso || strlen(iso) < 16) return -1;
    int hh = (iso[11] - '0') * 10 + (iso[12] - '0');
    int mm = (iso[14] - '0') * 10 + (iso[15] - '0');
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return -1;
    return hh * 60 + mm;
  };
  sunriseMin = parseMin(sr);
  sunsetMin  = parseMin(ss);
}

// ---- Backend proxy: one small call returns flight + alert + temp -----------
// The server does the heavy multi-source fetching (reliable network). Sports
// stays a direct ESPN call from the matrix (ESPN blocks datacenter IPs).
struct FeedResult {
  bool ok = false;
  FlightInfo flight;
  FlightInfo planes[5];   // up to 5 nearby aircraft, closest first (for cycling)
  uint8_t planeCount = 0;
  WeatherInfo alert;
  ScoreInfo score;
  ScoreInfo scores[8];    // one game per followed team that is in-season
  String    scoreKeys[8]; // "LEAGUE:ABBR" for each entry in scores[]
  uint8_t   scoreCount = 0;
  bool haveScore = false;
  bool haveTemp = false;
  int tempF = -999, feelsF = -999, wxCode = -1, isDay = 1, hiF = -999, loF = -999;
};

inline FeedResult matrixFeed(const String& base, double lat, double lon,
                             int radiusMi, const String& severity,
                             bool wantFlights, bool wantWeather,
                             const String& team, bool wantSports) {
  FeedResult r;
  if (base.isEmpty()) return r;
  String url = base;
  if (url.endsWith("/")) url.remove(url.length() - 1);
  url += "/api/matrix/feed?lat=" + String(lat, 4) + "&lon=" + String(lon, 4) +
         "&radius=" + String(radiusMi) + "&severity=" + severity +
         "&flights=" + (wantFlights ? "1" : "0") +
         "&sports=" + (wantSports ? "1" : "0") +
         "&weather=" + (wantWeather ? "1" : "0");
  if (wantSports && team.length()) url += "&team=" + team;
  String body = httpGet(url, "AuraMatrix/1.0");
  if (body.isEmpty()) return r;
  JsonDocument doc;
  if (deserializeJson(doc, body)) return r;
  r.ok = true;

  JsonObjectConst f = doc["flight"];
  if (f["ok"].as<int>() == 1) {
    // Parse the nearby-aircraft list (closest first) for on-wall cycling.
    JsonArrayConst list = f["list"];
    uint8_t n = 0;
    for (JsonObjectConst p : list) {
      if (n >= 5) break;
      FlightInfo& fi = r.planes[n];
      fi.ok = true;
      fi.callsign = String((const char*)(p["cs"] | ""));
      String air = String((const char*)(p["airline"] | ""));
      fi.airline = air.length() ? air : airlineFromCallsign(fi.callsign);
      fi.distanceMi = p["dist"] | 0;
      fi.altFt = p["alt"] | 0;
      fi.headingDeg = p["hdg"] | -1;
      fi.origin = String((const char*)(p["from"] | ""));
      fi.dest = String((const char*)(p["to"] | ""));
      n++;
    }
    r.planeCount = n;
    // Backward-compatible single flight = closest (or the top-level fields).
    if (n > 0) {
      r.flight = r.planes[0];
    } else {
      r.flight.ok = true;
      r.flight.callsign = String((const char*)(f["cs"] | ""));
      String air = String((const char*)(f["airline"] | ""));
      r.flight.airline = air.length() ? air : airlineFromCallsign(r.flight.callsign);
      r.flight.distanceMi = f["dist"] | 0;
      r.flight.altFt = f["alt"] | 0;
      r.flight.headingDeg = f["hdg"] | -1;
      r.flight.origin = String((const char*)(f["from"] | ""));
      r.flight.dest = String((const char*)(f["to"] | ""));
    }
  }
  JsonObjectConst sc = doc["score"];
  if (sc["ok"].as<int>() == 1) {
    r.haveScore = true;
    r.score.ok = true;
    r.score.home = String((const char*)(sc["home"] | ""));
    r.score.away = String((const char*)(sc["away"] | ""));
    r.score.hs = sc["hs"] | 0;
    r.score.as = sc["as"] | 0;
    r.score.status = String((const char*)(sc["st"] | ""));
    r.score.isRecord = strcmp((const char*)(sc["mode"] | ""), "record") == 0;
    r.score.record = String((const char*)(sc["record"] | ""));
  }
  // Parse the full per-team scores list (all followed teams that are playing)
  // so the matrix can cycle through EVERY game, not just one.
  JsonArrayConst scs = doc["scores"];
  uint8_t sn = 0;
  for (JsonObjectConst s : scs) {
    if (sn >= 8) break;
    ScoreInfo& si = r.scores[sn];
    si.ok = true;
    si.home = String((const char*)(s["home"] | ""));
    si.away = String((const char*)(s["away"] | ""));
    si.hs = s["hs"] | 0;
    si.as = s["as"] | 0;
    si.status = String((const char*)(s["st"] | ""));
    si.isRecord = strcmp((const char*)(s["mode"] | ""), "record") == 0;
    si.record = String((const char*)(s["record"] | ""));
    r.scoreKeys[sn] = String((const char*)(s["key"] | ""));
    sn++;
  }
  r.scoreCount = sn;
  JsonObjectConst a = doc["alert"];
  if (a["ok"].as<int>() == 1) {
    r.alert.ok = true;
    r.alert.headline = String((const char*)(a["head"] | ""));
    r.alert.severity = String((const char*)(a["sev"] | ""));
  }
  JsonObjectConst t = doc["temp"];
  if (t["ok"].as<int>() == 1) {
    r.haveTemp = true;
    r.tempF = t["f"] | -999;
    r.feelsF = t["feels"] | -999;
    r.wxCode = t["code"] | -1;
    r.isDay = t["day"] | 1;
    r.hiF = t["hi"] | -999;
    r.loF = t["lo"] | -999;
  }
  return r;
}

} // namespace Data
