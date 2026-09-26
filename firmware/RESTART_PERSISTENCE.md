# Restart and persistence behavior

Firmware 1.6.7 loads the saved NVS configuration before Bluetooth advertising
and starts Wi-Fi without blocking the display. It shows the clock fallback
immediately, using `--:--` until network time is available. Flight, weather,
and sports cards still need live data before they appear.

The Wi-Fi command now writes the credentials and full settings JSON to NVS
before joining the network. Other setting changes are saved after a four
second debounce; a potentially long HTTPS refresh waits until that save
completes. NVS open/write errors are logged and retried. A failed Wi-Fi join
times out after 15 seconds, reports failure to the app, and retries after
30 seconds. The app's Install update action still checks OTA; automatic OTA
checks at startup were removed because they can block display updates.

The app stores its own settings on the phone and automatically sends them
when it connects over Bluetooth. This can replace the device's saved settings
with an older phone copy. The matrix should boot from NVS without opening the
app; test that first, then reconnect the app and check whether its settings
match. A newly provisioned unit still needs the app to send Wi-Fi credentials.
Wi-Fi passwords are stored in ESP32 NVS as part of the settings JSON; firmware
updates should preserve the NVS partition, but erase-flash/factory reset will
remove them.

## Physical check

1. Flash 1.6.7 and configure Wi-Fi/settings once. Wait at least five seconds
   after the last settings change before removing power.
2. Reboot without opening the app. The clock placeholder should appear quickly;
   Wi-Fi should join and live cards should follow when network requests finish.
3. Compare brightness, enabled cards, and night settings. If they differ,
   capture serial lines starting `[NVS]`, `[NET]`, and `[CARD]`.
4. Reconnect the app. It automatically pushes the phone's saved settings,
   so compare again after connection.
