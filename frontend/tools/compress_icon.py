import os
from PIL import Image

SRC = "/app/frontend/assets/images/icon.png"
im = Image.open(SRC).convert("RGB")
# 512x512 keeps the glow gradients smooth and lands well under the 1MB limit.
small = im.resize((512, 512), Image.LANCZOS)

targets = [
    "/app/frontend/assets/images/icon.png",
    "/app/frontend/assets/images/adaptive-icon.png",
    "/app/frontend/assets/images/favicon.png",
    "/app/backend/app_icon.png",  # served for on-phone download
]
for p in targets:
    small.save(p, optimize=True)
    print(p, os.path.getsize(p), "bytes")
