# Aura Matrix — Firmware (MatrixPortal ESP32-S3, 128×64 HUB75)

PlatformIO/Arduino firmware for the **Adafruit MatrixPortal ESP32-S3** driving a
**128×64 HUB75 RGB LED matrix**. It pairs with the **Aura** phone app: the app
provisions Wi-Fi + display settings over **Bluetooth LE**, then the matrix fetches
live data over **Wi-Fi** and renders it.

## Data sources (all keyless)
| Feature  | Source            | Notes |
|----------|-------------------|-------|
| Flights  | `api.adsb.lol`    | Nearest ADS-B aircraft within your radius |
| Sports   | ESPN public JSON  | NFL / NBA / MLB / NHL scores (UFC card stub ready) |
| Weather  | `api.weather.gov` | US National Weather Service active alerts |

## Getting started
1. Install **VS Code** + the **PlatformIO IDE** extension.
2. Open this `/firmware` folder in VS Code.
3. Plug in the MatrixPortal S3, click **Upload** (→ arrow in the PlatformIO bar).
4. Open the **Serial Monitor** (115200 baud) to watch logs.
5. Launch the Aura app → **Device** tab → connect → send Wi-Fi → configure tabs.

## Panel geometry
Default assumes **two 64×64 modules chained** = 128×64 (`include/Config.h`):
```c
#define PANEL_RES_X 64
#define PANEL_RES_Y 64
#define PANEL_CHAIN 2
```
For a single native 128×64 module use `PANEL_RES_X 128 / PANEL_CHAIN 1`.
On many 64×64 panels you must bridge the **E** address line — see Adafruit's
MatrixPortal S3 guide.

## File map
- `platformio.ini` — board, PSRAM flags, libraries.
- `include/Config.h` — panel size, BLE UUIDs, settings struct, global flags.
- `include/BleProvisioning.h` — NimBLE server; parses app JSON, notifies Wi-Fi status.
- `include/DataServices.h` — HTTPS fetchers for flights/sports/weather.
- `include/DisplayManager.h` — HUB75 init + card drawing helpers.
- `src/main.cpp` — boot, Wi-Fi connect, fetch loop, card rotation.

## BLE contract
See [`/app/FIRMWARE_BLE_SPEC.md`](../FIRMWARE_BLE_SPEC.md) for the exact JSON the
app writes and the Wi-Fi status the firmware notifies back.

## Notes
- HTTPS uses `setInsecure()` for a simple start. For production, load a root CA.
- Airline/team **logos** are stubbed as text; drop 1-bit or RGB565 bitmaps into
  `DisplayManager` and blit them in `flight()` / `score()` when ready.

## Troubleshooting: "I reflashed but nothing looks different"
Before assuming a code fix didn't work, confirm the **board itself** is actually
running the new build — it's easy to flash a stale checkout without realizing it.

1. **Check the version actually on the board.** Open the Aura app → Device tab →
   connect → tap the hidden "About" reveal. It shows the firmware's live
   `AURA_FW_VERSION` string, read fresh over BLE on every connect (not cached).
   Compare it to `#define AURA_FW_VERSION` in `include/Config.h` — they must match.
2. **If the app shows an older version than expected**, the board didn't get the
   new code. Before re-uploading, in your local `firmware/` folder run:
   ```
   git log --oneline -5           # confirms which commits you actually have
   grep AURA_FW_VERSION include/Config.h   # confirms the version in the file about to compile
   ```
   If either doesn't match what you expect, the **pull** failed (wrong branch,
   stale/detached clone, or the "Save to GitHub" push hadn't happened yet before
   you pulled) — fix that before re-uploading, a rebuild of stale code will not help.
3. **If the pull is confirmed correct but the board still shows the old version**,
   force a clean build before uploading (stale `.pio` object cache can occasionally
   skip relinking on header-only changes):
   ```
   pio run -t clean
   pio run -t upload
   ```
4. Only once the About screen confirms the *new* version number should you judge
   whether a visual/behavior fix actually worked.
