"""Extract the glowing amber chevron from the app icon and knock out the dark
panel so it sits transparently on the #14171d splash background."""
from PIL import Image, ImageFilter
import os

SRC = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "icon.png")
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "images", "splash-image.png")

img = Image.open(SRC).convert("RGBA")
px = img.load()
w, h = img.size

# The chevron is warm/bright; the panel + dark dots are cold/dark.
# Alpha = how "glowing" a pixel is (luminance weighted toward warm amber).
out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
op = out.load()

for y in range(h):
    for x in range(w):
        r, g, b, a = px[x, y]
        # Warmth + brightness heuristic. Amber dots have high R, medium G, low B.
        lum = 0.3 * r + 0.5 * g + 0.2 * b
        warm = r - b  # positive for amber/orange, ~0 for neutral dark
        score = 0.0
        if lum > 80 and warm > 45:
            # scale alpha with brightness, clamp
            score = min(1.0, (lum - 80) / 130.0)
        alpha = int(score * 255)
        if alpha > 0:
            op[x, y] = (r, g, b, alpha)

# Soften edges so the glow reads smoothly
alpha_ch = out.split()[3].filter(ImageFilter.GaussianBlur(0.6))
out.putalpha(alpha_ch)

# Crop to the glowing content with padding, then center on a square canvas
bbox = out.getbbox()
if bbox:
    out = out.crop(bbox)

cw, ch = out.size
side = int(max(cw, ch) * 1.25)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(out, ((side - cw) // 2, (side - ch) // 2), out)

canvas.save(OUT)
print("saved", OUT, canvas.size)

# Preview composite on the splash background color for verification
preview = Image.new("RGBA", canvas.size, (0x14, 0x17, 0x1d, 255))
preview.alpha_composite(canvas)
preview.convert("RGB").save(os.path.join(os.path.dirname(__file__), "splash_preview.png"))
print("preview saved")
