# Aura — BLE JSON Contract (app ⇄ MatrixPortal ESP32-S3)

The Aura app talks to the matrix over a single BLE characteristic.

- **Device name (advertised):** `AuraMatrix` (app matches any name starting `Aura`)
- **Service UUID:** `4fafc201-1fb5-459e-8fcc-c5c9c331914b`
- **Characteristic UUID:** `beb5483e-36e1-4688-b7f5-ea07361b26a8`
  - Properties: **READ | WRITE | NOTIFY**

### Encoding
The app writes a **UTF-8 JSON string**. `react-native-ble-plx` base64-encodes the
bytes on the JS side, but the ESP32 receives **raw UTF-8** — feed it straight to
`ArduinoJson`. **Do not base64-decode on the firmware.**

---

## 1. Full sync (persist + confirm)
Sent on connect and when the user taps **SYNC**.
```json
{
  "flights": { "enabled": true, "lat": 35.501, "lon": -80.874, "radiusMi": 25, "trackFlight": false, "flightIdent": "", "landingAlert": true },
  "sports":  { "enabled": true, "ufc": false, "teams": ["NFL:DAL", "NBA:LAL"], "rivals": ["NFL:DAL"] },
  "weather": { "enabled": true, "severity": "severe", "showClock": true },
  "brightness": 80,
  "holidayThemes": true,
  "nightMode": { "enabled": true, "startHour": 22, "endHour": 7, "dimLevel": 20, "weekend": { "enabled": false, "startHour": 23, "endHour": 8, "dimLevel": 20 } },
  "syncedAt": 1717000000000
}
```
The firmware sets the characteristic value to `{"ack":true,"syncedAt":<n>}` so the
app's read-back **confirmed** succeeds.

## 2. Live commands (debounced, while connected)
Each field edit pushes just its section:
```json
{ "command": "flights", "enabled": true, "lat": 35.5, "lon": -80.8, "radiusMi": 30, "trackFlight": true, "flightIdent": "AAL123", "landingAlert": true }
{ "command": "sports",  "enabled": true, "ufc": true, "teams": ["MLB:NYY"], "rivals": ["MLB:NYY"] }
{ "command": "weather", "enabled": true, "severity": "moderate", "showClock": true }
{ "command": "holiday", "enabled": true }
{ "command": "markets", "enabled": true }
{ "command": "brightness", "value": 60 }
{ "command": "night", "enabled": true, "startHour": 22, "endHour": 7, "dimLevel": 20, "weekend": { "enabled": true, "startHour": 23, "endHour": 8, "dimLevel": 30 } }
```
`teams` entries are always `"<LEAGUE>:<ABBR>"` where LEAGUE ∈ NFL|NBA|MLB|NHL and
ABBR is the ESPN abbreviation. The **order** of the array is the rotation order
shown on the matrix (set by drag-to-reorder in the app).

`markets` (firmware ≥ 1.6.33, default off) adds an S&P 500 / Dow 30 / Nasdaq card; the
matrix then calls `/api/matrix/feed?...&markets=1` and the backend returns
`markets: {ok, status: OPEN|PRE|AFTER|CLOSED, idx: [{n, v, c, p, sp[], spn, b}]}`.

`severity` ∈ `minor | moderate | severe | extreme` (minimum threshold to display).
`brightness` ∈ `0–100` (%). `nightMode` auto-dims to `dimLevel` between
`startHour`/`endHour` (0–23, may wrap past midnight); the firmware syncs time via
NTP (set your timezone with `TZ_INFO` in `main.cpp`).

When `flights.trackFlight` is true and `flightIdent` is set (e.g. `"AAL123"`), the
matrix pins that one flight (via adsb.lol `/v2/callsign/<ident>`) instead of the
nearest aircraft, draws a heading arrow, and — if `landingAlert` is on — flashes a
"DESCENDING / LANDED" card when that flight drops sharply or gets very low.

`nightMode.weekend` (when `enabled`) overrides the weekday schedule on Sat/Sun.

`sports.rivals` are starred teams (subset of `teams`) the matrix draws with a
bright amber border. `weather.showClock` adds a time + temperature card (temp via
open-meteo, keyless). `holidayThemes` lets the wall tint its accent on holidays.

## 3. Wi-Fi provisioning
```json
{ "command": "wifi", "ssid": "MyHomeWiFi", "pass": "hunter2" }
```

## 4. One-shot tests
```json
{ "command": "flash_test", "ts": 1717000000000 }
{ "command": "weather_test", "ts": 1717000000000 }
```
`weather_test` flashes a sample "SEVERE THUNDERSTORM WARNING" card so you can see
the alert layout without waiting for real weather.

---

## Notify back → app (same characteristic)
After a Wi-Fi join attempt, the firmware **notifies** one of:
```json
{ "wifiStatus": "connected", "ip": "192.168.1.42" }
{ "wifiStatus": "failed" }
```
The Device tab shows a live banner: *sending → waiting → joined <ip> / failed*.

## Firmware 1.6.35 additions

- **Frames are applied in `loop()`**, not in the NimBLE callback: the BLE task only queues
  the raw write (repeats of the same settings section merge), so config writes can no longer
  race the main loop's reads of the settings strings.
- **Acks:** after applying a settings command the matrix notifies `{"ack":"<command>"}`
  (`weather` also carries `"loc2":true|false`). The app's Sync waits for the `server` ack.
- **Second location (weather):** `{"command":"weather",...,"loc2":true,"lat2":25.77,"lon2":-80.19,"where2":"Miami FL"}`
  or `"loc2":false` to clear (absent = unchanged). The feed is called with `&lat2=&lon2=` and its
  `alert2` is shown as its own alert card, prefixed with the place (e.g. `MIAMI FL: HURRICANE WARNING`).
- **`version` / ready value** now include `"rst"`, the reset reason of the current boot
  (`poweron`, `sw`, `panic`, `task_wdt`, `int_wdt`, `wdt`, `brownout`, ...).
