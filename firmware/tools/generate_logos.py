#!/usr/bin/env python3
"""
Generate embedded RGB565 logo bitmaps for the Aura matrix firmware.

Downloads team logos from ESPN's CDN and airline logos from Google Flights,
fits them inside a 24x24 canvas without distortion, composites over black, converts to RGB565,
and writes C arrays + registry tables to include/logos/generated_logos.h.

Run:  python3 tools/generate_logos.py
Re-run any time you tweak the team/airline lists below.
"""
import io
import os
import sys
import requests
from PIL import Image

# The existing flight/score card layout reserves a 24x24 corner for logos.
# Enlarging this also requires moving card text and the heading arrow.
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
    """Fit artwork within the reserved square and blend edge pixels over black.

    Keep RGB565 output and the existing 24x24 asset shape compatible with the
    firmware. Transparent padding preserves each logo's original proportions.
    """
    img = img.convert("RGBA")
    img.thumbnail((SIZE, SIZE), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.alpha_composite(img, ((SIZE - img.width) // 2,
                                 (SIZE - img.height) // 2))

    out = []
    for r, g, b, a in canvas.getdata():
        # Alpha is coverage. Blend in linear light to keep small curved edges
        # visible after the final RGB565 quantization.
        coverage = a / 255.0
        r = round(255 * ((r / 255.0) ** 2.2 * coverage) ** (1 / 2.2))
        g = round(255 * ((g / 255.0) ** 2.2 * coverage) ** (1 / 2.2))
        b = round(255 * ((b / 255.0) ** 2.2 * coverage) ** (1 / 2.2))
        out.append(((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3))
    return out


def clean_delta_widget(pixels):
    """Keep the 24px Delta widget crisp on an RGB LED panel.

    The tiny Google Flights PNG contributes almost-black antialiasing and an
    isolated baseline. Quantize its red silhouette to two opaque reds and
    leave the dark gaps transparent. This retains the widget's proportions.
    """
    bright_red = (29 << 11) | (7 << 5) | 7
    shaded_red = (19 << 11) | (6 << 5) | 6
    cleaned = []
    for index, pixel in enumerate(pixels):
        x, y = index % SIZE, index // SIZE
        red = (pixel >> 11) & 31
        if red < 12 or y >= SIZE - 2:
            cleaned.append(0)
        else:
            cleaned.append(bright_red if x < SIZE // 2 else shaded_red)
    return cleaned


def clean_american_red(pixels):
    """Keep the red half of the American mark red on the LED panel.

    The source PNG mixes some blue and green into its red antialiasing. Preserve
    each pixel's red intensity while dropping those channels in red-dominant
    pixels; leave its blue and white portions untouched.
    """
    cleaned = []
    for pixel in pixels:
        red, green, blue = (pixel >> 11) & 31, (pixel >> 5) & 63, pixel & 31
        if red >= 6 and red > green and 5 * red > 8 * blue:
            cleaned.append(red << 11)
        else:
            cleaned.append(pixel)
    return cleaned

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
        pixels = to_rgb565_array(img)
        if icao == "AAL":
            pixels = clean_american_red(pixels)
        elif icao == "DAL":
            pixels = clean_delta_widget(pixels)
        arrays.append(emit_array(name, pixels))
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
