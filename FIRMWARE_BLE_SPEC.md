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
  "flights": { "enabled": true, "lat": 35.501, "lon": -80.874, "radiusMi": 25 },
  "sports":  { "enabled": true, "ufc": false, "teams": ["NFL:DAL", "NBA:LAL"] },
  "weather": { "enabled": true, "severity": "severe" },
  "syncedAt": 1717000000000
}
```
The firmware sets the characteristic value to `{"ack":true,"syncedAt":<n>}` so the
app's read-back **confirmed** succeeds.

## 2. Live commands (debounced, while connected)
Each field edit pushes just its section:
```json
{ "command": "flights", "enabled": true, "lat": 35.5, "lon": -80.8, "radiusMi": 30 }
{ "command": "sports",  "enabled": true, "ufc": true, "teams": ["MLB:NYY"] }
{ "command": "weather", "enabled": true, "severity": "moderate" }
```
`teams` entries are always `"<LEAGUE>:<ABBR>"` where LEAGUE ∈ NFL|NBA|MLB|NHL and
ABBR is the ESPN abbreviation.

`severity` ∈ `minor | moderate | severe | extreme` (minimum threshold to display).

## 3. Wi-Fi provisioning
```json
{ "command": "wifi", "ssid": "MyHomeWiFi", "pass": "hunter2" }
```

## 4. Flash test
```json
{ "command": "flash_test", "ts": 1717000000000 }
```

---

## Notify back → app (same characteristic)
After a Wi-Fi join attempt, the firmware **notifies** one of:
```json
{ "wifiStatus": "connected", "ip": "192.168.1.42" }
{ "wifiStatus": "failed" }
```
The Device tab shows a live banner: *sending → waiting → joined <ip> / failed*.
