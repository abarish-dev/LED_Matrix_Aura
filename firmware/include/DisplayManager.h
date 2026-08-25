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
  cfg.double_buff = true;
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

// A single flight "card": callsign, airline, distance, altitude + heading.
inline void flight(const String& callsign, int distanceMi, const String& airline,
                   int altFt = 0, int headingDeg = -1) {
  clear();
  dma->drawRect(0, 0, MATRIX_W, MATRIX_H, rgb(60, 40, 5));
  centerText(callsign.c_str(), 4, rgb(245, 158, 11), 1);
  centerText(airline.c_str(), 18, rgb(230, 230, 230), 1);
  char buf[28];
  snprintf(buf, sizeof(buf), "%d mi", distanceMi);
  centerText(buf, 34, rgb(160, 160, 160), 1);
  if (altFt > 0 || headingDeg >= 0) {
    if (headingDeg >= 0)
      snprintf(buf, sizeof(buf), "%dft %s", altFt, headingToCompass(headingDeg));
    else
      snprintf(buf, sizeof(buf), "%d ft", altFt);
    centerText(buf, 48, rgb(120, 170, 255), 1);
  }
  flip();
}

// A single game score "card".
inline void score(const String& home, int hs, const String& away, int as,
                   const String& status) {
  clear();
  char l[24];
  snprintf(l, sizeof(l), "%s %d", away.c_str(), as);
  centerText(l, 8, rgb(255, 255, 255), 1);
  snprintf(l, sizeof(l), "%s %d", home.c_str(), hs);
  centerText(l, 26, rgb(255, 255, 255), 1);
  centerText(status.c_str(), 46, rgb(16, 185, 129), 1);
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

inline void message(const char* line1, const char* line2) {
  clear();
  centerText(line1, 20, rgb(245, 158, 11), 1);
  if (line2) centerText(line2, 40, rgb(160, 160, 160), 1);
  flip();
}

// Blit an RGB565 logo bitmap (see Logos.h) at (x,y).
inline void drawLogo(const uint16_t* bitmap, int w, int h, int x, int y) {
  if (!bitmap) return;
  dma->drawRGBBitmap(x, y, (uint16_t*)bitmap, w, h);
}

} // namespace Display
