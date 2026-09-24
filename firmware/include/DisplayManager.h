// ============================================================================
//  DisplayManager.h — HUB75 rendering via ESP32-HUB75-MatrixPanel-DMA.
//  Renders the boot screen, flights, sports scores and weather alerts on a
//  128x64 canvas. Keep draw routines small; the main loop cycles "cards".
// ============================================================================
#pragma once
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include "Config.h"

namespace Display {

static MatrixPanel_I2S_DMA* dma = nullptr;

// 16-bit RGB565 helpers.
static uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return dma->color565(r, g, b);
}

inline void begin() {
  HUB75_I2S_CFG::i2s_pins pins = { // MatrixPortal S3 default HUB75 pinout
      42, 41, 40, 38, 39, 37,      // R1,G1,B1,R2,G2,B2
      45, 36, 48, 35, 21,          // A,B,C,D,E
      47, 14, 2                    // LAT, OE, CLK
  };
  HUB75_I2S_CFG cfg(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN, pins);
  cfg.clkphase = false;
  // --- Memory budget (critical) ------------------------------------------
  // The HUB75 DMA framebuffer MUST live in the ESP32-S3's internal SRAM
  // (its 2MB PSRAM is *Quad* and too slow to feed the panel). WiFi + BLE +
  // an HTTPS/TLS handshake together need ~45KB of internal heap, so we keep
  // the framebuffer small: single-buffered + 4-bit color depth. That frees
  // ~90KB of internal RAM vs. double-buffered 8-bit, which is what let the
  // matrix sit stuck on "waiting for data" (every fetch died with code=-1).
  cfg.double_buff = false;      // single buffer -> frees one full framebuffer
  cfg.setPixelColorDepthBits(6); // 6 bits/channel (262k colors) -> crisp logos,
                                 // still ~half the RAM of the default 8-bit
  // Colors mixing R+G (orange/yellow/white) showing a green-on-top /
  // red-on-bottom split, while pure colors look fine, points to marginal
  // signal integrity on the R/G data lines (loose HUB75 ribbon connector, or
  // the replacement panel's R2/G2 lines needing a slower clock) rather than
  // a driver-chip setting — FM6126A special init was already ruled out
  // (removing it in v1.5.4 did not change this). Try the panel's ribbon
  // cable reseated firmly at BOTH ends first; this slower clock is a second,
  // purely-software mitigation for the same class of issue.
  cfg.i2sspeed = HUB75_I2S_CFG::HZ_8M;   // was default (~10-15MHz); step down
                                          // further to HZ_5M if still glitchy
  // Ghosting fix: bright elements (e.g. the weather clock's sun icon) can
  // leak a faint stray-colored pixel onto neighboring rows/cols without extra
  // blanking time around the row latch. 2 is the documented starting point
  // for this library (max 4; higher trades a little brightness for less
  // ghosting) — bump toward 3-4 here if any stray pixels are still visible.
  cfg.latch_blanking = 2;
  dma = new MatrixPanel_I2S_DMA(cfg);
  dma->begin();
  dma->setBrightness8(120);
  dma->clearScreen();
}

inline void clear() { dma->clearScreen(); }
inline void flip()  { dma->flipDMABuffer(); }

inline void centerText(const char* s, int y, uint16_t color, uint8_t size = 1) {
  int16_t x1, y1; uint16_t w, h;
  dma->setTextSize(size);
  dma->getTextBounds(s, 0, y, &x1, &y1, &w, &h);
  dma->setCursor((MATRIX_W - (int)w) / 2, y);
  dma->setTextColor(color);
  dma->print(s);
}

inline void boot() {
  clear();
  // Matches the app's amber brand color (#f59e0b) for name recognition at a
  // glance. NOTE: amber is R+G-mixed — the same family removed from the rest
  // of the UI (v1.5.6) after it bled/split on this user's panel. This one
  // spot is an intentional visual test; if it bleeds here too, swap back to
  // rgb(56, 189, 248) (the blue used before).
  centerText("AURA", 20, rgb(245, 158, 11), 2);
  centerText("matrix online", 44, rgb(160, 160, 160), 1);
  flip();
}

