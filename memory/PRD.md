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

## Updates (2026-06 — round 4)
- [x] **Overhead Now panel** (Flights tab, above the toggle): live nearest aircraft with airline logo, callsign + airline, origin→destination, altitude, distance & heading. Positions via `adsb.lol`, airline/route via `adsbdb.com` (CORS-ok), logos via gstatic. Auto-refreshes every 20s. `src/services/adsb.ts`. NOTE: adsb.lol has no CORS header so the live list only resolves on a native device; web preview shows a graceful fallback.
- Verified via testing_agent iteration_13 (frontend), no regressions.

## Updates (2026-06 — round 5)
- [x] **Active Alerts panel** (Weather tab, above the toggle): live NWS alerts for the user's location, each with severity chip + colored accent, short area, and expiry; sorted most-severe first. Shows a compact "No active alerts" line when clear, nothing before a ZIP is set. Auto-refreshes every 60s. `src/services/weather.ts` (api.weather.gov, keyless + CORS so it works in web too).
- Verified via testing_agent iteration_14 (single/multiple/clear/no-ZIP states + regression).

## Updates (2026-06 — round 6)
- [x] **Alert Detail**: tap any active alert → slide-up sheet with full NWS DETAILS description + WHAT TO DO instructions (scrollable). `activeAlerts` now returns id/description/instruction.
- [x] **County line**: Weather tab shows the user's county (+city) at top via `locationInfo()` (NWS /points + county zone).
- [x] **Alert Chime**: `weather.alertSound` toggle plays a bundled chime (`assets/sounds/alert.wav`, expo-audio) + haptic + toast on a NEW Severe/Extreme alert; first load seeded silently. Phone-only (not pushed to matrix).
- Verified via testing_agent iteration_15 (frontend), no regressions.

## Updates (2026-06 — round 7)
- [x] **Quiet Chime Hours**: `weather.quietHours {enabled,startHour,endHour}` (store.updateQuietHours). During the window only Extreme alerts chime; Severe suppressed (`isQuietNow`, midnight-wrap). UI under Alert Chime with From/To steppers.
- [x] **Multi-Location**: `weather.secondLocation {zip,lat,lon,city,state}` (store.updateSecondLocation). ZIP geocoded; second town's NWS alerts fetched + listed in a "Second Location" card, tappable into the shared detail sheet. Chime runs for both locations (separate seen-sets).
- Verified via testing_agent iteration_16 (frontend), all persist, no regressions.

## Backlog
- **P2:** Panel geometry auto-detect.
- **P3:** Proxy adsb.lol/ESPN through backend for web parity; add testIDs to Weather elements; migrate shadow*/pointerEvents (SyncFab) & useNativeDriver (Toast) for web.

## Updates (2026-06 — round 8)
- [x] **Splash → Chevron match**: `app.json` splash `backgroundColor` set to `#14171d` (light+dark) to match the glowing-chevron app icon. Generated a transparent matrix-dot chevron `assets/images/splash-image.png` from the icon via `tools/make_splash.py` (luminance+warmth knockout). App icon stays the original glowing chevron.
- [x] **Summary tab (5th tab, "grid" icon)**: `app/(tabs)/summary.tsx` — calm live-glance dashboard branded with the chevron logo. Shows connection status pill, nearest overhead flight, favorite team (`sports.teams[0]`) score, current temp + rain, active weather alert, and Quick Controls (Settings / Flash Test / Alerts). Pull-to-refresh; 30s auto-refresh. Device tab kept unchanged as the landing screen.
- [x] **Current conditions service**: `services/weather.ts` → `currentConditions(lat,lon)` via Open-Meteo (keyless + CORS, works in web preview). Returns tempF, WMO code→label/icon, isRaining, today's rainChance.
- Weather glance verified live in web preview (Open-Meteo). Flights/scores glances are native-only (adsb.lol/ESPN CORS), consistent with existing tabs.

## Updates (2026-06 — round 9)
- [x] **Set As Home**: app now lands on the Summary tab — `app/(tabs)/index.tsx` is Summary; former Device controls moved to `app/(tabs)/device.tsx`. Tab order Summary · Device · Flights · Sports · Weather (`_layout.tsx`). Summary router links point to `/device`.
- [x] **Live Countdown**: 1-second ticker on Summary. Header "Ns" pill counts down to the next 30s auto-refresh; favorite team pre-game shows "Starts in 3h 12m"; no-plane state shows "rescanning in Ns".
- [x] **Tap To Track**: tapping the Overhead card pins that flight (`flights.trackFlight/flightIdent/autoTracked` via `updateFlights`, live-pushed to firmware). Shows a "TRACKING" tag; auto-reverts when the pinned callsign leaves range (miss-counter, only counts when other planes are visible so web's empty ADS-B won't false-trigger). New `flights.autoTracked` field in store.
- [x] **Favorite Star**: gold star on Sports rotation rows sets `sports.favorite` (new store field + `setFavoriteTeam`); that team leads the Summary Sports glance and shows a "SUMMARY" tag. Rivalry flag moved to a distinct flame icon. Removing a team clears its favorite.
- [x] **New logo (Sunburst)**: amber glowing sun + airplane + trophy mashup replaces the chevron. Applied to `icon.png`, `adaptive-icon.png` (bg `#14171d`), `favicon.png`; transparent glowing version drives `splash-image.png` + the Summary header. Generated via `tools/gen_logo.py` (gpt-image-1) + `tools/apply_logo.py`.

