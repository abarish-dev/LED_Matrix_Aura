# Logo rendering work

The panel configuration is a single native 128×64 HUB75 module. The firmware
currently draws flight and score cards as text; both logo overlay calls in
`src/main.cpp` are commented out because red and blue appeared wrong even
when individual pixels were drawn. A new asset generator alone does not turn
logos back on, and it does not update existing generated bitmaps.

`tools/generate_logos.py` now fits each source within the existing 24×24
layout without stretching it, blends translucent edges over black, and keeps
the same RGB565 format. The checked-in `include/logos/generated_logos.h` is
still the old output. Regenerate it in an environment that can reach ESPN and
Google Flights, inspect the resulting logos, and commit it before flashing.
The script reports skipped downloads; check that count before accepting output.

Before enabling overlays, flash the firmware with a regulated 5V supply and
use the existing app's flash test pattern. Verify red, green, blue, and white
in each half of the panel, including mixed-color text. If red/blue separation
persists, investigate the panel scan mapping, ribbon seating, and supply
under load. Art changes cannot repair a color-channel fault.

Once color is verified, re-enable one airline logo in the flight card and
check it on the physical display. The 24×24 reserved area shares the upper
right with the heading arrow; adjust card layout before moving to larger
logos. Re-enable team logos separately after confirming text remains legible.
The app sends settings over BLE and does not send these bitmap assets.
Firmware changes require a new firmware build and flash or OTA deployment;
there is no app-side protocol change in this branch.