inline void flashTest() {
  const uint16_t cols[] = {rgb(255,0,0), rgb(0,255,0), rgb(0,0,255), rgb(255,255,255)};
  for (uint8_t i = 0; i < 4; i++) { dma->fillScreen(cols[i]); flip(); delay(180); }
  clear(); flip();
}

inline void setBrightness(int pct) {
  pct = constrain(pct, 0, 100);
  dma->setBrightness8((uint8_t)map(pct, 0, 100, 0, 255));
}

static const char* headingToCompass(int deg) {
  if (deg < 0) return "";
  static const char* dirs[] = {"N","NE","E","SE","S","SW","W","NW"};
  return dirs[(int)((deg + 22) / 45) % 8];
}

// Small heading arrow: 0deg = pointing up (North), clockwise.
inline void drawArrow(int cx, int cy, int deg, int len, uint16_t color) {
  float r = radians((float)deg);
  int tx = cx + (int)round(sin(r) * len);
  int ty = cy - (int)round(cos(r) * len);
  dma->drawLine(cx, cy, tx, ty, color);
  // two barbs pointing back from the tip
  for (int a = -140; a <= 140; a += 280) {
    float ra = radians((float)(deg + a));
    int bx = tx + (int)round(sin(ra) * (len * 0.55f));
    int by = ty - (int)round(cos(ra) * (len * 0.55f));
    dma->drawLine(tx, ty, bx, by, color);
  }
}

// A single flight "card": callsign, airline, route, distance, altitude + ETA.
// Lines are vertically centered as a block on the 64px panel. When `tracked`
// is true (this plane matches the app's "Track a specific flight" setting),
// a green "TRACKED" label is added and the border is expected to already be
// tinted (see caller) so it stands out from the normal overhead cycle.
inline void flight(const String& callsign, int distanceMi, const String& airline,
                   int altFt = 0, int headingDeg = -1,
                   uint16_t border = 0, int etaMin = -1,
                   const String& origin = "", const String& dest = "",
                   bool tracked = false) {
  clear();
  dma->drawRect(0, 0, MATRIX_W, MATRIX_H, border ? border : rgb(60, 40, 5));
  String texts[7]; uint16_t cols[7]; int nl = 0;
  char buf[28];
  if (tracked) { texts[nl] = "* TRACKED *"; cols[nl++] = rgb(16, 185, 129); }
  texts[nl] = callsign;          cols[nl++] = rgb(56, 189, 248);
  texts[nl] = airline;           cols[nl++] = rgb(230, 230, 230);
  if (origin.length() && dest.length()) {
    snprintf(buf, sizeof(buf), "%s>%s", origin.c_str(), dest.c_str());
    texts[nl] = buf;             cols[nl++] = rgb(120, 220, 170);
  }
  snprintf(buf, sizeof(buf), "%d mi", distanceMi);
  texts[nl] = buf;               cols[nl++] = rgb(160, 160, 160);
  if (altFt > 0 || headingDeg >= 0) {
    if (headingDeg >= 0) snprintf(buf, sizeof(buf), "%dft %s", altFt, headingToCompass(headingDeg));
    else                 snprintf(buf, sizeof(buf), "%d ft", altFt);
    texts[nl] = buf;             cols[nl++] = rgb(120, 170, 255);
  }
  if (etaMin >= 0) {
    if (etaMin <= 10) snprintf(buf, sizeof(buf), "ARRIVING ~%dm", etaMin);
    else              snprintf(buf, sizeof(buf), "ETA ~%d min", etaMin);
    texts[nl] = buf;             cols[nl++] = rgb(16, 185, 129);
  }
  // Tighten line pitch when every optional field is present (tracked flight
  // with route + altitude/heading + ETA = up to 7 lines) so it still fits.
  const int LH = (nl >= 7) ? 9 : 11;
  int total = nl * LH - (LH - 8);        // block height (8px glyph, no trailing gap)
  int startY = (MATRIX_H - total) / 2;
  if (startY < 1) startY = 1;
  for (int i = 0; i < nl; i++)
    centerText(texts[i].c_str(), startY + i * LH, cols[i], 1);
  if (headingDeg >= 0) drawArrow(MATRIX_W - 12, 12, headingDeg, 7, rgb(56, 189, 248));
  flip();
}

