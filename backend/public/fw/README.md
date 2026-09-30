# Firmware OTA files

Vercel serves everything in `backend/public/` from its CDN, so the matrices
download new firmware from `<server>/fw/firmware.bin`. The API no longer
accepts uploads (`POST /api/firmware/upload` returns **410 Gone**) because the
serverless filesystem is read-only.

`GET /api/firmware/latest` reads `meta.json` from this folder. It reports
`available: false` / `update: false` until `firmware.bin` exists here.

## Publishing a new build

1. Bump `AURA_FW_VERSION` in `firmware/include/Config.h` (for example `1.6.31`).
   Matrices only install a version strictly **higher** than the one they run.
2. Build in PlatformIO (`pio run`). The output is
   `firmware/.pio/build/<env>/firmware.bin`.
3. Copy it here as `backend/public/fw/firmware.bin`.
4. Update `meta.json` so `version` matches Config.h exactly and `size` is the
   byte size of the .bin:
   ```json
   { "version": "1.6.31", "size": 1234567 }
   ```
   (`stat -c %s firmware.bin` on Linux, `stat -f %z firmware.bin` on macOS.)
5. Commit both files and push/redeploy. Check
   `<server>/api/firmware/latest?current=1.6.30`: it should return
   `"available": true, "update": true, "url": "/fw/firmware.bin"`.

To pull a bad build, delete `firmware.bin` (or roll back `meta.json`) and
redeploy.
