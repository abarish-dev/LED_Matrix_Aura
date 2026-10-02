# Logo rendering work

The panel configuration is a single native 128×64 HUB75 module. The firmware
currently draws flight and score cards as text; both logo overlay calls in
`src/main.cpp` are commented out because red and blue appeared wrong even
when individual pixels were drawn. The asset generator and checked-in bitmaps are updated; ordinary flight and
score cards still do not show logos.

`tools/generate_logos.py` now fits each source within the existing 24×24
layout without stretching it, blends translucent edges over black, and keeps
the same RGB565 format. The checked-in `include/logos/generated_logos.h` was regenerated with all
135 assets present and zero skipped downloads.

Flash firmware version 1.6.6 with a regulated 5V supply, then run the
existing app's flash test. It now shows the usual solid colors followed by
a 2.5-second AA logo beside red/green/blue reference squares. Verify the
logo's red and blue channels match the reference squares. If red/blue separation
persists, investigate the panel scan mapping, ribbon seating, and supply
under load. Art changes cannot repair a color-channel fault.

Once color is verified, re-enable one airline logo in the flight card and
check it on the physical display. The 24×24 reserved area shares the upper
right with the heading arrow; adjust card layout before moving to larger
logos. Re-enable team logos separately after confirming text remains legible.
The app sends settings over BLE and does not send these bitmap assets.
Firmware changes require a new firmware build and flash or OTA deployment;
there is no app-side protocol change in this branch.

## Hand-tuned 24px marks (v1.6.31)

`NATIVE_TEAM_MARKS` in `tools/generate_logos.py` maps league/team keys to
pixel-art marks drawn at panel resolution instead of downsampling ESPN art.
Current entries: Panthers (NHL:FLA), the 2026 Titans roundel (NFL:TEN),
Buccaneers flag (NFL:TB), Lightning bolt (NHL:TB), Rays TB (MLB:TB) and
Capitals (NHL:WSH), drawn as the Capitol dome over crossed red sticks. These marks use only black, white, pure red, and blues
(plus pewter gray on the Bucs pole). They avoid gold and yellow because R+G
mixes split on this panel.
