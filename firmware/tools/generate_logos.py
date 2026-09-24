#!/usr/bin/env python3
"""
Generate embedded RGB565 logo bitmaps for the Aura matrix firmware.

Downloads team logos from ESPN's CDN and airline logos from Google Flights,
resizes them to 16x16, composites transparency over black, converts to RGB565,
and writes C arrays + registry tables to include/logos/generated_logos.h.

Run:  python3 tools/generate_logos.py
Re-run any time you tweak the team/airline lists below.
"""
import io
import os
import sys
import requests
from PIL import Image, ImageFilter, ImageEnhance

# Bumped from 16 -> 24: at 16px the fine curves on detailed logos (e.g. the
# Carolina Hurricanes swirl) blurred into an unrecognizable blob. 24px still
# fits cleanly in the corner of a score/flight card with no text overlap
# (centered card text never reaches inside x=2..26 on the 128-wide panel).
SIZE = 24
OUT = os.path.join(os.path.dirname(__file__), "..", "include", "logos", "generated_logos.h")

TEAMS = {
    "NFL": ["ARI","ATL","BAL","BUF","CAR","CHI","CIN","CLE","DAL","DEN","DET","GB",
            "HOU","IND","JAX","KC","LV","LAC","LAR","MIA","MIN","NE","NO","NYG","NYJ",
            "PHI","PIT","SF","SEA","TB","TEN","WSH"],
    "NBA": ["ATL","BOS","BKN","CHA","CHI","CLE","DAL","DEN","DET","GS","HOU","IND",
            "LAC","LAL","MEM","MIA","MIL","MIN","NO","NY","OKC","ORL","PHI","PHX",
            "POR","SAC","SA","TOR","UTAH","WSH"],
    "MLB": ["ARI","ATL","BAL","BOS","CHC","CHW","CIN","CLE","COL","DET","HOU","KC",
            "LAA","LAD","MIA","MIL","MIN","NYM","NYY","OAK","PHI","PIT","SD","SF",
            "SEA","STL","TB","TEX","TOR","WSH"],
    "NHL": ["ANA","BOS","BUF","CGY","CAR","CHI","COL","CBJ","DAL","DET","EDM","FLA",
            "LA","MIN","MTL","NSH","NJ","NYI","NYR","OTT","PHI","PIT","SJ","SEA",
            "STL","TB","TOR","VAN","VGK","WSH","WPG"],
}

# ICAO callsign prefix -> IATA code for Google Flights logos.
AIRLINES = {
    "AAL": "AA", "DAL": "DL", "UAL": "UA", "SWA": "WN", "JBU": "B6",
    "NKS": "NK", "FFT": "F9", "SKW": "OO", "ASA": "AS", "HAL": "HA",
    "AAY": "G4", "SCX": "SY",
}

session = requests.Session()
session.headers.update({"User-Agent": "Mozilla/5.0 AuraLogoGen"})


def to_rgb565_array(img):
    # Sharpen the source BEFORE downscaling so fine details (thin outlines,
    # curved wordmarks) survive the resize instead of blurring into mush.
    img = img.convert("RGBA")
    r, g, b, a = img.split()
    rgb = Image.merge("RGB", (r, g, b)).filter(
        ImageFilter.UnsharpMask(radius=2, percent=150, threshold=2)
    )
    img = Image.merge("RGBA", (*rgb.split(), a))

    # High quality resize, then a contrast bump so the few pixels each shape
    # gets at this size stay bold/legible instead of washing out to gray.
    img = img.resize((SIZE, SIZE), Image.LANCZOS)
    r, g, b, a = img.split()
    rgb = ImageEnhance.Contrast(Image.merge("RGB", (r, g, b))).enhance(1.3)
    img = Image.merge("RGBA", (*rgb.split(), a))

    px = img.load()
    out = []
    for y in range(SIZE):
        for x in range(SIZE):
            r, g, b, a = px[x, y]
            if a < 96:                       # drop faint anti-aliased edges
                r = g = b = 0
            else:                            # composite opaque-ish pixel over black
                r = r * a // 255
                g = g * a // 255
                b = b * a // 255
                if max(r, g, b) < 24:        # kill muddy near-black specks
                    r = g = b = 0
            out.append(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))
    return out


def fetch(url):
    try:
        r = session.get(url, timeout=15)
        if r.status_code == 200 and r.content:
            return Image.open(io.BytesIO(r.content))
    except Exception as e:
        print(f"  ! {url}: {e}")
    return None


def emit_array(name, data):
    lines = [f"static const uint16_t {name}[{SIZE*SIZE}] PROGMEM = {{"]
    for i in range(0, len(data), 12):
        chunk = ", ".join(f"0x{v:04X}" for v in data[i:i+12])
        lines.append("  " + chunk + ",")
    lines.append("};")
    return "\n".join(lines)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    arrays, teams_tbl, air_tbl = [], [], []
    ok = skip = 0

    for league, abbrs in TEAMS.items():
        print(f"[{league}]")
        for abbr in abbrs:
            url = f"https://a.espncdn.com/i/teamlogos/{league.lower()}/500/{abbr.lower()}.png"
            img = fetch(url)
            if img is None:
                skip += 1
                continue
            name = f"L_{league}_{abbr}".replace("-", "_")
            arrays.append(emit_array(name, to_rgb565_array(img)))
            teams_tbl.append(f'  {{ "{league}:{abbr}", {name}, {SIZE}, {SIZE} }},')
            ok += 1

    print("[airlines]")
    for icao, iata in AIRLINES.items():
        url = f"https://www.gstatic.com/flights/airline_logos/70px/{iata}.png"
        img = fetch(url)
        if img is None:
            skip += 1
            continue
        name = f"A_{icao}"
        arrays.append(emit_array(name, to_rgb565_array(img)))
        air_tbl.append(f'  {{ "{icao}", {name}, {SIZE}, {SIZE} }},')
        ok += 1

    with open(OUT, "w") as f:
        f.write("// AUTO-GENERATED by tools/generate_logos.py — do not edit by hand.\n")
        f.write("// Included by Logos.h AFTER the LogoAsset struct is defined.\n")
        f.write("#pragma once\n#include <Arduino.h>\n\n")
        f.write("\n\n".join(arrays))
        f.write("\n\nstatic const LogoAsset TEAM_LOGOS[] = {\n")
        f.write("\n".join(teams_tbl) if teams_tbl else "")
        f.write("\n};\n\nstatic const LogoAsset AIRLINE_LOGOS[] = {\n")
        f.write("\n".join(air_tbl) if air_tbl else "")
        f.write("\n};\n")

    print(f"\nDone: {ok} logos embedded, {skip} skipped -> {os.path.relpath(OUT)}")


if __name__ == "__main__":
    main()