// A "now landing / descending" alert card for a tracked flight.
inline void landing(const String& callsign, bool landed) {
  clear();
  dma->fillRect(0, 0, MATRIX_W, 14, rgb(16, 185, 129));
  centerText(landed ? "LANDED" : "DESCENDING", 3, rgb(0, 0, 0), 1);
  centerText(callsign.c_str(), 26, rgb(56, 189, 248), 1);
  centerText(landed ? "arrived" : "on approach", 46, rgb(200, 200, 200), 1);
  flip();
}

// A single game score "card". When `isRecord` is true (off-season / no game
// within the normal window), `home`/`away` are just team/opponent abbreviations
// (no meaningful score yet) and `record` + `status` carry the season record
// and next-game date instead.
inline void score(const String& home, int hs, const String& away, int as,
                   const String& status, uint16_t border = 0, const String& streak = "",
                   bool isRecord = false, const String& record = "") {
  clear();
  if (border) dma->drawRect(0, 0, MATRIX_W, MATRIX_H, border);
  char l[24];
  if (isRecord) {
    centerText(home.c_str(), 8, rgb(255, 255, 255), 1);
    if (record.length()) centerText(record.c_str(), 24, rgb(56, 189, 248), 1);
    String nextLine = away.length() ? ("Next: " + away) : String("Next game");
    centerText(nextLine.c_str(), 40, rgb(200, 200, 200), 1);
    centerText(status.c_str(), 52, rgb(16, 185, 129), 1);
    flip();
    return;
  }
  snprintf(l, sizeof(l), "%s %d", away.c_str(), as);
  centerText(l, 8, rgb(255, 255, 255), 1);
  snprintf(l, sizeof(l), "%s %d", home.c_str(), hs);
  centerText(l, 26, rgb(255, 255, 255), 1);
  centerText(status.c_str(), 46, rgb(16, 185, 129), 1);
  if (streak.length() > 0) {
    bool win = streak.charAt(0) == 'W';
    dma->setTextSize(1);
    dma->setTextColor(win ? rgb(16, 185, 129) : rgb(239, 68, 68));
    dma->setCursor(MATRIX_W - (int)streak.length() * 6 - 3, 2);
    dma->print(streak);
  }
  flip();
}

// A weather alert "card". severityColor tints the border.
inline void weather(const String& headline, uint16_t severityColor) {
  clear();
  dma->fillRect(0, 0, MATRIX_W, 12, severityColor);
  centerText("WEATHER ALERT", 2, rgb(0, 0, 0), 1);
  // Word-wrap the headline crudely across two lines.
  dma->setTextColor(rgb(255, 255, 255));
  dma->setTextSize(1);
  dma->setCursor(2, 24);
  dma->print(headline.substring(0, 20));
  if (headline.length() > 20) {
    dma->setCursor(2, 40);
    dma->print(headline.substring(20, 40));
  }
  flip();
}

