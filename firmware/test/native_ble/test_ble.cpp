// Native (host) test for the BLE config path in BleProvisioning.h.
//  * replays the exact per-section frames the app's Sync (pushAllSections)
//    writes, with heavy-but-realistic settings, from a "NimBLE host" thread
//    while the main thread plays loop(): applies queued frames and reads the
//    same gSettings Strings refreshData()/drawCard() read;
//  * checks frame sizes vs the BLE MTU, the applied settings, and that every
//    section is acknowledged (incl. the second location).
// Build with -fsanitize=thread to catch cross-thread races (see run.sh).
#include <thread>
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <vector>
#include "Config.h"
// CHECK() can be compiled out; this can't.
#define CHECK(c) do { if (!(c)) { std::printf("CHECK failed %s:%d: %s\n", __FILE__, __LINE__, #c); std::exit(1); } } while (0)
AuraSettings gSettings;
volatile bool gWifiCredsChanged = false, gConfigChanged = false, gFlashTest = false,
              gWeatherTest = false, gOtaRequested = false;
#include "BleProvisioning.h"

static std::vector<std::string> syncFrames() {
  return {
    R"({"command":"flights","enabled":true,"lat":35.5012,"lon":-80.8735,"radiusMi":25,"trackFlight":true,"flightIdent":"AA5584","landingAlert":true})",
    R"({"command":"sports","enabled":true,"ufc":true,"teams":["NFL:CAR","NHL:CAR","MLB:ATL","NBA:CHA","NFL:BAL","MLB:NYY","NHL:NJ","CFB:CLEM"],"rivals":["NFL:CAR","MLB:NYY","NHL:NJ"],"showStreak":true})",
    R"({"command":"weather","enabled":true,"severity":"moderate","showClock":true,"showHiLo":true,"showFeels":true,"showWxIcon":true,"loc2":true,"lat2":25.7743,"lon2":-80.1937,"where2":"Miami FL"})",
    R"({"command":"night","enabled":true,"useSunset":false,"startHour":22,"endHour":7,"dimLevel":20,"weekend":{"enabled":true,"startHour":23,"endHour":8,"dimLevel":15}})",
    R"({"command":"brightness","value":70})",
    R"({"command":"holiday","enabled":true})",
    R"({"command":"markets","enabled":true})",
    R"({"command":"server","url":"https://aura-matrix-api.vercel.app"})",
  };
}

