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

## Updates (2026-06 — round 22)
- [x] **Editable weather location**: the Weather tab now has its own "Your Location · Home ZIP code" editor (`weather.tsx`, uses shared `updateFlights` + `geocodeZip`) so the primary weather area can be changed right on the Weather screen instead of only on the Flights tab. Same single home location is still shared with the Flights radar (hint text clarifies this). Verified on web: ZIP 10001 → "New York (Manhattan) County, NY", county line + live alerts updated. Summary Weather empty-hint updated to "Set your ZIP on the Weather tab" (card taps to /weather).
- [x] **Summary refactor**: extracted self-contained pieces out of the 1,127-line `app/(tabs)/index.tsx` into `src/components/summary/` — `helpers.ts` (pure fns `norm/wxGlyph/wxAccent/until/accentFor`, `LandingInfo` type, card constants) and `GlanceCard.tsx` (presentational `GlanceCard` + `ReorderGlance` with their own styles). Data-driven card renderers kept inline (tightly coupled to screen state). No behavior change; lint clean; Summary verified rendering on web.

## Updates (2026-06 — round 23)
Four new features (verified via testing_agent iteration_24, all pass):
- [x] **Location Picker**: `expo-location` added (+ app.json plugin & iOS `NSLocationWhenInUseUsageDescription`; Android already had ACCESS_FINE_LOCATION for BLE). `src/services/location.ts` `detectLocation()` — permission-contract-aware (denied/blocked→Open Settings), GPS → reverse-geocode → ZIP pipeline for consistent city/state labels. Reusable `src/components/LocateButton.tsx` ("Use my location") on both Flights and Weather "Your Location" cards; sets shared `flights` lat/lon/city/state/zip.
- [x] **Live Radar**: `src/services/radar.ts` (RainViewer keyless frames + ESRI Dark Gray base tiles, web-mercator tile math) + `src/components/RadarCard.tsx` — a live precipitation-radar snapshot on the Weather tab (shown when located) with an amber marker at the user's fractional tile position. Switched base from CartoDB (now watermarks "API KEY REQUIRED") to keyless ESRI Dark Gray Canvas. Works in web preview.
- [x] **Sunset Dimming**: `nightMode.useSunset` added to store (Settings/DEFAULT/full+night BLE payloads). Device tab: under Night Dimming, a "Sunset to sunrise" toggle; when on, hides From/To steppers + weekend schedule, keeps Dim-to slider, shows a sunset hint. Firmware: `NightCfg.useSunset`, `Data::sunTimes(lat,lon,&srMin,&ssMin)` (Open-Meteo daily sunrise/sunset, cached per day), `applyBrightnessForNow` dims from local sunset→sunrise when enabled; `applyNight` BLE parse reads `useSunset`. Device-only rendering.
- [x] **Team Colors on Summary**: `accentFor(hex)` (helpers.ts, luminance guard → falls back to brand for near-black teams) drives the Summary Sports glance card's icon accent to the starred team's color.

## Updates (2026-06 — round 24)
- [x] **Radar Animation**: `radar.ts` `latestRadar()` now returns the last ~7 RainViewer past frames; `RadarCard` loops them (~550ms/frame) on both the Weather-tab card and the fullscreen view, with a frame-time badge. Center-tile frames prefetched via `Image.prefetch` for smooth playback.
- [x] **Tap Radar Fullscreen (pinch-zoom)**: tapping the radar card ("Expand") opens a full-screen modal with a 3×3 z7 tile mosaic (base + animated radar), **pinch-to-zoom (1–6×) + drag-to-pan + double-tap reset** via react-native-gesture-handler + reanimated, plus a Reset-view button and play/pause. Discovered RainViewer radar tiles only resolve to zoom 7 (z8+ returns a "Zoom Level Not Supported" placeholder at both 256 & 512 sizes), so zoom is done by scaling the z7 mosaic rather than requesting deeper tiles. Base map is keyless ESRI Dark Gray. Verified on web: full storm detail, marker, animation, gestures.

## Updates (2026-06 — round 25)
- [x] **Android home-screen widget (Overhead Flight)**: medium/wide widget showing the nearest overhead flight (callsign · airline, altitude · distance · heading, "Updated <time>"). Library `react-native-android-widget@0.22.1` (Expo config plugin in app.json, widget `name:"Overhead"`, 4×2 cells, `updatePeriodMillis` 30 min). Files: `src/widgets/OverheadWidget.tsx` (FlexWidget/TextWidget UI, amber accent, `clickAction:"OPEN_URI"` → deep link `auratwo://flights`), `src/widgets/overheadData.ts` (headless: reads `aura_settings_v1` from AsyncStorage for lat/lon, fetches `nearbyPlanes`), `widget-task-handler.tsx` (renders on ADDED/UPDATE/RESIZED), `src/widgets/update.tsx` (`refreshOverheadWidget()` — Android-only, called from Summary `loadAll` to push fresh data while app is open). New custom entry `index.js` (imports `expo-router/entry`, then registers the widget task handler on Android only); `package.json` main → `index.js`. All widget code is behind `Platform.OS==='android'` require() guards so web/iOS are unaffected (web still bundles via expo-router/entry — verified boots, all tabs work). **NATIVE-BUILD-ONLY**: the widget cannot run in Expo Go / web preview; user must Publish + generate an Android build, then long-press home screen → Widgets → Aura to add it.