// A scrolling ("marquee") weather-alert card for long headlines. Pass an
// increasing scrollX each frame; short headlines are centered instead.
inline void weatherScroll(const String& headline, uint16_t severityColor, int scrollX) {
  clear();
  dma->fillRect(0, 0, MATRIX_W, 12, severityColor);
  centerText("WEATHER ALERT", 2, rgb(0, 0, 0), 1);
  dma->setTextColor(rgb(255, 255, 255));
  dma->setTextSize(1);
  const int y = 30;
  const int textW = (int)headline.length() * 6;
  if (textW <= MATRIX_W - 4) {
    centerText(headline.c_str(), y, rgb(255, 255, 255), 1);
  } else {
    dma->setCursor(MATRIX_W - scrollX, y);   // slides in from the right, exits left
    dma->print(headline);
  }
  flip();
}

// `color1` lets specific callers brand line1 (e.g. "AURA" in the app's amber);
// 0 keeps the default blue used for plain status headers ("WI-FI", "UPDATE").
inline void message(const char* line1, const char* line2, uint16_t color1 = 0) {
  clear();
  centerText(line1, 20, color1 ? color1 : rgb(56, 189, 248), 1);
  if (line2) centerText(line2, 40, rgb(160, 160, 160), 1);
  flip();
}

// A small (~14px) weather symbol drawn at top-left (x,y) of the clock card.
inline void wxIcon(int x, int y, int code, bool isDay) {
  // Sun/lightning use white instead of yellow/gold — R+G-mixed colors
  // (yellow, orange) are the ones showing the color-split/bleed issue on
  // this panel; white (and the blues/reds used elsewhere here) render solidly.
  const uint16_t sun = rgb(255, 255, 255), sunCore = rgb(210, 225, 255),
                 cloudLo = rgb(120, 128, 145), cloudHi = rgb(215, 220, 232),
                 rain = rgb(70, 150, 255), snow = rgb(225, 245, 255),
                 bolt = rgb(255, 255, 255), moon = rgb(225, 225, 190);
  int cx = x + 7, cy = y + 6;
  // Cloud with a darker outline + lighter body + highlight so it reads as a
  // rounded cloud, not a flat blob.
  auto drawCloud = [&](int ox, int oy) {
    int bx = cx + ox, by = cy + oy;
    dma->fillCircle(bx - 3, by + 1, 3, cloudLo);
    dma->fillCircle(bx + 3, by + 1, 3, cloudLo);
    dma->fillCircle(bx, by - 2, 4, cloudLo);
    dma->fillRect(bx - 6, by + 1, 13, 4, cloudLo);
    dma->fillCircle(bx - 3, by, 2, cloudHi);
    dma->fillCircle(bx + 3, by, 2, cloudHi);
    dma->fillCircle(bx, by - 2, 3, cloudHi);
    dma->fillRect(bx - 5, by, 10, 3, cloudHi);
    dma->fillCircle(bx - 1, by - 3, 1, rgb(245, 248, 255)); // highlight
  };
  auto drawSun = [&](int ox, int oy, int rad) {
    int sx = cx + ox, sy = cy + oy;
    for (int a = 0; a < 8; a++) {
      float r = a * PI / 4.0;
      dma->drawLine(sx + cos(r) * (rad + 1.5), sy + sin(r) * (rad + 1.5),
                    sx + cos(r) * (rad + 3), sy + sin(r) * (rad + 3), sun);
    }
    dma->fillCircle(sx, sy, rad, sun);
    dma->fillCircle(sx, sy, rad - 1, sunCore);
  };
  bool clear = (code == 0);
  bool partly = (code == 1 || code == 2);
  bool rainy = ((code >= 51 && code <= 67) || (code >= 80 && code <= 82));
  bool snowy = ((code >= 71 && code <= 77) || code == 85 || code == 86);
  bool storm = (code >= 95);
  if (clear) {
    if (isDay) drawSun(0, 0, 3);
    else { dma->fillCircle(cx, cy, 4, moon); dma->fillCircle(cx + 2, cy - 1, 4, rgb(0, 0, 0)); }
  } else if (partly) {
    if (isDay) drawSun(-3, -3, 2); else { dma->fillCircle(cx - 3, cy - 3, 3, moon); dma->fillCircle(cx - 1, cy - 4, 3, rgb(0, 0, 0)); }
    drawCloud(1, 2);
  } else if (storm) {
    drawCloud(0, -1);
    dma->fillTriangle(cx - 1, cy + 3, cx + 3, cy + 3, cx, cy + 7, bolt);
    dma->fillTriangle(cx, cy + 6, cx + 2, cy + 6, cx - 1, cy + 11, bolt);
  } else if (rainy) {
    drawCloud(0, -1);
    for (int i = -3; i <= 3; i += 3)
      dma->drawLine(cx + i, cy + 4, cx + i - 1, cy + 9, rain);
  } else if (snowy) {
    drawCloud(0, -1);
    for (int i = -3; i <= 3; i += 3) {
      dma->drawPixel(cx + i, cy + 6, snow);
      dma->drawPixel(cx + i, cy + 8, snow);
      dma->drawPixel(cx + i - 1, cy + 7, snow);
      dma->drawPixel(cx + i + 1, cy + 7, snow);
    }
  } else {
    drawCloud(0, 0); // overcast / fog
    dma->fillCircle(cx + 3, cy - 3, 2, cloudLo); // second puff = overcast
  }
}

