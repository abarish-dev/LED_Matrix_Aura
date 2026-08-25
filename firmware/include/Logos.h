// ============================================================================
//  Logos.h — airline + team logo assets for the matrix.
//
//  HUB75 panels can't decode PNG/SVG at runtime cheaply, so logos are stored as
//  pre-converted RGB565 bitmaps (uint16_t arrays) and blitted with
//  Display::drawLogo(). This header is the registry + lookup; drop generated
//  arrays into `logos/` and register them below.
//
//  ── How to add a logo ──────────────────────────────────────────────────────
//  1. Grab the artwork:
//       Teams   : https://a.espncdn.com/i/teamlogos/<league>/500/<abbr>.png
//       Airlines: any square PNG of the airline mark
//  2. Resize to a matrix-friendly size (16x16, 20x20 or 24x24) and convert to
//     an RGB565 C array. Easy options:
//       • https://lvgl.io/tools/imageconverter  (output: "C array", RGB565)
//       • ImageMagick + a short script, or the `image2cpp` web tool.
//  3. Save as `logos/dal_16.h` containing:
//       static const uint16_t DAL_16[16*16] = { 0x0000, ... };
//  4. #include it here and add a row to TEAM_LOGOS / AIRLINE_LOGOS.
//
//  Until you add assets, lookups return nullptr and the display falls back to
//  the text badge (callsign / abbreviation), which always works.
// ============================================================================
#pragma once
#include <Arduino.h>

struct LogoAsset {
  const char*     key;    // "NFL:DAL" for teams, "AAL" (ICAO) for airlines
  const uint16_t* data;   // RGB565 pixels, row-major
  uint8_t         w;
  uint8_t         h;
};

// ---- Example (commented; uncomment once you generate a real array) ---------
// #include "logos/dal_16.h"
// static const LogoAsset TEAM_LOGOS[] = {
//   { "NFL:DAL", DAL_16, 16, 16 },
// };

static const LogoAsset TEAM_LOGOS[]    = {};   // add rows here
static const LogoAsset AIRLINE_LOGOS[] = {};   // add rows here

static const LogoAsset* findLogo(const LogoAsset* table, size_t n, const String& key) {
  for (size_t i = 0; i < n; i++)
    if (key.equalsIgnoreCase(table[i].key)) return &table[i];
  return nullptr;
}

inline const LogoAsset* teamLogo(const String& league, const String& abbr) {
  return findLogo(TEAM_LOGOS, sizeof(TEAM_LOGOS) / sizeof(LogoAsset),
                  league + ":" + abbr);
}

inline const LogoAsset* airlineLogo(const String& icao) {
  return findLogo(AIRLINE_LOGOS, sizeof(AIRLINE_LOGOS) / sizeof(LogoAsset), icao);
}