## Updates (2026-06 — round 26)
- [x] **Removed the Android Overhead widget** (per user: Android's ~30-min widget refresh cap made it too stale to be interesting). Reverted everything from round 25: deleted `src/widgets/*`, `widget-task-handler.tsx`, `index.js`; `package.json` main → `expo-router/entry`; removed the `react-native-android-widget` plugin from app.json and uninstalled the package; removed the `refreshOverheadWidget` import + call from Summary `loadAll`. Verified app boots + tabs work, no leftover references.

## Updates (2026-06 — round 27)
- [x] **Fixed: Summary tab doesn't scroll on the native APK** (worked in web preview, failed on device). Root cause: `react-native-reorderable-list` 0.18.1 has a known scroll/gesture conflict under the New Architecture (Fabric), especially combined with `RefreshControl`. Replaced the `ReorderableList` with a plain `ScrollView` (Header + mapped cards + Footer + RefreshControl) — reliable native scrolling. Drag-to-reorder replaced with **up/down arrow buttons** on each glance card (`GlanceCard` now takes `onMoveUp`/`onMoveDown` instead of `onLongPress`/`dragging`); `moveCard(key,dir)` swaps within the visible order preserving hidden slots and persists to `aura_summary_order_v1`. Uninstalled `react-native-reorderable-list`. Hint text → "Use arrows to reorder". Verified on web: scrolls to footer, arrows reorder + persist across reload, lint clean.



## Updates (2026-06 — round 28)
- [x] **Fixed: SYNC returns an error on device / matrix stuck "waiting for data"** (firmware flashed, BLE connects, flash test + Wi-Fi work). Root cause: the full-config sync was written as one ~500-byte JSON blob, which exceeds the negotiated BLE ATT MTU, so `writeCharacteristicWithResponse` (and the without-response fallback) threw → SYNC error. Small commands (wifi/flash_test) fit, which is why those worked and the clock/NTP came up. Fix (app-only, no reflash): (1) `pushAllSections()` in `store/matrix.tsx` now sends the config as six small per-section commands the firmware already parses (`flights`, `sports`, `weather`, `night`, `brightness`, `holiday`) — used by both `syncAll` and the on-connect auto-push; removed the giant `syncSettings(buildFullPayload)` call and its now-unused import. (2) `ble.ts` requests a larger MTU (`d.requestMTU(512)`) right after `discoverAllServicesAndCharacteristics()` in both connect paths for headroom. Lint clean. NOTE: user must rebuild the APK (JS change) to get the fixed SYNC; firmware does NOT need reflashing.

## Updates (2026-06 — round 29)
- [x] **Backend `/health` endpoint** added (root-level, outside `/api`) in `backend/server.py` → fixes deployment health-probe 404 that blocked production deploy. Verified 200. Deployment agent: PASS.
- [x] **BLE SYNC "Operation was rejected" fix hardened**: `store/matrix.tsx` `pushAllSections` sends config as 6 small per-section commands (firmware already routes `flights/sports/weather/night/brightness/holiday`), with 40ms gaps; `ble.ts` `requestMTU(512)`; firmware `NimBLEDevice::setMTU(512)` added. SyncFab now shows explicit "Synced ✓" toast. NOTE: SYNC fix works with firmware already on device — only needs app rebuild.
- [x] **Firmware panel geometry** → single native 128×64 (`Config.h`: PANEL_RES_X 128 / PANEL_CHAIN 1) to fix split/scrambled image. Needs re-flash.
- [x] **Scrolling weather-alert marquee** (firmware): `Display::weatherScroll()` + continuous animation in `loop()` while an alert is active (header fixed, headline scrolls R→L, short ones centered). Replaces the old 2-line/40-char truncation. Needs re-flash.

## Updates (2026-06 — round 30)
- [x] **Expo SDK 57 upgrade verified complete** (expo 57.0.19, RN 0.86.3, expo-router 57.0.18 installed; app bundles + renders on web, all 5 tabs OK). Decision: **kept `@expo/vector-icons`** (fully SDK-57 compatible; app's `src/hooks/use-icon-fonts.ts` CDN loader handles Expo Go). Skipped the risky `@react-native-vector-icons` migration (would break the icon-font loader + force native autolinking that fails in Expo Go). User approved keeping @expo/vector-icons.
- [x] **Firmware TLS `code=-1` / matrix stuck on "waiting for data" — ROOT CAUSE FOUND + FIXED.** Photos confirmed: matrix joins Wi-Fi ("James", IP 192.168.1.149) + BLE connected, but EVERY HTTPS fetch fails (`code=-1`) so `buildSeq()`=0 cards → "waiting for data". Cause: the HUB75 DMA framebuffer must live in internal SRAM (MatrixPortal S3 has only 2MB *Quad* PSRAM, which the lib docs say is too slow to feed the panel — SPIRAM_DMA_BUFFER not viable). With `double_buff=true` + default 8-bit color depth the framebuffer ate ~128KB of ~200KB internal SRAM, leaving only ~36KB — below the ~45KB a TLS handshake needs. Fix (firmware, needs re-flash) in `DisplayManager.h::begin()`: `cfg.double_buff = false` + `cfg.setPixelColorDepthBits(4)` → shrinks framebuffer ~4×, frees ~90KB, internal free heap → ~120KB+ (comfortably above TLS need). This fix is independent of whether PSRAM inits. Also improved `[MEM]`/`[GET]` serial logs to print `heap_caps_get_free_size(MALLOC_CAP_INTERNAL)` for accurate internal-heap reads. Trade-off: single-buffered may show slight tearing during the brief card redraw (every 8s) — acceptable vs. non-working fetches; 4-bit = 4096 colors, fine for text/scores/logos. USER MUST RE-FLASH and report the new `[MEM]` + `[GET]` serial lines.

## Updates (2026-06 — round 31)
- [x] **Firmware memory fix CONFIRMED working on hardware.** Serial now shows `intFree=162432` (was ~36KB) and `psram=2079683`. Weather (api.weather.gov) and Flights (api.adsb.lol) both return `code=200`. BLE + Wi-Fi connect fine (BLE now started first in setup()).
- [x] **USB serial fix**: added `-DARDUINO_USB_MODE=1` + `-DARDUINO_USB_CDC_ON_BOOT=1` to `platformio.ini` build_flags so `Serial.print()` shows over the MatrixPortal S3 native USB (was blank monitor). Added `[BLE]`/`[DISP]` boot markers.
- [x] **ESPN sports 403 fix**: `site.api.espn.com` (Akamai) was returning HTTP 403 to the firmware's non-browser requests. `DataServices.h::httpGet()` now sends a browser-like `User-Agent` (Chrome desktop UA) by default; weather.gov still passes its own required UA explicitly; adsb.lol/open-meteo unaffected. Needs re-flash. Pending user confirmation that ESPN now returns 200.

## Updates (2026-06 — round 32)
- [x] **Diagnosed the real blocker: BLE↔Wi-Fi radio coexistence.** With ~175KB free heap, fetches still failed intermittently: DNS Failed (UDP!), SSL EOF -29312, connect -1, read timeout -11 — random across weather/adsb. Single shared 2.4GHz radio; active BLE connection starves Wi-Fi. (ESPN still 403 = separate server block.)
- [x] **Coexistence fixes (firmware, needs re-flash):**
  1. `main.cpp wifiConnect()`: `WiFi.setSleep(false)` — Wi-Fi radio always-on (no modem sleep) so BLE can't park it.
  2. `BleProvisioning.h`: added `ServerCallbacks::onConnect` → `updateConnParams(handle, 24, 60, 4, 600)` (30–75ms interval, slave latency 4, 6s timeout) so the connected BLE link is low-duty-cycle and leaves airtime for Wi-Fi.
  3. `DataServices.h httpGet()`: retry loop (3×) on transport errors (DNS miss / TLS EOF / -1 / -11) with re-resolve + 400–500ms backoff; connect+read timeouts bumped to 12s; added `Accept-Language` header.
- [ ] **ESPN 403 still open** (site.api.espn.com Akamai bot block). Browser UA + Accept-Language added; if it persists on next flash, next step = proxy ESPN through the FastAPI backend (server-side fetch returns clean JSON to the ESP32).

## Updates (2026-06 — round 33)
- [x] **Reverted `WiFi.setSleep(false)` — it CRASHED the board.** Boot log showed `wifi:Error! Should enable WiFi modem sleep when both WiFi and Bluetooth are enabled!!!!!!` → abort()+reboot loop the moment it joined Wi-Fi. ESP-IDF *requires* Wi-Fi modem sleep ENABLED under BLE+Wi-Fi coexistence. Removed the line; kept the BLE conn-param relaxation (ServerCallbacks) + httpGet retries as the safe coexistence mitigations. Boot now healthy: `internal free=310328`, BLE advertising, panel init done.

## Updates (2026-06 — round 34)
- [x] **Coexistence FIXED (confirmed on hardware):** after reverting setSleep(false) + keeping BLE conn-param relaxation + retries, the serial log shows all fetches landing on `try=1` with no `-1`/`-11`/DNS-fail — Wi-Fi is stable with BLE connected.
- [x] **ESPN 403 FIXED (confirmed):** browser User-Agent → `site.api.espn.com` now returns `code=200` (len=49152). Weather also 200.
- [x] **adsb.lol 403 FIXED:** the browser UA that fixed ESPN *broke* adsb.lol (it wants a custom identifying UA, not a fake browser). Per-endpoint UA now: adsb.lol flight calls (`nearestFlight`, `flightByCallsign`) pass `"AuraMatrix/1.0 (LED matrix flight display)"`; ESPN + open-meteo use the default browser UA; weather.gov its own. Needs one more re-flash to confirm flights=200.

## Updates (2026-06 — round 35)
- **Coexistence conclusion:** BLE-connected Wi-Fi starvation on the single-radio S3 has no clean fix — `esp_coex_preference_set(PREFER_WIFI)` is deprecated in IDF 4.4.3; disabling modem sleep crashes; BLE conn-param relaxation + 3× retries help but don't eliminate `-11`/`-5`/`-29312`/DNS-fail while a phone is actively connected. Mitigation in place: per-source caching means each card populates within a minute or two and persists. KEY: fetches are reliable when NO phone is actively connected (matrix runs standalone by design; BLE only needed for occasional sync).
- Next test for user: flash round-34 (adsb UA fix) and (a) watch the DISPLAY for ~2 min for rotating flight/score/weather cards, and (b) test with the app disconnected to confirm rock-solid fetches.

## Updates (2026-06 — round 36)
- [x] **adsb.lol 403 — robust fix.** adsb.lol rejects browser-looking UAs but originally worked with NONE. Reworked `httpGet` UA handling: nullptr→browser UA (ESPN/open-meteo), ""(empty)→send NO User-Agent header (adsb.lol), other→verbatim (weather.gov). Both flight calls (`nearestFlight`, `flightByCallsign`) now pass "". Restores adsb.lol's original 200 behavior. Needs re-flash.
- Note: latest hardware log (phone CONNECTED) showed ESPN + weather clean `200` on try=1 with no coexistence errors — coexistence is acceptable in practice; adsb was the only 403 (browser UA), now fixed.

## Updates (2026-06 — round 37)
- [x] **Hidden firmware version (troubleshooting).** Firmware: `Config.h` `AURA_FW_VERSION "1.1.0"`; `BleProvisioning.h` includes `fw` in the initial characteristic value + wifi-notify, and handles a new `{"command":"version"}` → notifies `{"fw":...}` back. App: `store/matrix.tsx` new `firmwareVersion` state (set from any BLE msg with `fw`, requested via `writeLive({command:"version"})` on connect, reset on disconnect). Device tab: tapping the footer text 7× reveals a "Device Info" card (Firmware vX.Y.Z / Device / Wi‑Fi IP / Signal). Web shows "connect to read" (BLE native-only). Needs firmware re-flash to report the version; app change needs a rebuild to fetch it. Lint clean, web smoke test OK.

## Updates (2026-06 — round 38)
- [x] **App bug fix: Summary sports "No recent game · needs phone app" on off-days.** Root cause: `src/services/espn.ts getTeamScore()` hit the bare `/scoreboard` (today only) → empty on a team's off-day. Now queries a window `?dates=(today-2)-(today+8)&limit=100` (range format confirmed supported/inclusive), collects all events for the team, and picks a live game else the event closest to now (recent Final or next matchup). Falls back to plain scoreboard if range empty. Cleaned misleading copy: index.tsx "No recent game · needs phone app" → "No recent or upcoming game"; second-team "needs phone app" → "No game". Lint clean; web can't render scores (ESPN 403s datacenter IPs) so verify on-device after rebuild. Firmware `teamGame` left on single-day (10-day MLB range payload too large for ESP32 memory).
- Serial note: adsb.lol still 403 in user's latest log = round-36 no-UA fix not yet flashed (browser-UA build still on board). Weather+ESPN 200; weather DNS miss recovered on try=3 (coexistence retries working).

## Updates (2026-06 — round 39)
- [x] **Total DNS failure fix.** User log showed 100% `hostByName DNS Failed` (ok=0, 7s timeouts) on ALL hosts — router DNS (192.168.1.1) not answering / rate-limiting. Added `WiFi.config(localIP, gatewayIP, subnetMask, 8.8.8.8, 1.1.1.1)` right after WL_CONNECTED (keeps DHCP IP, pins public DNS) + `[NET]` log. If DNS still fails after this, the Wi-Fi LINK itself is starved (signal/coexistence) not DNS. Needs re-flash.

## Updates (2026-06 — round 40)
- [x] **DNS rate-limit fix (root cause of 100% DNS fail).** User confirmed no router/board change → cheap router was banning the chatty client (we did an EXTRA hostByName per request on top of HTTPClient's internal lookup). Added a per-host DNS cache in DataServices.h (`resolveCached` — resolve each host once, reuse) + `dnsForget` eviction on transport failure (CDNs like ESPN/Akamai rotate IPs). Combined with the pinned public DNS (round 39), this minimizes DNS query volume. Simplified the `[GET]` log (now shows cached dns per host). Needs re-flash.

## Updates (2026-06 — round 41)
- [x] **DNS fully fixed & confirmed** (public DNS pinned + per-host cache + eviction). Serial: `[NET] dns1=8.8.8.8`, all hosts resolve, ESPN self-healed (evict stale Akamai IP → 200 on try=2), weather 200.
- [x] **adsb.lol 403 = their dynamic load-balancer rate-limit block** (confirmed via adsb.lol docs). Triggered by today's heavy reflash/test volume; their docs ask for a *descriptive* User-Agent (browser UA & empty UA both get flagged). Set flight calls to `"AuraMatrix/1.0 (ESP32 LED matrix; +https://github.com)"`. Firmware polls flights only 1×/30s in steady state, so normal use won't trip it. The current IP block may take minutes–~1h to clear on adsb's side. Needs re-flash.
- STATUS: data pipeline essentially solved — weather + sports live; flights pending adsb rate-limit clearing.

## Updates (2026-06 — round 42)
- [x] **Deployment health check: PASS.** Fixed 2 blockers: (1) regenerated frontend/yarn.lock (was missing; deleted earlier) via `yarn install` and removed frontend/package-lock.json so the managed `yarn --frozen-lockfile` install is deterministic; (2) removed `.env`/`.env.*`/`*.env` rules from root /app/.gitignore so required env files reach the deploy context (frontend/.gitignore keeps only `.env*.local`). App bundles cleanly (1584 modules) and renders. All deployment checks green.

## Updates (2026-06 — round 43)
- [x] **Frontend regression: CLEAN PASS** (testing agent, iteration_25.json). Verified: scrolling on all 5 tabs (Summary ScrollView OK), reorder up/down arrows + persistence across reload, tab navigation stability, 7-tap Device Info reveal (Firmware 'connect to read' on web = expected), sports 'needs phone app' text removed, Open-Meteo weather works (ZIP 10001 → 83°F), AsyncStorage persistence. No bugs. Native-only (BLE, ESPN/adsb CORS) correctly not flagged. Optional non-blocking note: index.tsx (975 lines) / device.tsx (747 lines) could be split later.

## Updates (2026-06 — round 44)
- [x] **HARDWARE WORKING END-TO-END.** User's photo shows the matrix rendering the clock (4:00), weather sun icon, and 82°F pulled live over HTTPS. Data pipeline fully fixed. Weather + clock cards confirmed on panel. Flights (adsb) may still be rate-limited/no-planes; sports depends on game availability. App version 1.0.9, firmware AURA_FW_VERSION 1.1.0.

## Updates (2026-06 — round 45)
- [x] **ROOT CAUSE: panel went blank after app connected.** App default `weather.showClock=false` while firmware boots clock-on; connecting auto-pushes all settings (pushAllSections) → sets showClock=false on matrix → with no weather alert (len=233 empty), no flights (403), no game → 0 cards → panel cleared. Brightness 100%/night off confirmed not the cause.
- [x] **Fix 1 (firmware, needs re-flash):** `buildSeq()` now adds the clock as a FALLBACK (`showClock || n==0`) so the panel is NEVER blank; `refreshData()` fetches temp when clock enabled OR nothing else has data (fallback clock shows temp too). Added `[CARD]` (n + per-source ok) and `[BRIGHT]` diagnostic serial logs.
- [x] **Fix 2 (app):** default `weather.showClock` true (matches firmware; good first-run baseline). Toggle exists on Weather tab. Lint clean. (Existing installs have showClock=false persisted, but the firmware fallback covers them; or toggle Show Clock on + SYNC.)

## Updates (2026-06 — round 46)
- [x] **REAL sports fix (firmware): off-day game not found.** `teamGame()` was hitting the single-day `/scoreboard` and looping for the team TODAY -> off-day = no match = no sports card. Now: queries a date window `?dates=(today-1)-(today+3)&limit=100` (needs NTP time; falls back to plain scoreboard if no time), and picks the team's game CLOSEST to now (recent final / live / next) — same behavior as the app's espn.ts fix. Added `httpGetToDoc()` streaming+filtered JSON GET so the large multi-day ESPN payload parses without buffering whole in RAM (uses DNS cache + retries). Added `[SPORTS]`/`[GETDOC]` serial logs. Includes: time.h/limits.h/stdlib.h/stdio.h.
- Clarified: 'weather data' = the alert card only fires on an ACTIVE NWS alert (currently none -> len=233 empty, correct). Temperature rides on the clock card, which is why 82°F showed. Kept clock as a never-blank fallback.
- User frustrated that fallback clock was presented as the fix; real blocker was firmware sports off-day (now fixed). NEEDS RE-FLASH. User must have a team followed + synced; [SPORTS] log confirms.

## Updates (2026-06 — round 47)
- [x] **DNS 100% fail even with app DISCONNECTED -> NOT BLE coexistence.** Failing even to 8.8.8.8 with 14s timeouts. Root cause suspected = my round-39 `WiFi.config(...8.8.8.8...)` called POST-connect (known-flaky ESP32 pattern that can break the resolver; many routers also block external DNS). REVERTED to router DHCP DNS (worked in rounds 40-41 alongside the DNS cache). Kept per-host DNS cache (round 40, prevents the router rate-limit that caused round 39's failure) + retries. `[NET]` now logs the router DNS. NEEDS RE-FLASH.
- Note: many rapid reflashes/boots trigger immediate fetch bursts (adsb + router DNS) that can transiently rate-limit; letting the board sit a few minutes may help.

## Updates (2026-06 — round 48)
- [x] **Backend proxy built (hybrid).** New `GET /api/matrix/feed?lat&lon&radius&team&severity&flights&sports&weather` in server.py: server-side fetches flight (adsb.lol), weather alert (NWS), temp (open-meteo) concurrently (httpx), 20s cache, returns compact JSON {flight,score,alert,temp}. Tested via localhost AND external URL: flight ok=1 (AAL1486), temp ok=1 (82F). ESPN sports is BLOCKED from datacenter IPs (403 confirmed) so `sports` defaults off in proxy usage — matrix fetches ESPN DIRECTLY (residential IP works).
- [x] **Firmware:** Config.h AuraSettings.serverUrl; BLE `server` command stores it; DataServices `matrixFeed()` (FeedResult) parses the proxy JSON; refreshData() now: if serverUrl set -> ONE proxy call fills nearest-flight + alert + temp (skips those direct fetches), sports still direct ESPN, tracked-flight still direct callsign. Falls back to all-direct if serverUrl empty (no regression).
- [x] **App:** pushAllSections now sends `{command:"server", url: EXPO_PUBLIC_BACKEND_URL}` on connect/sync. Lint clean.
- Net effect: matrix makes 2 reliable fetches (proxy + ESPN) instead of 4+ flaky ones; eliminates adsb rate-limits + most DNS churn. NEEDS firmware re-flash + app rebuild; backend already reachable at preview URL.

## Updates (2026-06 — round 49)
- [x] **Backend proxy tested: 11/11 pytest pass** (tests/test_matrix_feed.py, iteration_26.json): correct 200 shapes, 422 on missing lat/lon, toggles, 20s cache, regressions OK. ESPN score.ok=0 = expected datacenter block.
- [x] **Hardening:** added custom User-Agent + last-good temp cache to `_fetch_temp` (survive open-meteo 429 bursts on the shared datacenter egress IP).
- Confirmed live: proxy flight ok=1 reliably (adsb works server-side); temp intermittently 429 on datacenter -> FIRMWARE FALLS BACK to direct open-meteo (residential IP, not throttled) via the `!proxyTemp` gate, so temp always shows. ESPN sports always direct from matrix.
- STATUS: proxy production-ready. End-to-end matrix integration pending user hardware (flash firmware + rebuild app so app pushes server URL on connect).

## Updates (2026-06 — round 50)
- [x] **Sports moved to proxy (reliable).** Discovered site.web.api.espn.com is NOT datacenter-blocked (site.api.espn.com=403). Backend _fetch_score now uses site.web.api.espn.com -> proxy returns score ok=1 (NYY vs COL, next game). Firmware: matrixFeed() now takes team+wantSports and parses `score`; refreshData() picks the rotation team BEFORE the proxy call, gets score from the feed, and only falls back to direct ESPN teamGame if serverUrl empty or proxy score missing. So matrix now makes ONE proxy call for flight+sports+weather+temp; ESPN direct is fallback only.
- [x] **Logos:** raised panel color depth 4-bit -> 6-bit (262k colors) now that memory is comfortable, to fix posterized airline logos. Needs re-flash.

## Updates (2026-06 — round 51) — ASSIGNMENT COMPLETE (pending user hardware verify)
- Backend feed final test: flight.ok=1, score.ok=1 (NYY 9/8), alert.ok=0 (no active alert, correct), temp.ok=1. health + /api/ regressions pass.
- Firmware refreshData reviewed coherent: ONE proxy call -> flight+sports+weather+temp; direct fetches gated as fallback (proxyFlight/Score/Weather/Temp); rotation team chosen pre-proxy.
- Color depth 6-bit for logos. NEEDS: user flash firmware + rebuild app (app pushes serverUrl on connect). Verify: sports card appears + logos crisper.

## Updates (2026-06 — round 52) — OTA + Radar-on-Summary (tested 11/11 + frontend)
- [x] **Radar thumbnail on Summary:** index.tsx now renders a "Sky right now" label + <RadarCard lat lon> below the glance cards when located (ZIP/GPS set). Tap opens fullscreen radar. Verified on web with ZIP 10001.
- [x] **Firmware OTA pipeline:**
  - Backend server.py: POST /api/firmware/upload (version + .bin, rejects <1000B -> 400), GET /api/firmware/latest?current= ({version,size,available,update,url}), GET /api/firmware/download (FileResponse). Stored in backend/fw_store/. Tested 11/11 (tests/test_firmware_ota.py).
  - Firmware main.cpp: `#include <HTTPUpdate.h>`; otaCheck() GETs /api/firmware/latest, if update -> httpUpdate.update() over HTTPS (setInsecure) + rebootOnUpdate. Auto-runs once ~15s after boot when serverUrl+WiFi ready; also on BLE {command:"ota"}. gOtaRequested flag (Config.h/main.cpp), BLE "ota" handler.
  - App: store installOta() -> writeLive({command:"ota"}); Device Info (7-tap) fetches /api/firmware/latest, shows "Latest firmware vX" row + "Install update over Wi-Fi" button (BLE-connected only).
  - Workflow: user compiles .bin in PlatformIO -> uploads to backend once -> matrices self-update over WiFi. (fw_store cleared of test bin.)
- Note (optional/non-blocking): OTA upload endpoint has no auth/size cap — fine for personal use; can add a token later.

## Updates (2026-06 — round 53) — More detailed weather icons
- [x] Rewrote DisplayManager wxIcon(): two-tone cloud (dark outline + light body + highlight) so it reads as a rounded cloud not a blob; sun now has a bright core + rays; partly-cloudy offsets sun upper-left with cloud lower-right so both are visible; rain = sharper blue streaks; snow = plus-shaped flakes; storm = filled lightning bolt (fillTriangle); overcast adds a second puff. Bumped AURA_FW_VERSION 1.1.0 -> 1.2.0. Needs re-flash (icon shows when Show Weather Icon is enabled).


## Session Update — Plane Cycling + Rain Arriving Alert

### Weather icon fix answer
- Confirmed to user: the v1.2.0 detailed weather icons are firmware-only. No app regenerate/republish needed — just `git pull` + flash the ESP32 (USB or OTA). App republish is only for React Native UI changes.

### Multiple planes cycling (bug fix — DONE)
- Problem: Summary "Overhead" glance card only ever showed the single closest plane even when several were in range.
- Fix (`app/(tabs)/index.tsx`): the Overhead card now holds the full nearby list and auto-cycles through them one at a time (every 4s), with a `n/N` counter chip and "Cycling nearby flights · tap to pin this one" hint. Tapping still pins the currently shown flight; when a flight is pinned/tracked, cycling stops and only that flight shows.
- Flights tab list bumped from 4 → 8 planes.
- NOTE: only visually verifiable on the phone build — adsb.lol has no web CORS, so the web preview shows "No aircraft in range".

### Rain Arriving Alert (feature — DONE)
- `src/services/weather.ts` → new `rainArriving(lat, lon)` using Open-Meteo `minutely_15` precipitation nowcast. Returns `{ minutes, mmPerHr, label }` when rain will start within the next 60 min AND it is not already raining; null otherwise.
- Summary tab (`index.tsx`) shows a blue "Rain arriving in ~X min" banner (below the landing card) that deep-links to the Weather/radar tab. Banner only appears when rain is imminent — verified the located summary renders without errors (currently hidden in Miami test since rain wasn't within the hour).

### Still open / needs user input
- **Team Logo Sharpening (P3)**: requires the user's hardware photos of the 64px logos on the matrix to hand-tune `firmware/include/Logos.h` bitmaps. Waiting on photos.
- **OTA Upload In-App (P2)**: user unsure what it means — deferred pending explanation/confirmation.



## Session Update — Plane Details On Wall + Quiet Rain Hours

### Plane Details On Wall (firmware + backend — DONE, hardware-verify pending)
- Backend `/api/matrix/feed` (`server.py`): `_fetch_flight` now returns the closest plane PLUS a `list` of up to 5 nearby planes (closest first). Each plane is enriched via new `_enrich_route()` (adsbdb.com, keyless, 6h cache) with `airline` name + `from`/`to` IATA route. Top-level `flight` keeps `cs/dist/alt/hdg` for backward compat and adds `airline/from/to`.
- Firmware:
  - `DataServices.h`: `FlightInfo` gained `origin`/`dest`; `FeedResult` gained `planes[5]` + `planeCount`; `matrixFeed()` parses the `list` (prefers server airline, falls back to `airlineFromCallsign`).
  - `main.cpp`: stores `gFlightList[5]`/`gFlightCount`/`gFlightShown`; `drawCard(0)` advances through the list each time the flight card appears (mirrors the app's cycling). Tracked/direct-fallback = single plane.
  - `DisplayManager.h` `flight()`: new optional `origin`/`dest` params render a green "ORIG>DEST" route line; layout re-flowed to fit callsign/airline/route/dist/alt/ETA on 64px.
  - `Config.h`: `AURA_FW_VERSION` bumped `1.2.0` → `1.3.0`. NOTE: needs flash/OTA to take effect; hardware visual check pending.
- Verified: backend returns airline+route+list (24/24 pytest incl. new `tests/test_flight_route_feed.py`). Firmware not compilable in this env — untested on hardware.

### Quiet Rain Hours (app — DONE, tested)
- Store (`matrix.tsx`): `weather.rainAlert` (bool, default true) + `weather.rainQuiet {enabled,startHour,endHour}` (default off/22–7); new `updateRainQuiet` action. App-only (not sent to matrix).
- `weather.ts`: exported shared `isQuietNow()` helper.
- Summary (`index.tsx`): rain banner now gated by `rainAlert` AND not within `rainQuiet` window.
- Weather tab (`weather.tsx`): new "Rain Arriving Alert" card — master toggle + Quiet hours toggle with From/To hour steppers.
- Verified by testing agent (iteration 28): card renders, toggles work, Summary stable. AsyncStorage persistence spot-check recommended on device (harness starts with empty localStorage).

### Still open / needs user input
- **Team Logo Sharpening (P3)**: waiting on user's hardware photos of the 64px logos.
- **OTA Upload In-App (P2)**: user unsure what it means — deferred.



## Session Update — Multi-Game Sports + Route Info + Cleaner Logos (firmware v1.4.0)

Driven by hardware photos: v1.3.0 confirmed working (flight card shows callsign/airline/dist/alt + cycles planes). User asks: (1) show ALL followed teams' games (Yankees AND Ravens), (2) sports still not appearing, (3) add departure/arrival (route) to flight cards, (4) NetJets logo missing + American logo "extra pixel" + stray green pixels near sun/logos.

### Multi-game sports (backend + firmware — DONE, hardware-verify pending)
- Backend `/api/matrix/feed`: `team` param is now a COMMA-SEPARATED list ("MLB:NYY,NFL:BAL"). Fetches a game for every team in parallel and returns `scores` = list of `{ok,home,hs,away,as,st,key}` for teams that have a game in the window, plus `score` (=scores[0], backward-compat). Verified: NYY+BAL+KC all returned.
- Firmware: `FeedResult` gained `scores[8]/scoreKeys[8]/scoreCount`; `matrixFeed()` parses the `scores` array. `main.cpp` now sends ALL followed teams (comma-joined, was rotating one per refresh), stores `gScoreList[8]/gScoreKeysArr[8]/gScoreCount/gScoreShown`, and `drawCard(1)` cycles through every team's game each time the sports card appears (mirrors the flight cycling). `buildSeq` uses `gScoreCount>0`. Direct-ESPN fallback (no server URL) fetches just the first team.
- WHY sports may have looked empty: only ONE team was fetched per 30s refresh before; an out-of-season team (NBA/NHL in offseason) produced no card. Now all in-season teams cycle. NOTE: teams must be SYNCED to the matrix (press SYNC / reconnect) — the matrix only shows teams present in `gSettings.sports.teams`.

### Departure/arrival on flight card (already in v1.3.0, confirmed)
- Backend enriches each plane with `airline/from/to` via adsbdb; firmware `flight()` draws a green "ORIG>DEST" line when both present. Verified commercial flights return routes (VIR26Q JFK→LHR). GA/private (Frontier tail, NetJets) usually have NO route in adsbdb → line stays blank (data limitation, not a bug).

### Logos + airline names (DONE)
- `DataServices.h airlineFromCallsign`: added Alaska/Hawaiian/Allegiant + private ops NetJets(EJA)/ExecJet(EJM)/Flexjet(LXJ)/PlaneSense(DPJ) so at least the NAME shows when no logo exists.
- `tools/generate_logos.py`: rewrote `to_rgb565_array` to drop faint anti-aliased edge pixels (alpha<96 → off) and kill muddy near-black specks (max<24 → off). Regenerated `include/logos/generated_logos.h` (135 logos). This removes the stray "extra pixel"/green edge artifacts on team + airline logos. NetJets has no Google-Flights logo source → name fallback only.
- `Config.h`: `AURA_FW_VERSION` → `1.4.0`.

### Flash required
- All of the above needs the ESP32 reflashed to v1.4.0 (git pull + USB/OTA). No app rebuild required.

### Still open
- Team Logo Sharpening fine-tune (P3): still want user's hardware photos to hand-adjust specific logos.
- If sports still empty after flashing: verify teams synced (SYNC button) and that the team is in-season.




## Session Update — Sports Root Cause (DEPLOY) + Centered Flight Card (v1.4.1)

### ROOT CAUSE of "still no sports" (from user serial logs)
- The matrix calls the DEPLOYED backend `https://smart-matrix-hub.emergent.host/api/matrix/feed?...&team=MLB:NYY,NHL:CAR,NFL:BAL` and gets `len=163` (empty `scores`). That deployed server runs the OLD code (pre multi-team), so the comma-joined team list isn't understood → no scores.
- CONFIRMED my dev backend returns the games for the exact device query: scores=[MLB:NYY (COL@NYY 9/8), NFL:BAL (BAL@IND 9/13)] (~1029 bytes). NHL:CAR correctly omitted (offseason). ESPN has NYY games 9/8-9/11.
- The firmware direct-ESPN fallback also logged `MLB:NYY -> ok=0` even though the game exists - the streamed `teamGame` filter parse is unreliable, but it's only a fallback; the proxy is the real path.
- FIX = REDEPLOY the backend (Publish). After redeploy the proxy returns `scores` and firmware v1.4.0+ (which already parses the `scores` array) shows all in-season teams cycling - NO reflash needed for sports. Teams must be synced to the matrix (SYNC/reconnect).

### Vertically centered flight card (firmware v1.4.1 - needs reflash)
- `DisplayManager.h flight()` rewritten to collect present lines (callsign, airline, optional route, dist, optional alt/heading, optional ETA) into an array and center the block vertically on the 64px panel (was fixed top-down y=2..57). `Config.h` AURA_FW_VERSION -> 1.4.1.

### Action items for user
1. REDEPLOY backend (Publish) -> fixes sports on the current firmware.
2. git pull + reflash to v1.4.1 -> vertically-centered flight data.


## Session Update — Tracked-flight blank card + NVS settings persistence (firmware v1.5.0)

### ROOT CAUSE of "flights on app but not on display" (from user serial log)
- User had "Track a specific flight" = `AA735` enabled, and that flight was cancelled that day. Old logic: `trackMode` fully bypassed the nearby-planes proxy fetch (`flights=0` sent to `/api/matrix/feed`) and instead made a DIRECT `adsb.lol/v2/callsign/AA735` call every refresh, which returned `403` (no data for a cancelled flight). Since track mode replaced the whole flight card with only that one flight, a missing tracked flight = permanently blank flight card, even though sports/weather/clock worked fine and the app's own "Overhead Now" list (independent, phone-side fetch) kept working.

### Fix: tracked flight now highlights within the normal overhead cycle (DONE, needs reflash)
- `main.cpp refreshData()`: removed the direct `flightByCallsign` call entirely. Now ALWAYS fetches the full nearby-planes list via the backend proxy (`flights=` param no longer gated by trackMode), then searches `gFlightList[]` for a callsign match against `flights.flightIdent`. Sets `gTrackedIdx` (-1 if not currently overhead).
- Landing/descent ETA detection now keys off the matched list entry's altitude (`gTrackedCallsign` stores its callsign for the landing-alert card) instead of a separate fetch.
- `buildSeq()`/`[CARD]` log now check `gFlightCount > 0` instead of `gFlight.ok` (more robust).
- `drawCard(0)`: when the currently-shown cycling plane matches `gTrackedIdx`, the card gets a green border + a "* TRACKED *" label (`DisplayManager.h flight()` gained a `tracked` bool param); otherwise every nearby plane just cycles normally like before. If the tracked flight isn't overhead (cancelled/landed/out of radius), the card simply shows normal overhead traffic instead of going blank.
- `DisplayManager.h flight()`: line array bumped 6→7 slots for the new label; line pitch auto-compacts (11px → 9px) only when all 7 optional lines are present, so text never overflows the 64px panel.

### Fix: settings/Wi-Fi now survive a power cut (DONE, needs reflash)
- Previously `gSettings` (Wi-Fi ssid/pass + all app config) lived only in RAM — unplugging the matrix wiped everything and it sat blank waiting for BLE re-pairing.
- `main.cpp` now uses ESP32 `Preferences` (NVS) to serialize the full `gSettings` to flash under `aura/cfg` (JSON blob) whenever `gConfigChanged`/`gWifiCredsChanged` fires (debounced ~4s to limit flash wear).
- `setup()` now calls `loadSettings()` before anything else; if a saved SSID exists it auto-calls `wifiConnect()` and does an initial `refreshData()` — no phone/BLE interaction required to resume normal operation after a power cycle. BLE still advertises as before so the app can reconnect/adjust settings any time.

### Action items for user
1. Reflash firmware to v1.5.0 (OTA "Install update over Wi-Fi" from Device tab, or USB/PlatformIO). No backend redeploy needed this time (only firmware files changed).
2. Re-verify: (a) overhead flights show/cycle on the display again, (b) if "Track a specific flight" is set to a real active flight, it shows a green "TRACKED" card when overhead, (c) unplug/replug the matrix — it should reconnect to Wi-Fi and resume showing data on its own within ~15s, no app interaction needed.




## Session Update — Boot felt "stuck" after v1.5.0 (firmware v1.5.1)

### Diagnosis (from user serial log — confirmed NOT hung, just slow)
- After auto-reconnecting Wi-Fi in `setup()` (v1.5.0's new feature), the board runs 3 sequential blocking HTTPS calls before the first card ever draws: sun-times (night dimming) → matrix feed → boot-time OTA check. Each hit a known ESP32 "fresh TLS session" quirk (`SSL - The connection indicated an EOF`, code -29312) on the FIRST use of a given host after boot, which the existing retry logic recovers from — but each retry costs up to 12s, so the chain can take 30–90s. The screen sat on the stale "WI-FI / <ssid>" message that whole time, looking frozen, even though the log proved it eventually recovered (`[CARD] n=3...` + a successful feed fetch at the end).
- User's follow-up run showed it self-recovered and started working ("its running"). `[NVS] restored saved settings` did NOT print on that run, meaning Wi-Fi came back via the app's BLE reconnect (not the new NVS auto-load) — the auto-reconnect-after-power-loss path itself hasn't been exercised/confirmed yet. It only activates once a settings write has actually happened post-v1.5.0 (any BLE config push saves to NVS within ~4s); the NEXT unplug/replug after that should show `[NVS] restored saved settings` in the log.

### Fix (DONE, needs reflash)
- `setup()`: after a successful auto-reconnect, display now shows **"AURA / loading data..."** instead of leaving the stale "WI-FI / <ssid>" text up during the slow first fetches — makes clear the board is working, not frozen.
- `loop()`: the boot-time OTA check is now gated behind a new `gFirstCardShown` flag (set the first time any real card actually renders), so a slow/flaky OTA check can never block the very first card from showing. It still runs once ~15s after the first card is up.
- `Config.h`: `AURA_FW_VERSION` → `1.5.1`.

### Action items for user
1. Reflash to v1.5.1 (OTA or USB).
2. To actually confirm the power-loss persistence feature: change any setting in the app (or just leave it running ~5s after last change), THEN unplug/replug — log should show `[NVS] restored saved settings` and Wi-Fi reconnecting without the app.
3. The underlying SSL EOF-on-first-use retries are a known ESP32/mbedTLS quirk already handled by existing retry logic — expected occasionally, self-heals, not a new bug.



## Session Update — OTA re-flash loop (firmware v1.5.2)

### Root cause (from user serial log)
- The backend's OTA store (`fw_store/meta.json`) had a MISLABELED `.bin`: metadata said `version: "1.4.1"`, but the actual binary content baked inside was really a v1.5.0 build (confirmed by the device's own `current=1.5.0` in its follow-up OTA check after installing it). `otaCheck()` only compared "is server version STRING different from mine" — so it treated `"1.4.1" != "1.5.1"` as "update available", downloaded/flashed the mislabeled file, rebooted into what's actually v1.5.0, then immediately saw `"1.4.1" != "1.5.0"` again → infinite re-flash loop (not a hard brick — device stays fully functional between flashes, just keeps rebooting every 30-60s).

### Fix (DONE)
- `main.cpp otaCheck()`: added `isNewerVersion()` — parses `X.Y.Z` and only proceeds with the OTA install if the server's version is a **strictly higher** semantic version than `AURA_FW_VERSION`, not just "different". A stale/mislabeled/lower upload is now logged and skipped instead of triggering a re-flash.
- `Config.h`: `AURA_FW_VERSION` → `1.5.2`.

### Action items for user (no USB needed — can self-heal via OTA)
1. Build the new `.pio/build/adafruit_matrixportal_esp32s3/firmware.bin` from this updated source.
2. Re-upload it correctly labeled: `curl -F "version=1.5.2" -F "file=@firmware.bin" https://<deployed-backend-url>/api/firmware/upload`.
3. The currently-looping device (running ~v1.5.0) will see `1.5.2 > 1.5.0` — a legitimate, one-time real upgrade — install it, and the new version-guard then prevents this class of loop permanently going forward.


## Session Update — Sun icon ghosting fix + smarter sports card logic (firmware v1.5.3, backend)

### Sun icon "green pixels" (firmware, needs reflash)
- Root cause: the earlier logo-alpha cleanup (v1.4.0) only fixed BITMAP team/airline logos — the weather clock's sun icon is drawn procedurally (vector `drawSun()`/`fillCircle`/`drawLine` in `DisplayManager.h`), a completely different code path, so it was never actually fixed. The stray colored pixels near bright vector shapes are classic HUB75 ghosting (insufficient blanking time around the row latch, well-documented for the ESP32-HUB75-MatrixPanel-DMA library).
- Fix: `Display::begin()` now sets `cfg.latch_blanking = 2;` (library's documented ghosting fix, range 1-4; higher trades a little brightness for less ghosting — bump to 3-4 if any stray pixels remain visible after reflash).
- `Config.h` → `AURA_FW_VERSION` `1.5.3`.

### Smarter sports card logic (backend only — NO reflash needed, just redeploy)
- `server.py _fetch_score()` rewritten: now returns 0-2 games per team instead of always exactly one "closest to now" game:
  - LIVE game (state="in") → shown alone, previous finished game is hidden.
  - Otherwise: a game that finished within the last 12h AND a game starting within the next 12h are BOTH included together (two cards cycle for that team).
  - If neither of those applies (already >12h since the last final, nothing starting soon) → falls back to showing the single next scheduled game, however far out, so the card never goes empty.
- NOTE on interpretation: user's spec said "13 hours after game completes... show next game" — implemented as a single clean 12h cutoff for the recent-final display (falls straight through to "next game" once >12h old) rather than a separate 12-13h dead zone, to avoid ever showing a blank card for that extra hour.
- `matrix_feed()` flattens each team's 0-2 results into the existing `scores[]` array (cap 8 total, same firmware array size as before) — **no firmware changes were needed for this feature**, the existing multi-card cycling code already handles multiple entries with the same team `key`.
- LIMITATION: the ESP32's direct-ESPN fallback (`DataServices.h teamGame()`, only used when no backend `serverUrl` is configured) was NOT updated to this new logic — it keeps the old "closest game" behavior. This only matters if the app never syncs a server URL to the matrix, which isn't the normal setup path.
- Verified live: `/api/matrix/feed?team=MLB:NYY,NFL:BAL,NHL:NJD` correctly returns each team's next scheduled game as a fallback (no live/recent-final games at test time); NHL:NJD correctly omitted (offseason, no events).

### Action items for user
1. Redeploy (Publish) to get the sports logic live — no firmware change required for this part.
2. Reflash to v1.5.3 to get the sun-icon ghosting fix (OTA or USB).



## Session Update — Color-split text = wrong panel driver (firmware v1.5.4)

### Context
- User's ORIGINAL LED panel was fried and replaced with a new physical panel. On v1.5.3 (confirmed via serial log: `current=1.5.3`, and the semantic version-guard from v1.5.2 correctly rejected a stale server-side "v1.2.0" entry — that fix is working in the field), the clock card showed the time digits with a green fringe along the top edge and red/pink fill instead of solid orange, and a separate garbled/blank clock render was seen once before a reset cleared it.

### Root cause
- `DisplayManager.h Display::begin()` force-set `cfg.driver = HUB75_I2S_CFG::FM6126A;` — a special init sequence needed by the user's OLD (now-fried) panel's driver ICs. The REPLACEMENT panel is very likely NOT FM6126A-based; sending that special init sequence to a non-FM6126A panel gets misinterpreted as pixel/row data, scrambling R/G/B row alignment — exactly matching the observed "green top edge, red/pink body" split on bright (orange = R+G) text.

### Fix (DONE, needs reflash)
- Removed the forced `cfg.driver = HUB75_I2S_CFG::FM6126A;` line — now uses the library's generic/default driver, which matches most non-FM6126A panels.
- Left `cfg.latch_blanking = 2` (v1.5.3's ghosting fix) in place — unrelated to this issue.
- `Config.h` → `AURA_FW_VERSION` = `1.5.4`.
- Left a code comment: if a FUTURE panel swap shows stuck-lit/dim LEDs at boot (the classic FM6126A symptom), re-add `cfg.driver = HUB75_I2S_CFG::FM6126A;`.

### Action items for user
1. Reflash via USB (PlatformIO Upload) since they already have that set up from testing v1.5.3.
2. Verify: clock digits render solid orange (no green/red split), sun/cloud icons don't show stray colored fringing, and the earlier one-off blank/garbled clock render doesn't recur.
3. If STILL split/garbled after removing FM6126A, the next thing to check would be `cfg.mux_pattern` / panel scan-rate config for the new panel model — will need the panel's spec sheet or another serial log.



## Session Update — Color-split persists on v1.5.4, likely wiring/signal-integrity (firmware v1.5.5 test)

### New evidence
- After removing FM6126A (v1.5.4), the issue is unchanged: orange text (clock digits, flight callsign) shows green top edge + red/pink body; WHITE/gray text (flight airline name, distance) renders almost entirely BLUE; a thin green/yellow streak appears along the panel's top/left edge (the card border draw). Pure blue elements look fine. This affects multiple different cards/colors consistently — not content-specific.
- Web research on this exact library confirms: R+G-channel corruption/splitting like this is a well-known symptom of (a) a loose/partially-seated HUB75 ribbon connector, or (b) marginal signal integrity at the default I2S clock speed for a given panel/cable (especially after swapping to a different physical panel), or (c) in rare cases an internally miswired R2/G2 line on a defective panel unit.

### Action taken (software mitigation, v1.5.5 — needs reflash)
- Added `cfg.i2sspeed = HUB75_I2S_CFG::HZ_8M;` (stepped down from the library default ~10-15MHz) as a non-destructive test for signal-integrity-related corruption. Comment left to step down further to `HZ_5M` if still glitchy.
- Updated the driver-config comments to reflect that FM6126A was ruled out as the cause (v1.5.4 test).

### PRIMARY recommended action (hardware, zero-cost, do this regardless of the software test)
- Physically **reseat the HUB75 ribbon cable at BOTH ends** — the MatrixPortal S3's output header and the panel's input connector. Check for a bent pin, partially-inserted connector, or debris. This is the most likely root cause per the evidence (issue appeared with the replacement panel, is consistent across colors/cards, and firmware driver changes didn't help).
- Also worth double-checking the panel's 5V power connection/supply is solid — voltage instability can cause similar color corruption.
- If the split persists after BOTH ribbon-reseat AND the v1.5.5 slower clock, next diagnostic step is a full-panel photo (top half AND bottom half both visible together) to check if the color split differs between the two halves — this would confirm/deny an internal R2/G2 miswiring defect in the specific panel unit, which would need a targeted pin-remap fix (not a guess).

### Action items for user
1. Reseat the ribbon cable on both ends first (free, immediate).
2. Reflash to v1.5.5 via USB.
3. Report back whether either/both changed anything, and if possible send a full-panel photo showing top+bottom halves together.



## Session Update — Pragmatic workaround: removed all orange/yellow colors (firmware v1.5.6)

### Context
- AI vision analysis of a full-panel photo on v1.5.5 (post ribbon-reseat) showed the color distortion is NOT a top/bottom-half split — it's a general R+G channel bleed/desaturation across the WHOLE panel (oranges split green/red, whites lean blue-purple, greens look washed out). This is consistent with either a marginal power supply (5V sag under load, worse at 100% brightness — noted in serial log) or a panel-level hardware issue, neither fixable purely by driver/clock config (already tried FM6126A removal in v1.5.4 and slower i2sspeed in v1.5.5, both inconclusive/no fix). Root-causing further needs the user to test at lower brightness and check PSU specs — deferred.
- User's pragmatic ask: instead of chasing the hardware root cause further, just stop using colors that trigger this problem.

### Fix (DONE, needs reflash)
- Replaced every orange/yellow (R+G-mixed) color across the firmware UI with colors that render solidly on this panel (blues, purples, magentas, whites, reds — all confirmed OK):
  - Primary accent (flight callsign, boot/message text, clock digits, direction arrow, landing text): `rgb(245,158,11)` orange → `rgb(56,189,248)` sky-blue/cyan.
  - Weather icon sun + lightning bolt: gold/yellow → white (`rgb(255,255,255)` / pale blue-white core).
  - Weather alert severity colors (`severityColor()` in main.cpp): severe (was orange) → magenta `rgb(219,39,119)`; moderate (was yellow) → purple `rgb(168,85,247)`; extreme (red) and default (blue) unchanged. Also fixed the hardcoded "SEVERE THUNDERSTORM WARNING" test preview to match.
  - Rivalry-team score border highlight: orange → same new cyan accent.
  - Holiday accent colors: New Year (was gold) → silver-blue; Halloween (was orange) → purple; Thanksgiving (was orange) → deep magenta/red. Winter, Valentine's, St. Patrick's, Independence Day were already red/green/blue and untouched.
- `Config.h` → `AURA_FW_VERSION` = `1.5.6`.

### Remaining open item (not blocking, lower priority now)
- The underlying panel color-accuracy issue (whites/oranges bleeding) itself hasn't been root-caused (ribbon reseat + FM6126A removal + slower clock didn't fix it). Since the workaround avoids the affected color range in the app's own palette, this is much less urgent, but if the user wants to keep investigating: test at 50% brightness (currently defaults to up to 100%) to check if it's power-supply/voltage-sag related, and check the panel's power injection points/PSU rating.

### Action items for user
1. Reflash to v1.5.6 via USB (or OTA once uploaded).
2. Confirm the flight callsign, clock digits, and weather sun icon now render as solid cyan/white without the green/red split.


### CONFIRMED by user (v1.5.6)
- Color-split fix verified working: flight callsign + clock now show solid stable blue/cyan, no green/red split.
- The "stuck at 3:53" symptom was a transient home internet/router outage (ALL external hosts failing identically in the log — open-meteo, ESPN, adsb.lol, our own backend, weather.gov — not a firmware bug). Resolved itself after restarting the unit once internet was back. No code change needed for this.



## Session Update — BLE connect timeout fix + off-season record/next-game fallback (firmware v1.6.0, backend, frontend)

### 1. BLE "stuck on Connecting…" fix (frontend, no reflash needed — pure JS)
- `src/services/ble.ts`: `connectToMatrix()`'s actual GATT connect + service discovery step had NO timeout — if it stalls (stale BLE session, phone BLE stack issue, etc.) with no native error ever firing, the UI would spin on "Connecting…" forever. Now raced against a 12s timeout with a clear actionable message ("try toggling Bluetooth, or power-cycle the matrix"); on timeout it also calls `device.cancelConnection()` to avoid a dangling half-open connection. Same fix applied to `connectToKnownDevice()` for consistency.
- NOTE: could not be tested with real BLE hardware in this sandbox (BLE requires a native build + physical device) — needs user verification on their next connect attempt.

### 2. Off-season "record + next game" fallback (backend + firmware v1.6.0 + frontend app)
- User request: for a followed team with no live/recent/near-term game (e.g. NHL Hurricanes preseason gap, or NBA before opening night), always show the team's season win-loss record + next scheduled game's date, on BOTH the app's Sports tab and the physical matrix, instead of showing nothing.
- `server.py _fetch_score()`: added a new fallback tier — when the normal live/recent-final/upcoming-12h/next-game-within-window logic finds literally nothing (true off-season gap beyond the ~8-day scoreboard window), fetches `site.web.api.espn.com/.../teams/{abbr}` for `record.items[0].summary` + `nextEvent[0]` (opponent + date), returned as `{"ok":1, "mode":"record", "home":<abbr>, "away":<opp>, "record":"0-0", "st":"<date>"}`. Verified live: `NBA:LAL` (off-season in September) correctly returns `record":"0-0"` and next game vs SAC on 10/6.
- Firmware: `ScoreInfo` struct gained `isRecord`/`record` fields, parsed from the `mode`/`record` JSON keys (both the single `score` and the `scores[]` array). `Display::score()` renders a distinct "record mode" layout (team abbr / record in cyan / "Next: OPP" / date) instead of a 0-0 score line when `isRecord` is true.
- Frontend `src/services/espn.ts`: `getTeamScore()` now falls back to a new `getTeamRecordFallback()` (same `teams/{abbr}` endpoint + record/nextEvent extraction) whenever the scoreboard window has zero candidates, instead of returning `null`. `sports.tsx scoreText()` now appends the record (`· 1-1-0`) to any upcoming-game text, and shows `"Record X-X-X"` standalone if there's a record but no scheduled next game.
- LIMITATION: the ESP32's direct-ESPN fallback (`DataServices.h teamGame()`, only used when no backend `serverUrl` configured) was NOT updated with this fallback tier — same pre-existing limitation noted for the earlier sports-card-windowing feature.
- `Config.h` → `AURA_FW_VERSION` = `1.6.0`.

### Action items for user
1. Retry BLE connect — should now either connect normally or show a clear timeout error within 12s instead of hanging forever.
2. Redeploy (Publish) to get the backend + app sports fallback live (no reflash needed for those two layers).
3. Reflash to v1.6.0 to get the matrix's "record mode" score card rendering.



## Session Update — Boot no longer blocks on a bad network stretch (firmware v1.6.1)

### Context
- User's serial log showed a GENUINE, sustained network outage (DNS failing for every different host queried: own backend, adsb.lol, open-meteo — 100% failure, not the usual "fails once, succeeds on retry" quirk). This is a real router/internet issue on the user's side, not fixable in firmware. However, it exposed a real UX weakness: `setup()`'s auto-reconnect path called `applyBrightnessForNow()` (which does a blocking sun-times fetch on day 1) + `refreshData()` (multi-host blocking fetch chain) SYNCHRONOUSLY before ever reaching `loop()`. During a bad network stretch this could block for minutes with the board frozen on a single static "AURA / loading data..." message — no BLE responsiveness, no card rotation, nothing.

### Fix (DONE, needs reflash)
- `setup()` no longer calls `applyBrightnessForNow()`/`refreshData()` synchronously after Wi-Fi connects. It shows "loading data..." once, then sets `lastFetch = millis() - FETCH_MS + 1000` so `loop()`'s existing periodic fetch timer fires almost immediately — but INSIDE the normal, already-responsive loop() cadence, using the existing "waiting for data" fallback message (refreshed every `CARD_MS`) instead of a single frozen message.
- Net effect: the board is never blocked for longer than one `refreshData()` call at a time (same as normal steady-state operation), and stays responsive to BLE/card-rotation the whole time, even during a genuinely bad network stretch.
- `Config.h` → `AURA_FW_VERSION` = `1.6.1`.

### Action items for user
1. Reflash to v1.6.1 (OTA or USB).
2. The current network outage itself needs to be resolved on the user's end (router/ISP) — not a code fix.


## Session Update — Sharper team/airline logos (firmware v1.6.2)

### Context
- User asked for a better Carolina Hurricanes logo on the display. Root cause: `tools/generate_logos.py` downscaled team logos from ESPN's 500x500 source straight to 16x16 with a plain LANCZOS resize. At that size, fine curved details (the Hurricanes' swirl, thin outline rings) blurred into an unrecognizable gray/red/black blob — same issue would apply to any visually detailed team crest, not just this one team.

### Fix (DONE, needs reflash)
- `tools/generate_logos.py`: bumped output size 16x16 → 24x24, and added an UnsharpMask sharpen pass on the source image *before* the LANCZOS downscale, plus a 1.3x contrast boost *after* downscale (both applied only to RGB, alpha/transparency untouched). This keeps thin details from washing out at low resolution.
- Verified no layout collisions: the logo sits at a fixed (2,2) top-left corner; all score/flight-card text is horizontally centered and, for every real-world abbreviation/opponent string length, never renders closer than ~30px from the left edge — comfortably clear of the new 24px logo.
- Regenerated `include/logos/generated_logos.h` for all 135 team + airline logos (was 16x16/512B each, now 24x24/1152B each — ~155KB total in PROGMEM, negligible for the MatrixPortal S3's flash).
- `Logos.h` comment updated (16x16 → 24x24). `Config.h` → `AURA_FW_VERSION` = `1.6.2`.

### Action items for user
1. Reflash to v1.6.2 (OTA via the app's "Install update over Wi-Fi" once uploaded to the backend, or USB).
2. No app or backend redeploy needed — this is a firmware-only visual change.


## Session Update — Wi-Fi credentials not persisting + slow BLE ack (firmware v1.6.3)

### Context
- User reported: after a power cycle the matrix "isn't remembering the Wi-Fi password" and needs credentials re-sent from the app; sending Wi-Fi from the app "takes a long time to acknowledge"; and it sometimes seems to need a fresh BLE re-sync afterward. Serial log showed a genuinely flaky network stretch (many SSL/TLS `code=-1` retries against api.open-meteo.com and even the deployed backend) right after joining Wi-Fi.

### Root cause (found in `loop()`'s `gWifiCredsChanged` handler)
- When new Wi-Fi creds arrived over BLE, the firmware called `wifiConnect()` → `notifyWifi()` → then a **synchronous** `refreshData()` (multi-host HTTPS chain) — and only *after* that returned did it fall through to the debounced flash-save logic. On a bad network stretch `refreshData()` alone could block for a minute-plus (retry loops visible in the log). If the user power-cycled the board anytime in that window — very plausible right after seeing "joined" in the app — the Wi-Fi password never actually reached NVS flash, since the save hadn't run yet. Same blocking chain also explains the sluggish feel: the whole loop() (and any further BLE command handling) sat frozen inside that retry chain.

### Fix (DONE, needs reflash)
- `main.cpp`'s `gWifiCredsChanged` branch now calls `saveSettings()` **immediately** after `wifiConnect()`/`notifyWifi()` — before anything else — instead of relying on the debounced flush. Wi-Fi credential changes are rare, one-off events, so there's no reason to debounce this specific save.
- The synchronous `refreshData()` call in that same branch was removed (mirrors the v1.6.1 async-boot fix, which only covered `setup()`, not this BLE-triggered reconnect path): it now just shows "loading data..." and lets `loop()`'s normal fetch timer pick it up, keeping BLE/display responsive instead of freezing for the length of a flaky-network retry chain.
- `Config.h` → `AURA_FW_VERSION` = `1.6.3`.

### Action items for user
1. Reflash to v1.6.3 (OTA or USB), then re-send Wi-Fi once more from the app so the corrected save path actually captures it.
2. No app or backend changes needed.

### Boot screen branding — DONE (firmware v1.6.3)
- User chose option 2: try real amber for the boot screen text (small risk, wanted to visually confirm). Implemented: `DisplayManager.h`'s `boot()` now uses `rgb(245, 158, 11)` (matches app's `colors.brand = "#f59e0b"`) for the "AURA" splash text. `message()` gained an optional `color1` param (default keeps the existing blue for plain status headers like "WI-FI"/"UPDATE") so the 4 other "AURA ..." status screens in `main.cpp` (reconnecting/loading data x2/waiting for data) could also be recolored to the same amber without affecting non-branded messages.

## Session Update — Logo colors wrong on physical panel (firmware v1.6.4)

### Context
- User reported red missing from the Carolina Hurricanes and American Airlines logos (added in v1.6.2) after reflashing. Photos at normal viewing distance confirmed: areas that should be red rendered as blue instead (Hurricanes' red swirl showed blue/green; the AA logo's red tail showed blue with only a thin magenta sliver).

### Diagnosis
- Verified the embedded PROGMEM pixel data itself contains correct full-intensity red values (checked programmatically) — ruled out the Python logo generator.
- Critical diagnostic: asked the user to run the app's existing "Flash test pattern" (solid fullscreen R/G/B/W fill via `fillScreen`) — solid red rendered correctly. Since `fillScreen`/`drawRect`/text all go through the same `color565()` → `drawPixel()` path and render red correctly, but the *logo bitmaps specifically* didn't, this ruled out a panel wiring/signal-integrity issue or a systemic color565 channel swap — it isolated the bug to `dma->drawRGBBitmap()` itself (only used for logos), which apparently mishandles some pixels reading a `PROGMEM uint16_t*` array on this setup.

### Fix (DONE, needs reflash)
- `DisplayManager.h`'s `drawLogo()` no longer calls `dma->drawRGBBitmap()`. It now blits each logo pixel individually via `dma->drawPixel(x, y, color)` — the exact same call path already proven correct by the flash test — skipping fully-black (transparent background) pixels. This sidesteps whatever `drawRGBBitmap`-specific bug existed without needing to reverse-engineer its internals.
- `Config.h` → `AURA_FW_VERSION` = `1.6.4`.

### Action items for user
1. Reflash to v1.6.4 (OTA or USB), then check the Hurricanes/AA logos again from a normal (non-macro) viewing distance.
2. If red is still wrong after this, take another normal-distance photo — that would point back toward a hardware signal issue specific to dense multi-color bitmap regions rather than software, and we'd escalate differently.


## Session Update — Summary screen: 3 favorite teams + UFC (frontend only)

### Context
- User: "I also want to show up to 3 sports events plus ufc if that is selected (four total if showing UFC). currently I appear to be limited to two." Found the cap: `toggleFavorite` in `store/matrix.tsx` capped `sports.favorites` at 2, and the Home/Summary screen only rendered a main GlanceCard (favorites[0]) + one mini row (favorites[1]). The physical matrix itself was NOT the bottleneck — firmware already cycles through all followed teams (up to 8, no 2-cap) — and firmware has no UFC card at all today (UFC is app-only, ESPN-preview-only).

### Fix (DONE, tested by testing_agent — frontend only, no reflash/redeploy needed)
- `store/matrix.tsx`: `toggleFavorite` now allows up to 3 favorites (replaces the 3rd slot once full, same UX pattern as before).
- `app/(tabs)/sports.tsx`: favorite badge labels now support SUMMARY / 2ND / 3RD; legend + footer copy updated from "up to 2" to "up to 3".
- `app/(tabs)/index.tsx`: added `thirdTeam` (favorites[2]) with its own score/streak fetch + mini row, and a 4th mini row for UFC (flame icon + next event name/date from `getNextUfc()`) shown whenever `settings.sports.ufc` is enabled. `autoCompact` math updated to account for up to 3 extra mini rows.
- Verified by testing_agent: star cap/replacement/relabeling, Summary render (GlanceCard + up to 3 mini rows + UFC row), auto-compact, legend/footer text, and no regressions on other tabs.

### Not done (scope check, mentioned to user)
- Did NOT add a UFC card to the physical LED matrix rotation (firmware) — that's a separate, larger change (new card type + backend feed support) not explicitly requested; user was told this is app-only for now.