// Clock + temperature card. Pass tempF = -999 if unavailable.
inline void clock(const String& timeStr, int tempF, uint16_t accent = 0,
                  int hiF = -999, int loF = -999, int feelsF = -999,
                  int wxCode = -1, bool isDay = true) {
  clear();
  if (accent) dma->drawRect(0, 0, MATRIX_W, MATRIX_H, accent);
  if (wxCode >= 0) wxIcon(3, 2, wxCode, isDay);
  dma->setTextSize(2);
  int16_t x1, y1; uint16_t w, h;
  dma->getTextBounds(timeStr.c_str(), 0, 0, &x1, &y1, &w, &h);
  dma->setCursor((MATRIX_W - (int)w) / 2, 14);
  dma->setTextColor(rgb(56, 189, 248));
  dma->print(timeStr);
  bool hasHiLo = (hiF > -999 && loF > -999);
  bool hasFeels = (feelsF > -999);
  bool hasSecondary = hasHiLo || hasFeels;
  if (tempF > -999) {
    char buf[12];
    snprintf(buf, sizeof(buf), "%d\xF7""F", tempF); // ÷ used as degree glyph fallback
    centerText(buf, hasSecondary ? 36 : 42, rgb(120, 170, 255), 1);
  }
  if (hasSecondary) {
    String sec;
    if (hasFeels) sec += "~" + String(feelsF) + " ";
    if (hasHiLo) sec += "H" + String(hiF) + " L" + String(loF);
    sec.trim();
    centerText(sec.c_str(), 51, rgb(160, 160, 160), 1);
  }
  flip();
}

// Blit an RGB565 logo bitmap (see Logos.h) at (x,y).
//
// Deliberately NOT using dma->drawRGBBitmap() here: on this user's panel it
// rendered red pixels as blue (and vice-versa) while every OTHER color path
// (fillScreen, drawRect, text via color565()/drawPixel()) rendered pure red
// correctly — confirmed with the app's "Flash test pattern". That isolates
// the bug to drawRGBBitmap()'s own internal handling of a PROGMEM uint16_t
// array, not a panel/wiring/signal-integrity problem. Blitting pixel-by-pixel
// through the SAME drawPixel() path everything else already uses correctly
// sidesteps it entirely, regardless of the exact internal cause.
inline void drawLogo(const uint16_t* bitmap, int w, int h, int x, int y) {
  if (!bitmap) return;
  for (int row = 0; row < h; row++) {
    for (int col = 0; col < w; col++) {
      uint16_t c = bitmap[row * w + col];
      if (c) dma->drawPixel(x + col, y + row, c);   // skip pure black (transparent bg)
    }
  }
}

} // namespace Display
