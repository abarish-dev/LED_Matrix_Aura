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
  // Many P2.5 128x64 panels use FM6126A driver ICs, which need a special
  // init or a block of LEDs stays stuck lit. If your panel goes blank/worse
  // after flashing, delete this one line to fall back to the generic driver.
  cfg.driver = HUB75_I2S_CFG::FM6126A;
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

// A single flight "card": callsign, airline, distance, altitude + heading + ETA.
inline void flight(const String& callsign, int distanceMi, const String& airline,
                   int altFt = 0, int headingDeg = -1,
                   uint16_t border = 0, int etaMin = -1) {
  clear();
  dma->drawRect(0, 0, MATRIX_W, MATRIX_H, border ? border : rgb(60, 40, 5));
  centerText(callsign.c_str(), 3, rgb(245, 158, 11), 1);
  centerText(airline.c_str(), 15, rgb(230, 230, 230), 1);
  char buf[28];
  snprintf(buf, sizeof(buf), "%d mi", distanceMi);
  centerText(buf, 28, rgb(160, 160, 160), 1);
  if (altFt > 0 || headingDeg >= 0) {
    if (headingDeg >= 0)
      snprintf(buf, sizeof(buf), "%dft %s", altFt, headingToCompass(headingDeg));
    else
      snprintf(buf, sizeof(buf), "%d ft", altFt);
    centerText(buf, 40, rgb(120, 170, 255), 1);
  }
  if (etaMin >= 0) {
    if (etaMin <= 10) snprintf(buf, sizeof(buf), "ARRIVING ~%dm", etaMin);
    else              snprintf(buf, sizeof(buf), "ETA ~%d min", etaMin);
    centerText(buf, 53, rgb(16, 185, 129), 1);
  }
  if (headingDeg >= 0) drawArrow(MATRIX_W - 12, 12, headingDeg, 7, rgb(245, 158, 11));
  flip();
}

// A "now landing / descending" alert card for a tracked flight.
inline void landing(const String& callsign, bool landed) {
  clear();
  dma->fillRect(0, 0, MATRIX_W, 14, rgb(16, 185, 129));
  centerText(landed ? "LANDED" : "DESCENDING", 3, rgb(0, 0, 0), 1);
  centerText(callsign.c_str(), 26, rgb(245, 158, 11), 1);
  centerText(landed ? "arrived" : "on approach", 46, rgb(200, 200, 200), 1);
  flip();
}

// A single game score "card".
inline void score(const String& home, int hs, const String& away, int as,
                   const String& status, uint16_t border = 0, const String& streak = "") {
  clear();
  if (border) dma->drawRect(0, 0, MATRIX_W, MATRIX_H, border);
  char l[24];
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

inline void message(const char* line1, const char* line2) {
  clear();
  centerText(line1, 20, rgb(245, 158, 11), 1);
  if (line2) centerText(line2, 40, rgb(160, 160, 160), 1);
  flip();
}

// A small (~14px) weather symbol drawn at top-left (x,y) of the clock card.
inline void wxIcon(int x, int y, int code, bool isDay) {
  const uint16_t sun = rgb(245, 200, 60), cloud = rgb(200, 200, 210),
                 rain = rgb(90, 150, 255), snow = rgb(180, 220, 255),
                 bolt = rgb(250, 220, 40), moon = rgb(220, 220, 180);
  int cx = x + 7, cy = y + 6;
  auto drawCloud = [&](uint16_t c) {
    dma->fillCircle(cx - 3, cy + 1, 3, c);
    dma->fillCircle(cx + 3, cy + 1, 3, c);
    dma->fillCircle(cx, cy - 1, 4, c);
    dma->fillRect(cx - 6, cy + 1, 12, 3, c);
  };
  bool clear = (code == 0);
  bool partly = (code == 1 || code == 2);
  bool rainy = ((code >= 51 && code <= 67) || (code >= 80 && code <= 82));
  bool snowy = ((code >= 71 && code <= 77) || code == 85 || code == 86);
  bool storm = (code >= 95);
  if (clear || partly) {
    if (isDay) {
      dma->fillCircle(cx, cy, 3, sun);
      for (int a = 0; a < 8; a++) {
        float r = a * PI / 4.0;
        dma->drawLine(cx + cos(r) * 5, cy + sin(r) * 5, cx + cos(r) * 7, cy + sin(r) * 7, sun);
      }
    } else {
      dma->fillCircle(cx, cy, 4, moon);
      dma->fillCircle(cx + 2, cy - 1, 4, rgb(0, 0, 0)); // crescent mask
    }
    if (partly) drawCloud(cloud);
  } else if (storm) {
    drawCloud(cloud);
    dma->drawLine(cx, cy + 4, cx - 2, cy + 8, bolt);
    dma->drawLine(cx - 2, cy + 8, cx + 1, cy + 8, bolt);
    dma->drawLine(cx + 1, cy + 8, cx - 1, cy + 11, bolt);
  } else if (rainy) {
    drawCloud(cloud);
    for (int i = -3; i <= 3; i += 3) dma->drawLine(cx + i, cy + 5, cx + i - 1, cy + 9, rain);
  } else if (snowy) {
    drawCloud(cloud);
    dma->drawPixel(cx - 3, cy + 7, snow);
    dma->drawPixel(cx, cy + 8, snow);
    dma->drawPixel(cx + 3, cy + 7, snow);
  } else {
    drawCloud(cloud); // overcast / fog / unknown
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
  dma->setTextColor(rgb(245, 158, 11));
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
inline void drawLogo(const uint16_t* bitmap, int w, int h, int x, int y) {
  if (!bitmap) return;
  dma->drawRGBBitmap(x, y, (uint16_t*)bitmap, w, h);
}

} // namespace Display