## Updates (2026-06 — round 10)
- [x] **Reorder Glances (drag)**: Summary cards are drag-to-reorder. Switched from `react-native-draggable-flatlist` (broken with Reanimated 4) to **`react-native-reorderable-list` 0.18.1** (`ReorderableList` + `useReorderableDrag`/`useIsActive` + `reorderItems`). Order persists to AsyncStorage `aura_summary_order_v1`. Verified on web: drag Weather→top persisted across reload.
- [x] **Landing Alert Glance**: when the pinned flight is descending (`vertRateFpm <= -300`), a "Descending"/"Landing soon" card appears atop Summary (state = 'landing' if alt < 3000ft). New `vertRateFpm` field on `adsb.ts` Plane (from `baro_rate`/`geom_rate`). Native-only (needs live ADS-B).
- [x] **Team Record**: favorite team's overall W-L record shown as a chip on the Summary Sports glance. New `record` on `espn.ts` ScoreLine (competitor `records[].summary`). Native-only (ESPN CORS-blocked on web).

## Updates (2026-06 — round 11)
- [x] **Approach ETA**: landing-alert card now shows "lands in ~N min" (N = altFt ÷ |vertRateFpm|, clamped ≤90) as the pinned flight descends; falls back to "approaching". `LandingInfo.etaMin`.
- [x] **Streak Badge**: W/L streak chip (e.g. "W3"/"L2", green/red) next to the record on the Summary Sports glance. New `espn.ts` `getTeamStreak(league, teamId)` reads `team.record.items[0].stats[streak]`; `ScoreLine.teamId` added. Native-only (ESPN CORS on web).
- [x] **Collapse Cards**: each Summary glance has an eye-off button to hide it; hidden cards move to a "Hidden Cards" footer section with a tap-to-restore chip. Persists to AsyncStorage `aura_summary_hidden_v1`. Reorder logic preserves hidden cards' slots. Verified on web: hide→restore→persist all work.

## Updates (2026-06 — round 12)
- [x] **Streak On Wall**: new `sports.showStreak` toggle (Sports tab) is included in the BLE full-sync + live `sports` push. Firmware: `SportsCfg.showStreak`, `ScoreInfo.streak`, `Data::teamStreak(path,id)` + `teamGame(...,wantStreak)`, and `Display::score(...,streak)` renders "W3"/"L2" (green/red) top-right of the score card. Also fixed a pre-existing firmware bug where the `teamGame` signature was merged into its comment line. Native/device-only.
- [x] **Quiet Landing Chime**: new `flights.landingChime` toggle (Flights tab). Summary plays a soft chime (expo-audio, `assets/sounds/alert.wav`) once when a pinned flight first transitions to "landing soon" (state === 'landing'), gated by the toggle + a transition ref. Native-only playback.
- [x] **Compact Mode**: toggle button in the Summary "On The Wall Now" row shrinks all glance cards to tight one-line rows (hides secondary meta/hint lines, smaller padding). Persists to AsyncStorage `aura_summary_compact_v1`. Verified on web incl. persistence.

