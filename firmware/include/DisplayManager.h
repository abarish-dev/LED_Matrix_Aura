// ============================================================================
//  DisplayManager.h — HUB75 rendering via ESP32-HUB75-MatrixPanel-DMA.
//  Renders the boot screen, flights, sports scores and weather alerts on a
//  128x64 canvas. Keep draw routines small; the main loop cycles "cards".
// ============================================================================
#pragma once
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <Fonts/FreeSansBold9pt7b.h>
#include <Fonts/FreeMono9pt7b.h>
#include "Config.h"
#include "Logos.h"

namespace Display {

static MatrixPanel_I2S_DMA* dma = nullptr;

// 16-bit RGB565 helpers.
static uint16_t rgb(uint8_t r, uint8_t g, uint8_t b) {
  return dma->color565(r, g, b);
}

// AURA amber (#F59E0B), using the same RGB565 conversion on every card.
inline uint16_t brandAmber() { return rgb(245, 158, 11); }

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

inline void drawLogo(const uint16_t* bitmap, int w, int h, int x, int y);

// Center small text inside a reserved area, shortening long labels to fit.
inline void areaText(const String& value, int x, int width, int y, uint16_t color) {
  const int capacity = width / 6;
  String text = value;
  if ((int)text.length() > capacity)
    text = text.substring(0, capacity - 2) + "..";
  dma->setFont(nullptr);
  dma->setTextSize(1);
  dma->setTextWrap(false);
  dma->setTextColor(color);
  dma->setCursor(x + (width - (int)text.length() * 6) / 2, y);
  dma->print(text);
}

inline void centerText(const char* s, int y, uint16_t color, uint8_t size = 1) {
  int16_t x1, y1; uint16_t w, h;
  dma->setFont(nullptr);
  dma->setTextSize(size);
  dma->getTextBounds(s, 0, y, &x1, &y1, &w, &h);
  dma->setCursor((MATRIX_W - (int)w) / 2, y);
  dma->setTextColor(color);
  dma->print(s);
}


// Proportional type for short headings. Adafruit GFX custom fonts use a
 // baseline cursor; bounds provide the exact pixel width for centering.
inline void centerHeading(const char* value, int baseline, uint16_t color,
                          const GFXfont* font = &FreeSansBold9pt7b,
                          int left = 0, int width = MATRIX_W) {
  int16_t x1, y1; uint16_t w, h;
  dma->setFont(font);
  dma->setTextSize(1);
  dma->setTextWrap(false);
  dma->getTextBounds(value, 0, baseline, &x1, &y1, &w, &h);
  dma->setCursor(left + (width - (int)w) / 2 - x1, baseline);
  dma->setTextColor(color);
  dma->print(value);
  dma->setFont(nullptr);
}

inline void boot() {
  clear();
  // The same amber is used for short card headings and weather highlights.
  centerText("AURA", 20, brandAmber(), 2);
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
// a green "TRACKED" label and border distinguish it from nearby flights.
inline void flight(const String& callsign, int distanceMi, const String& airline,
                   int altFt = 0, int headingDeg = -1,
                   uint16_t border = 0, int etaMin = -1,
                   const String& origin = "", const String& dest = "",
                   bool tracked = false, const LogoAsset* logo = nullptr) {
  clear();
  if (tracked) dma->drawRect(0, 0, MATRIX_W, MATRIX_H,
                             border ? border : rgb(16, 185, 129));
  String texts[7]; uint16_t cols[7]; int nl = 0;
  char buf[28];
  if (tracked) { texts[nl] = "* TRACKED *"; cols[nl++] = rgb(16, 185, 129); }
  texts[nl] = callsign;          cols[nl++] = brandAmber();
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
  if (logo) {
    drawLogo(logo->data, logo->w, logo->h, 2, (MATRIX_H - logo->h) / 2);
    for (int i = 0; i < nl; i++)
      areaText(texts[i], 30, MATRIX_W - 32, startY + i * LH, cols[i]);
    if (headingDeg >= 0) drawArrow(14, 53, headingDeg, 6, rgb(56, 189, 248));
  } else {
    for (int i = 0; i < nl; i++)
      centerText(texts[i].c_str(), startY + i * LH, cols[i], 1);
    if (headingDeg >= 0) drawArrow(MATRIX_W - 12, 12, headingDeg, 7, rgb(56, 189, 248));
  }
  flip();
}

// A "now landing / descending" alert card for a tracked flight.
inline void landing(const String& callsign, bool landed) {
  clear();
  dma->fillRect(0, 0, MATRIX_W, 14, rgb(16, 185, 129));
  centerText(landed ? "LANDED" : "DESCENDING", 3, rgb(0, 0, 0), 1);
  centerText(callsign.c_str(), 26, brandAmber(), 1);
  centerText(landed ? "arrived" : "on approach", 46, rgb(200, 200, 200), 1);
  flip();
}

// A single game score "card". When `isRecord` is true (off-season / no game
// within the normal window), `home`/`away` are just team/opponent abbreviations
// (no meaningful score yet) and `record` + `status` carry the season record
// and next-game date instead.
inline void score(const String& home, int hs, const String& away, int as,
                   const String& status, uint16_t border = 0, const String& streak = "",
                   bool isRecord = false, const String& record = "",
                   const LogoAsset* homeLogo = nullptr, const LogoAsset* awayLogo = nullptr) {
  clear();
  if (border) dma->drawRect(0, 0, MATRIX_W, MATRIX_H, border);
  char l[24];
  if (isRecord) {
    if (homeLogo) drawLogo(homeLogo->data, homeLogo->w, homeLogo->h, 2, 1);
    centerText(home.c_str(), 8, brandAmber(), 1);
    // Center both lines across the panel; put the record below the logo so
    // its text never overlaps the graphic at the upper left.
    if (record.length()) centerText(record.c_str(), 27, rgb(56, 189, 248), 1);
    String nextLine = away.length() ? ("Next: " + away) : String("Next game");
    centerText(nextLine.c_str(), 40, rgb(200, 200, 200), 1);
    centerText(status.c_str(), 52, rgb(16, 185, 129), 1);
    flip();
    return;
  }
  const bool hasLogos = homeLogo || awayLogo;
  const int textLeft = hasLogos ? 30 : 0;
  const int textWidth = hasLogos ? MATRIX_W - 32 : MATRIX_W;
  if (awayLogo) drawLogo(awayLogo->data, awayLogo->w, awayLogo->h, 2, 1);
  if (homeLogo) drawLogo(homeLogo->data, homeLogo->w, homeLogo->h, 2, 26);
  snprintf(l, sizeof(l), "%s %d", away.c_str(), as);
  centerHeading(l, 20, brandAmber(), &FreeMono9pt7b, textLeft, textWidth);
  snprintf(l, sizeof(l), "%s %d", home.c_str(), hs);
  centerHeading(l, hasLogos ? 45 : 40, brandAmber(), &FreeMono9pt7b, textLeft, textWidth);
  centerText(status.c_str(), hasLogos ? 54 : 46, rgb(16, 185, 129), 1);
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

// Next UFC event "card" — text-only (no fighter photos), consistent with the
// other simple info cards. Uses the same colored-bar pattern as weather().
inline void ufc(const String& name, const String& date, const String& headline) {
  clear();
  dma->fillRect(0, 0, MATRIX_W, 12, rgb(239, 68, 68));
  centerText("UFC FIGHT NIGHT", 2, rgb(0, 0, 0), 1);
  centerText(name.c_str(), 24, rgb(255, 255, 255), 1);
  if (headline.length()) centerText(headline.c_str(), 40, rgb(200, 200, 200), 1);
  centerText(date.c_str(), 54, rgb(239, 68, 68), 1);
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

// 20x20 weather symbols on the clock card. All drawing is local to (x,y)
// and stays left of the centered time. Open-Meteo codes: 0 clear, 1-3 cloud,
// 45-48 fog, 51-67 drizzle/rain, 71-77 snow, 80-82 showers, 95+ storms.
inline void wxIcon(int x, int y, int code, bool isDay) {
  const uint16_t sun = brandAmber(), moon = rgb(210, 200, 255),
                 cloud = rgb(150, 169, 191), highlight = rgb(230, 239, 250),
                 rain = rgb(48, 176, 255), snow = rgb(245, 250, 255),
                 bolt = brandAmber(), fog = rgb(126, 155, 178);
  const bool clear = code == 0;
  const bool partly = code == 1 || code == 2;
  const bool foggy = code == 45 || code == 48;
  const bool wet = (code >= 51 && code <= 67) || (code >= 80 && code <= 82);
  const bool snowy = (code >= 71 && code <= 77) || code == 85 || code == 86;
  const bool storm = code >= 95;

  auto sky = [&](int cx, int cy, bool small) {
    if (isDay) {
      int r = small ? 3 : 4;
      dma->fillCircle(cx, cy, r, sun);
      for (int i = 0; i < 8; ++i) {
        float theta = i * PI / 4.0f;
        dma->drawPixel(cx + round(cos(theta) * (r + 3)),
                       cy + round(sin(theta) * (r + 3)), sun);
      }
    } else {
      dma->fillCircle(cx, cy, small ? 4 : 6, moon);
      dma->fillCircle(cx + 2, cy - 2, small ? 4 : 6, rgb(0, 0, 0));
    }
  };
  auto clouds = [&](int offsetY) {
    dma->fillRoundRect(x + 2, y + offsetY + 8, 17, 7, 3, cloud);
    dma->fillCircle(x + 8, y + offsetY + 8, 5, cloud);
    dma->fillCircle(x + 14, y + offsetY + 8, 4, cloud);
    dma->drawFastHLine(x + 4, y + offsetY + 13, 13, highlight);
    dma->drawPixel(x + 7, y + offsetY + 5, highlight);
    dma->drawPixel(x + 8, y + offsetY + 4, highlight);
  };
  if (clear) {
    sky(x + 10, y + 10, false);
  } else if (partly) {
    sky(x + 7, y + 7, true);
    clouds(1);
  } else if (storm) {
    clouds(-2);
    dma->fillTriangle(x + 11, y + 12, x + 16, y + 12, x + 12, y + 18, bolt);
    dma->drawLine(x + 12, y + 18, x + 9, y + 19, bolt);
  } else if (wet) {
    clouds(-3);
    for (int i = 5; i <= 17; i += 6)
      dma->drawLine(x + i, y + 14, x + i - 2, y + 18, rain);
  } else if (snowy) {
    clouds(-3);
    for (int i = 5; i <= 17; i += 6) {
      dma->drawPixel(x + i, y + 15, snow);
      dma->drawPixel(x + i - 1, y + 17, snow);
    }
  } else if (foggy) {
    clouds(-3);
    dma->drawFastHLine(x + 2, y + 16, 16, fog);
    dma->drawFastHLine(x + 5, y + 19, 12, fog);
  } else {
    clouds(0);
  }
}

// Clock + temperature card. Pass tempF = -999 if unavailable.
inline void clock(const String& timeStr, int tempF, uint16_t accent = 0,
                  int hiF = -999, int loF = -999, int feelsF = -999,
                  int wxCode = -1, bool isDay = true) {
  clear();
  if (accent) dma->drawRect(0, 0, MATRIX_W, MATRIX_H, accent);
  if (wxCode >= 0) wxIcon(3, 2, wxCode, isDay);
  centerHeading(timeStr.c_str(), 30, brandAmber(), &FreeSansBold9pt7b);
  bool hasHiLo = (hiF > -999 && loF > -999);
  bool hasFeels = (feelsF > -999);
  bool hasSecondary = hasHiLo || hasFeels;
  if (tempF > -999) {
    char buf[12];
    snprintf(buf, sizeof(buf), "%d F", tempF);
    centerHeading(buf, hasSecondary ? 46 : 51, rgb(120, 170, 255), &FreeMono9pt7b);
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
// Use the same per-pixel RGB565 path exercised by flashLogoTest. The old
// hardware showed color artifacts through multiple drawing paths; the new
// panel/controller completed the logo test on its dedicated 5V supply.
// Do not swap channels or recolor the source assets based on camera footage.
inline void drawLogo(const uint16_t* bitmap, int w, int h, int x, int y) {
  if (!bitmap) return;
  for (int row = 0; row < h; row++) {
    for (int col = 0; col < w; col++) {
      uint16_t c = bitmap[row * w + col];
      if (c) dma->drawPixel(x + col, y + row, c);   // skip pure black (transparent bg)
    }
  }
}

 
// The app's flash test also exercises the exact RGB565 bitmap drawing path.
// A solid-color fill alone cannot confirm that a logo array has the right
// channel order. Show one known airline asset between RGB reference squares.
inline void flashLogoTest(const uint16_t* bitmap, int w, int h) {
  if (!bitmap) return;
  clear();
  dma->fillRect(5, 7, 12, 12, rgb(255, 0, 0));
  dma->fillRect(5, 26, 12, 12, rgb(0, 255, 0));
  dma->fillRect(5, 45, 12, 12, rgb(0, 0, 255));
  dma->fillRect(MATRIX_W - 17, 26, 12, 12, brandAmber());
  drawLogo(bitmap, w, h, (MATRIX_W - w) / 2, (MATRIX_H - h) / 2);
  centerText("RGB565 LOGO", 53, rgb(255, 255, 255), 1);
  flip();
  delay(2500);
  clear();
  flip();
}

} // namespace Display
