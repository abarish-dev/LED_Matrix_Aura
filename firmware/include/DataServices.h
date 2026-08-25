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
#include "Config.h"

namespace Data {

struct FlightInfo { bool ok=false; String callsign; int distanceMi=0; String airline; int altFt=0; int headingDeg=-1; };
struct ScoreInfo  { bool ok=false; String home; int hs=0; String away; int as=0; String status; };
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
  return cs; // fall back to raw callsign
}

static String httpGet(const String& url, const char* userAgent = nullptr) {
  WiFiClientSecure client; client.setInsecure();
  HTTPClient http;
  http.setTimeout(8000);
  if (!http.begin(client, url)) return "";
  if (userAgent) http.addHeader("User-Agent", userAgent);
  http.addHeader("Accept", "application/json");
  int code = http.GET();
  String body = (code == 200) ? http.getString() : "";
  http.end();
  return body;
}

// ---- Flights: nearest aircraft from adsb.lol -------------------------------
inline FlightInfo nearestFlight(double lat, double lon, int radiusMi) {
  FlightInfo out;
  int nm = max(1, (int)(radiusMi / 1.15078));  // miles -> nautical miles
  String url = "https://api.adsb.lol/v2/lat/" + String(lat, 4) +
               "/lon/" + String(lon, 4) + "/dist/" + String(nm);
  String body = httpGet(url);
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

// ---- Sports: latest game for a team from ESPN ------------------------------
inline ScoreInfo teamGame(const String& league, const String& abbr) {
  ScoreInfo out;
  String path;
  if (league == "NFL") path = "football/nfl";
  else if (league == "NBA") path = "basketball/nba";
  else if (league == "MLB") path = "baseball/mlb";
  else if (league == "NHL") path = "hockey/nhl";
  else return out;

  String url = "https://site.api.espn.com/apis/site/v2/sports/" + path + "/scoreboard";
  String body = httpGet(url);
  if (body.isEmpty()) return out;

  JsonDocument doc;
  if (deserializeJson(doc, body)) return out;

  for (JsonObjectConst ev : doc["events"].as<JsonArrayConst>()) {
    JsonObjectConst comp = ev["competitions"][0];
    JsonArrayConst cs = comp["competitors"];
    bool match = false;
    for (JsonObjectConst c : cs) {
      String a = String((const char*)(c["team"]["abbreviation"] | ""));
      if (a.equalsIgnoreCase(abbr)) { match = true; break; }
    }
    if (!match) continue;
    for (JsonObjectConst c : cs) {
      String ha = String((const char*)(c["homeAway"] | ""));
      String a  = String((const char*)(c["team"]["abbreviation"] | ""));
      int sc    = atoi((const char*)(c["score"] | "0"));
      if (ha == "home") { out.home = a; out.hs = sc; }
      else              { out.away = a; out.as = sc; }
    }
    out.status = String((const char*)(comp["status"]["type"]["shortDetail"] | ""));
    out.ok = true;
    break;
  }
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

} // namespace Data
