# Aura — Smart LED Matrix Companion (128×64 HUB75)

## Original Problem Statement
Rebuild from scratch a mobile companion app for a **larger** LED matrix wall
display. Hardware: **Adafruit MatrixPortal ESP32-S3**, HUB75 128×64 panel,
Arduino framework. Features: **Flights** (overhead air traffic, FlightWall-style),
**Sports** (NFL/NBA/MLB/NHL + UFC) with airline/team logos, **local weather
alerts & warnings**. Connectivity: **BLE** (phone → matrix setup) + **Wi-Fi**
(matrix fetches live data itself). Fresh design direction.

## Architecture
- **Frontend:** Expo Router, bottom-tab navigation (Device / Flights / Sports /
  Weather) + a global **SYNC** FAB.
- **State:** `src/store/matrix.tsx` React context — settings + BLE state,
  persisted to AsyncStorage (`aura_settings_v1`, `aura_last_ssid`).
- **BLE:** `src/services/ble.ts` (`react-native-ble-plx`, native-only, guarded so
  the app boots on web/Expo Go). Service `4fafc201-…`, char `beb5483e-…`.
- **Design:** "Aura" — Dark-First Utility, zinc surfaces + amber (#f59e0b) accent,
  Barlow Condensed (display) + IBM Plex Sans (body). Tokens in
  `/app/design_guidelines.json`; mirrored in `src/theme.ts`.

## Data sources (matrix fetches over Wi-Fi — all keyless)
- Flights: `api.adsb.lol` (nearest ADS-B aircraft).
- Sports: ESPN public JSON (NFL/NBA/MLB/NHL scoreboards).
- Weather: `api.weather.gov` (US NWS active alerts).
- ZIP → lat/lon: `api.zippopotam.us` (`src/services/geocode.ts`).

## Screens
- **Device (Home):** connection status pill (tap to connect/disconnect over BLE),
  signal bars, flash-test, Wi-Fi setup form (SSID/password + send + live
  join-status banner).
- **Flights:** master toggle, ZIP location (geocoded), search-radius slider.
- **Sports:** master toggle, league segmented control (NFL/NBA/MLB/NHL/UFC),
  colored team-badge grid (multi-select), UFC toggle card.
- **Weather:** master toggle, location note (uses Flights ZIP), severity radio
  cards (minor/moderate/severe/extreme).

## Firmware (`/app/firmware/`, PlatformIO)
MatrixPortal S3 starter: `platformio.ini`, `include/{Config,BleProvisioning,
DataServices,DisplayManager}.h`, `src/main.cpp`, `README.md`. NimBLE receiver +
Wi-Fi fetch (adsb.lol/ESPN/NWS) + HUB75 DMA card rotation. BLE contract in
`/app/FIRMWARE_BLE_SPEC.md`.

## Implemented (2026-06 — fresh build)
- [x] Full 4-tab app with fresh Aura design, global SYNC FAB.
- [x] BLE connect/disconnect, live-push per section, full sync + read-back,
      Wi-Fi provisioning with notify-based join status, flash test.
- [x] Team catalog for NFL/NBA/MLB/NHL (~120 teams w/ colors) in `src/data/teams.ts`.
- [x] Local persistence + hydration.
- [x] MatrixPortal S3 firmware starter + BLE spec.

## Notes / Constraints
- **BLE requires a real device build** — not Expo Go / web preview (UI shows a
  helper hint there; everything else is fully configurable).
- Firmware compiles in the user's VS Code/PlatformIO; not built in this env.
- Airline/team logos on the matrix are text stubs pending bitmap assets.

## Updates (2026-06 — enhancement round)
- [x] **Logo Pack**: real ESPN team logos on Sports cards + rotation rows (`teamLogoUrl` in `src/data/teams.ts`, layered over colored badge with text fallback). Firmware `include/Logos.h` scaffolding + `Display::drawLogo` for embedded RGB565 team/airline bitmaps.
- [x] **Brightness Control**: Device-tab slider (5–100%), persisted + live `{command:"brightness",value}`; firmware `Display::setBrightness` maps to `setBrightness8`.
- [x] **Flight Details**: firmware now fetches `alt_baro` + `track` from adsb.lol and the flight card shows altitude + compass heading.
- [x] **Team Reorder**: Sports tab is a `DraggableFlatList` — hold & drag followed teams to set matrix rotation order (array order = rotation order); X to remove. Persists.
- [x] **Weather Test**: Weather-tab "Preview Alert on Matrix" button → `{command:"weather_test"}`; firmware flashes a sample severe-storm card.
- All verified via testing_agent iteration_9 (frontend). BLE remains device-build-only.

## Updates (2026-06 — round 2 enhancements)
- [x] **Real logo bitmaps embedded**: `firmware/tools/generate_logos.py` downloads 123 team + 12 airline logos, converts to 16×16 RGB565, writes `include/logos/generated_logos.h`; `Logos.h` exposes `teamLogo()/airlineLogo()`; blitted on the flight + score cards.
- [x] **Score preview**: Sports rotation rows show a live ESPN score/matchup line per team (`src/services/espn.ts`, keyless, cached; graceful fallback). NOTE: ESPN is CORS-blocked in web preview so it only shows on a native device build.
- [x] **UFC card**: UFC segment shows the next event name/date/headline fight (`getNextUfc`), with loading + empty states.
- [x] **Night Dimming**: Device-tab schedule (toggle + From/To hour steppers + dim-level slider); firmware syncs NTP time (`TZ_INFO`) and auto-dims within the window.
- [x] **Track a Specific Flight**: Flights-tab toggle + callsign input to pin one flight (family travel); firmware uses adsb.lol `/v2/callsign/<ident>`.
- [x] **Fixed** user-reported bug: Sports league row was a horizontal ScrollView (UFC cut off, no mouse-drag) → now a fixed equal-width row; all 5 leagues always visible.
- All verified via testing_agent iteration_10 (frontend). Settings persist in `aura_settings_v1`.

## Updates (2026-06 — round 3 enhancements)
- [x] **Flight Path arrow**: firmware `Display::drawArrow` draws a heading arrow on the tracked-flight card (0°=N, clockwise).
- [x] **Landing Alert**: `flights.landingAlert` toggle (Flights tab); firmware watches the tracked flight's altitude and flashes a "DESCENDING/LANDED" card on a sharp drop / very-low altitude.
- [x] **Team Score Colors**: Sports rotation rows tint green (winning) / red (losing) with a left accent bar + colored score, driven by the ESPN score line (device-only — CORS-blocked in web preview).
- [x] **Weekend Mode**: `nightMode.weekend` second dimming schedule (Device tab, `updateWeekend`); firmware uses it on Sat/Sun (NTP `tm_wday`).
- All verified via testing_agent iteration_11 (frontend). Persist in `aura_settings_v1`.

## Backlog
- **P2:** Panel geometry auto-detect.
- **P3:** Proxy ESPN through backend so score preview shows in web preview too; slider a11y (aria-value*).
