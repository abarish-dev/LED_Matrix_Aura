"""Apply the chosen 'sunburst' concept:
 - icon.png / adaptive-icon.png / favicon.png = the full glowing tile
 - splash-image.png = the emblem with the dark tile knocked out (transparent),
   so it glows on the #14171d splash + Summary header.
"""
from PIL import Image, ImageFilter
import os, shutil

TOOLS = os.path.dirname(__file__)
IMAGES = os.path.join(TOOLS, "..", "assets", "images")
SRC = os.path.join(TOOLS, "logo_concepts", "sunburst.png")

# 1) Straight copies for the app/adaptive/web icons (keep the dark tile).
for name in ("icon.png", "adaptive-icon.png", "favicon.png"):
    shutil.copyfile(SRC, os.path.join(IMAGES, name))
    print("copied ->", name)

# 2) Transparent emblem for splash + in-app header.
img = Image.open(SRC).convert("RGBA")
px = img.load()
w, h = img.size
out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
op = out.load()

LO, HI = 34.0, 150.0  # luminance ramp — dark tile drops out, glow/emblem stays
for y in range(h):
    for x in range(w):
        r, g, b, _ = px[x, y]
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        if lum <= LO:
            continue
        score = min(1.0, (lum - LO) / (HI - LO))
        op[x, y] = (r, g, b, int(score * 255))

# soften the alpha edges for a natural glow
alpha = out.split()[3].filter(ImageFilter.GaussianBlur(0.7))
out.putalpha(alpha)

bbox = out.getbbox()
if bbox:
    out = out.crop(bbox)
cw, ch = out.size
side = int(max(cw, ch) * 1.18)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(out, ((side - cw) // 2, (side - ch) // 2), out)
canvas.save(os.path.join(IMAGES, "splash-image.png"))
print("splash-image.png", canvas.size)

# preview on the splash bg color
prev = Image.new("RGBA", canvas.size, (0x14, 0x17, 0x1d, 255))
prev.alpha_composite(canvas)
prev.convert("RGB").save(os.path.join(TOOLS, "sunburst_preview.png"))
print("preview saved")
