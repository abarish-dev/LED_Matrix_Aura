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
    bright_red = 29 << 11
    shaded_red = 19 << 11
    cleaned = []
    for index, pixel in enumerate(pixels):
        x, y = index % SIZE, index // SIZE
        red = (pixel >> 11) & 31
        if red < 12 or y >= SIZE - 2:
            cleaned.append(0)
        else:
            cleaned.append(bright_red if x < SIZE // 2 else shaded_red)
    return cleaned


def clean_hurricanes_logo(pixels):
    """Reduce the Hurricanes mark to opaque red, white and black.

    Tiny translucent fringe pixels from the source turn into colored speckles
    on the LED panel. Keep the hurricane silhouette and its white rings.
    """
    cleaned = []
    for pixel in pixels:
        red = ((pixel >> 11) & 31) * 255 // 31
        green = ((pixel >> 5) & 63) * 255 // 63
        blue = (pixel & 31) * 255 // 31
        if red >= 85 and 4 * red > 5 * green and 4 * red > 5 * blue:
            cleaned.append(0xD800)
        elif max(red, green, blue) >= 130 and min(red, green, blue) >= 35:
            cleaned.append(0xFFFF)
        else:
            cleaned.append(0)
    return cleaned


def logo_rgb(pixel):
    """Expand RGB565 channels for stable, palette-based pixel decisions."""
    return ((pixel >> 11 & 31) * 255 // 31,
            (pixel >> 5 & 63) * 255 // 63,
            (pixel & 31) * 255 // 31)


def rgb565(r, g, b):
    """Pack a true 8-bit color into RGB565, matching to_rgb565_array's rounding."""
    return ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)


def clean_panthers_logo(pixels):
    """Sharpen Florida's leaping panther into flat red, gold, navy and white.

    Sampled pixels from the source PNG: a red shield band (224,0,32),
    gold head (192,144,80), navy face line-art (0,16,64) and white
    highlights (240,240,240). The navy carries the panther's facial
    features, so it is quantized to a bright flat blue instead of being
    dropped -- that removes the blurry anti-aliasing without erasing
    the face detail.
    """
    RED = rgb565(230, 0, 20)
    GOLD = rgb565(255, 191, 106)
    NAVY = rgb565(20, 70, 220)
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        maximum, minimum = max(red, green, blue), min(red, green, blue)
        if maximum < 30:
            cleaned.append(0)
        elif minimum > 170 and maximum - minimum < 55:
            cleaned.append(0xFFFF)
        elif blue > red and blue > green and blue > 30:
            cleaned.append(NAVY)
        elif red > 110 and green < 70 and red > blue * 1.4:
            cleaned.append(RED)
        elif red > 90 and green > 60 and red > blue * 1.3 and green > blue:
            cleaned.append(GOLD)
        else:
            cleaned.append(0)
    return cleaned


def clean_predators_logo(pixels):
    """Keep Nashville's saber-toothed cat legible in gold, navy and white."""
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        maximum, minimum = max(red, green, blue), min(red, green, blue)
        if maximum < 46:
            cleaned.append(0)
        elif minimum > 130 and maximum - minimum < 85:
            cleaned.append(0xFFFF)
        elif red > 95 and green > 55 and red > blue * 1.35 and green > blue * .95:
            cleaned.append(0xFDA0)
        elif blue > 55 and blue > red * 1.03:
            cleaned.append(0x00B0)
        elif minimum > 95:
            cleaned.append(0xFFFF)
        elif red > 80 and green > 45 and red > blue * 1.25:
            cleaned.append(0xFDA0)
        elif blue > 43:
            cleaned.append(0x00B0)
        else:
            cleaned.append(0)
    return cleaned


def clean_cowboys_logo(pixels):
    """Keep the white star and blue outline, dropping dim color fringes."""
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        if max(red, green, blue) < 38:
            cleaned.append(0)
        elif min(red, green, blue) > 87 and max(red, green, blue) - min(red, green, blue) < 85:
            cleaned.append(0xFFFF)
        else:
            cleaned.append(0x0018)
    return cleaned


def clean_ravens_logo(pixels):
    """Keep the bird's purple, gold and white details at 24px."""
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        if max(red, green, blue) < 52:
            cleaned.append(0)
        elif min(red, green, blue) > 113 and max(red, green, blue) - min(red, green, blue) < 70:
            cleaned.append(0xFFFF)
        elif red > 82 and green > 41 and red > blue * 1.25:
            cleaned.append(0xFDE0)
        elif red > 40 or blue > 42:
            cleaned.append(0x4814)
        else:
            cleaned.append(0)
    return cleaned


def clean_southwest_heart(pixels):
    """Keep the heart's red, blue, yellow and white regions distinct."""
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        if max(red, green, blue) < 62:
            cleaned.append(0)
        elif red > 90 and green > 70 and red > blue * 1.4 and green > blue * 1.3:
            cleaned.append(0xFDE0)
        elif red > 80 and red > green * 1.45 and red > blue * 1.2:
            cleaned.append(0xE000)
        elif blue > 70 and blue > red * .9:
            cleaned.append(0x001E)
        elif min(red, green, blue) > 92:
            cleaned.append(0xFFFF)
        elif red > blue * 1.35:
            cleaned.append(0xE000)
        else:
            cleaned.append(0x001E)
    return cleaned


def clean_united_globe(pixels):
    """Keep the white globe lines on a solid blue 24px field."""
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        if min(red, green, blue) > 90 and max(red, green, blue) - min(red, green, blue) < 110:
            cleaned.append(0xFFFF)
        else:
            cleaned.append(0x0018 if max(red, green, blue) >= 55 else 0)
    return cleaned


def clean_yankees_logo(pixels):
    """Brighten the thin navy NY mark without colored antialiasing."""
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        cleaned.append(0x0018 if blue >= 24 and blue > red * 1.4 else 0)
    return cleaned


def clean_orioles_logo(pixels):
    """Keep the orange bird, white details, and black unlit gaps.

    Sampled pixels from the source PNG show the bird's true color is
    already orange-leaning red (240,64,0) — the previous hardcoded
    (255,190,0) constant was the yellow culprit, not the source art.
    """
    ORANGE = rgb565(240, 64, 0)
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        if min(red, green, blue) > 125 and max(red, green, blue) - min(red, green, blue) < 100:
            cleaned.append(0xFFFF)
        elif red > 70 and red > green * 1.2 and red > blue * 1.3:
            cleaned.append(ORANGE)
        else:
            cleaned.append(0)
    return cleaned


def clean_american_logo(pixels):
    """Keep American's blue, white and red bands distinct at 24px."""
    cleaned = []
    for pixel in pixels:
        red, green, blue = logo_rgb(pixel)
        if max(red, green, blue) < 58:
            cleaned.append(0)
        elif red > 78 and red > green * 1.4 and red > blue * 1.35:
            cleaned.append(0xE000)
        elif min(red, green, blue) > 110 and max(red, green, blue) - min(red, green, blue) < 90:
            cleaned.append(0xFFFF)
        elif blue > 60 and blue > red * 1.15:
            cleaned.append(0x001B)
        elif red > blue * 1.2:
            cleaned.append(0xE000)
        else:
            cleaned.append(0xFFFF)
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
            pixels = to_rgb565_array(img)
            if league == "NHL" and abbr == "CAR":
                pixels = clean_hurricanes_logo(pixels)
            elif league == "NHL" and abbr == "NSH":
                pixels = clean_predators_logo(pixels)
            elif league == "NHL" and abbr == "FLA":
                pixels = clean_panthers_logo(pixels)
            elif league == "NFL" and abbr == "DAL":
                pixels = clean_cowboys_logo(pixels)
            elif league == "NFL" and abbr == "BAL":
                pixels = clean_ravens_logo(pixels)
            elif league == "MLB" and abbr == "NYY":
                pixels = clean_yankees_logo(pixels)
            elif league == "MLB" and abbr == "BAL":
                pixels = clean_orioles_logo(pixels)
            arrays.append(emit_array(name, pixels))
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
            pixels = clean_american_logo(pixels)
        elif icao == "DAL":
            pixels = clean_delta_widget(pixels)
        elif icao == "SWA":
            pixels = clean_southwest_heart(pixels)
        elif icao == "UAL":
            pixels = clean_united_globe(pixels)
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
