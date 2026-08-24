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

## Backlog
- **P2:** Bundle airline + team logo bitmaps into firmware and blit them.
- **P2:** Panel geometry auto-detect / in-app brightness control.
- **P3:** UFC event details card in-app; per-team score preview.