## Updates (2026-06 — round 13)
- [x] **Second Team Glance**: refactored `sports.favorite` → `sports.favorites: string[]` (max 2, with legacy migration in hydrate). Sports-tab star now toggles membership: favorites[0] = "SUMMARY" (primary glance), favorites[1] = "2ND" (mini row). `setFavoriteTeam` → `toggleFavorite`. Summary renders a slim second-team mini score row (badge + score + streak chip + status) beneath the Sports card, tappable → Sports. Verified on web (row + tags render; scores native-only).
- [x] **Auto Compact**: when total shown items > 3 (i.e. a 2nd team's mini row is present alongside 3 cards), Summary auto-switches to compact and shows an "Auto-compact · 4+ cards" hint with the manual toggle disabled. `effCompact = compact || autoCompact`. Verified on web.

## Updates (2026-06 — round 14)
- [x] **Weather Hi/Lo**: `currentConditions` now requests Open-Meteo `temperature_2m_max/min`; `CurrentWx.hiF/loF`. Summary Weather glance shows an "H84° L63°" chip on the value row (always visible, incl. compact). Verified live on web.
- [x] **Streak Preview**: Sports tab shows a "Wall Preview" — a 2:1 black matrix-style mock of the LED score card (mono font, away/home + scores, green status, W/L streak top-right when enabled) for your primary starred team. New `WallPreview` component fetches `getTeamScore` + `getTeamStreak`. Verified on web (layout renders; live scores/streak fill in on device).

## Updates (2026-06 — round 15)
- [x] **Feels-Like Temp**: `currentConditions` requests Open-Meteo `apparent_temperature`; `CurrentWx.feelsF`. Summary Weather meta shows "Feels N°" when it differs from actual by ≥3°. Verified live on web.
- [x] **Weather Hi/Lo On Wall**: new `weather.showHiLo` toggle (Weather tab, nested under Time & Temperature) sent in BLE full-sync + live `weather` push. Firmware: `WeatherCfg.showHiLo`, `Data::dailyHiLo(lat,lon,&hi,&lo)` (Open-Meteo), globals `gHiF/gLoF` fetched when showClock+showHiLo, and `Display::clock(...,hiF,loF)` draws "H84 L63" under the temp. BLE `applyWeather` reads `showHiLo`. Device-only rendering.

## Updates (2026-06 — round 16)
- [x] **Feels-Like On Wall**: new `weather.showFeels` toggle (Weather tab, nested) in BLE full-sync + live `weather` push. `currentConditions` already returns `feelsF`; firmware `currentTempF(lat,lon,&feels)` now also fetches `apparent_temperature`, global `gFeelsF`, and `Display::clock` renders a combined secondary line "~83 H84 L63" (feels + hi/lo). BLE `applyWeather` reads `showFeels`. Device-only rendering.
- [x] **Weather Icon On Summary**: Summary Weather glance icon + accent now track live conditions (day/night aware): `wxGlyph(code,isDay)` → sunny/moon/partly-sunny/cloudy-night/cloudy/cloud/rainy/snow/thunderstorm, `wxAccent(code)` → amber(sun)/slate(cloud)/blue(rain)/purple(storm)/light-blue(snow). Added `CurrentWx.isDay` (Open-Meteo `is_day`). Verified on web (clear → sun + amber).

## Updates (2026-06 — round 17)
- [x] **Weather Icon On Wall**: new `weather.showWxIcon` toggle (Weather tab, nested) in BLE full-sync + live `weather` push. Firmware: `currentTempF(...,&code,&isDay)` now fetches `weather_code,is_day`; new `Display::wxIcon(x,y,code,isDay)` draws a ~14px sun/moon/partly/cloud/rain/snow/storm symbol at top-left of the clock card; `Display::clock(...,wxCode,isDay)` renders it; globals `gWxCode/gIsDay`; BLE `applyWeather` reads `showWxIcon`. Device-only rendering. Verified toggle renders on web.
- Card transitions: user chose to KEEP the instant hard-cut (no fade/scroll) — firmware unchanged (`flipDMABuffer` swap every `CARD_MS`=8s).

## Updates (2026-06 — round 18)
- [x] **Distinct identity for coexisting installs**: to let the pre-fork build and this fork live on the same phone, changed `app.json` → `name: "Aura 2"`, `scheme: "auratwo"`, and `android.package`/`ios.bundleIdentifier` `com.emergent.bluetoothledsync.hltjsu` → `com.emergent.auratwo.hltjsu`. Regression smoke test (iteration_19) PASS — boot, all 5 tabs, geocode, weather glance, persistence intact.
- [x] **Build-flow icon fix**: app icon assets (`icon.png`/`adaptive-icon.png`/`favicon.png`) recompressed to 512² ~230KB (was ~1.1MB, over the build-form 1MB upload cap). Added backend route `GET /api/app-icon.png` (`FileResponse` of `backend/app_icon.png`) so the user can save the Sunburst icon on their phone and upload it via the build dialog's "App icon → Change" field (that field is separate from app.json and was cached to the old chevron).

## Updates (2026-06 — round 19)
- [x] **Bottom cutoff fix (all tabs)**: content was hidden behind the tab bar + floating Sync FAB on taller phones (fixed `paddingBottom: 150`). Added `useSafeAreaInsets` and set each scroll container's `contentContainerStyle` paddingBottom to `insets.bottom + 190` on Flights, Sports, Weather, Device, and the Summary list. Verified (iteration_20) on all 5 tabs — last content clears the tab bar. Reported case (Flights → "Track a specific flight" section) fully reachable.

## Updates (2026-06 — round 20)
- [x] **Tab bar unreachable on tall phones**: `app/(tabs)/_layout.tsx` tabBarStyle had hard-coded `height:64`/`paddingBottom:8` with no bottom safe-area, so the bar was pushed under the home indicator/gesture area on taller devices (reported on build "v3" — Sports screen showed no tab bar). Fix: `useSafeAreaInsets` → `height: 64 + insets.bottom`, `paddingBottom: insets.bottom + 8`. Verified (iteration_21) — all 5 tabs visible/tappable, no regression. (Web insets.bottom=0 so height unchanged there; real fix is on-device.)