int main() {
  NimBLEDevice::init("x");
  auto* ch = new NimBLECharacteristic();
  AuraBLE::sChar = ch;
  ch->setCallbacks(new AuraBLE::CharCallbacks());
  // Pre-existing settings (Jess's panel): 3 teams, other server.
  gSettings.sports.count = 3;
  gSettings.sports.teams[0] = "NFL:BUF"; gSettings.sports.teams[1] = "MLB:BOS"; gSettings.sports.teams[2] = "NBA:BOS";
  gSettings.serverUrl = "https://smart-matrix-hub.preview.emergentagent.com";

  auto frames = syncFrames();
  size_t maxLen = 0;
  for (auto& f : frames) maxLen = std::max(maxLen, f.size());
  std::printf("sync frames: %zu, largest %zu bytes (MTU 512 -> 509 per write; 20-byte default MTU needs long writes)\n",
              frames.size(), maxLen);
  CHECK(maxLen <= 509);

  const int ROUNDS = 200;   // 200 back-to-back Syncs
  std::atomic<bool> done{false};
  std::thread host([&] {
    for (int r = 0; r < ROUNDS; r++)
      for (auto& f : frames) { ch->hostWrite(f); std::this_thread::sleep_for(std::chrono::microseconds(50)); }
    done = true;
  });
  size_t reads = 0, junk = 0;
  while (!done || true) {
#ifndef OLD
    AuraBLE::processPending();
#endif
    // What loop() reads while the app is writing: refreshData() + drawCard().
    String entry;
    for (uint8_t i = 0; i < gSettings.sports.count && i < MAX_TEAMS; i++) {
      if (entry.length()) entry += ",";
      entry += gSettings.sports.teams[i];
    }
    for (uint8_t i = 0; i < gSettings.sports.rivalCount; i++) if (gSettings.sports.rivals[i] == "NHL:NJ") junk++;
    String url = gSettings.serverUrl + "/api/matrix/feed";
    String id = gSettings.flights.flightIdent;
    junk += url.length() + id.length() + entry.length() + gSettings.weather.where2.length();
    reads++;
    // Every so often loop() is "inside an HTTPS fetch" for a while.
    if (reads % 40 == 0) std::this_thread::sleep_for(std::chrono::milliseconds(3));
    if (done) {
#ifndef OLD
      AuraBLE::processPending();
#endif
      break;
    }
  }
  host.join();
  std::printf("loop iterations: %zu (junk=%zu)\n", reads, junk);

  // Final state = the last Sync.
  CHECK(gSettings.sports.count == 8 && gSettings.sports.teams[7] == "CFB:CLEM");
  CHECK(gSettings.sports.rivalCount == 3);
  CHECK(gSettings.serverUrl == "https://aura-matrix-api.vercel.app");
  CHECK(gSettings.flights.flightIdent == "AA5584" && gSettings.flights.trackFlight);
  CHECK(gSettings.markets.enabled && gSettings.brightness == 70);
#ifndef OLD
  CHECK(gSettings.weather.loc2 && gSettings.weather.where2 == "MIAMI FL");
  CHECK(gSettings.weather.lat2 > 25.77 && gSettings.weather.lon2 < -80.19);
  // Every section is acknowledged; queued repeats of a section merge into
  // one, so there are between 8 and 8*ROUNDS acks and nothing is dropped.
  size_t acks = 0, loc2 = 0;
  for (auto& n : ch->notified) {
    if (n.find("\"ack\"") != std::string::npos) acks++;
    if (n.find("\"loc2\":true") != std::string::npos) loc2++;
  }
  std::printf("acks: %zu (of %d writes), weather acks with loc2: %zu, dropped: %u\n", acks, ROUNDS * 8, loc2,
              (unsigned)AuraBLE::sDroppedTotal);
  CHECK(acks >= 8 && acks <= (size_t)ROUNDS * 8 && loc2 >= 1 && AuraBLE::sDroppedTotal == 0);
  for (const char* sec : {"flights", "sports", "weather", "night", "brightness", "holiday", "markets", "server"}) {
    bool seen = false;
    for (auto& n : ch->notified) if (n.find(std::string("\"ack\":\"") + sec + "\"") != std::string::npos) seen = true;
    CHECK(seen);
  }
  // 60 slider moves while loop() is stuck in a fetch -> one queued frame, last value wins.
  for (int b = 1; b <= 60; b++) ch->hostWrite("{\"command\":\"brightness\",\"value\":" + std::to_string(b) + "}");
  CHECK(AuraBLE::sPendCount == 1);
  AuraBLE::processPending(); CHECK(gSettings.brightness == 60);
  // One-shot commands are never merged.
  ch->hostWrite(R"({"command":"flash_test"})"); ch->hostWrite(R"({"command":"flash_test"})");
  CHECK(AuraBLE::sPendCount == 2); AuraBLE::processPending(); CHECK(gFlashTest);
  // Clearing the second location.
  ch->hostWrite(R"({"command":"weather","loc2":false})"); AuraBLE::processPending();
  CHECK(!gSettings.weather.loc2 && gSettings.weather.where2.isEmpty());
  // Older app (no loc2 key) leaves it untouched.
  ch->hostWrite(frames[2]); AuraBLE::processPending(); CHECK(gSettings.weather.loc2);
  ch->hostWrite(R"({"command":"weather","severity":"severe"})"); AuraBLE::processPending();
  CHECK(gSettings.weather.loc2 && gSettings.weather.severity == "severe");
  // version reports fw + reset reason
  ch->hostWrite(R"({"command":"version"})"); AuraBLE::processPending();
  CHECK(ch->notified.back().find("\"rst\"") != std::string::npos);
  std::printf("version reply: %s\n", ch->notified.back().c_str());
#endif
  std::puts("PASS");
  return 0;
}
