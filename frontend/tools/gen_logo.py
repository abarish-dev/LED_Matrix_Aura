import asyncio, os, sys
from dotenv import load_dotenv
load_dotenv("/app/backend/.env")
from emergentintegrations.llm.openai.image_generation import OpenAIImageGeneration

KEY = os.environ.get("EMERGENT_LLM_KEY")
OUT = "/app/frontend/tools/logo_concepts"
os.makedirs(OUT, exist_ok=True)

PROMPTS = {
    "sunburst": (
        "App icon, 1024x1024, rounded-square dark charcoal background (#14171d). "
        "A single glowing emblem centered: a radiant amber/gold SUN with soft rays that doubles as the focal 'aura' glow. "
        "Integrated tastefully INTO the sun: a small sleek AIRPLANE silhouette arcing across, and a small TROPHY/CUP shape at the base — "
        "all unified into ONE cohesive minimal mark, not three separate stickers. "
        "Warm amber-to-gold gradient, luminous halo/glow like an LED, subtle depth, premium modern flat-3D icon. "
        "No text, no letters. Centered, generous padding."
    ),
    "orb": (
        "App icon, 1024x1024, rounded-square near-black background (#14171d). "
        "A glowing amber ORB/aura at center emitting a warm radial glow. "
        "Formed by three thin luminous line-art strokes that elegantly suggest a SUN (rays), an AIRPLANE (wing arc) and a TROPHY (cup) "
        "woven together into a single balanced monogram-like emblem. "
        "Amber and gold neon line glow on dark, minimal, symmetric, high-end tech brand mark. No text."
    ),
    "badge": (
        "App icon, 1024x1024, rounded-square dark background (#14171d). "
        "A warm amber glowing circular badge. Inside: a stylized rising SUN on the horizon, "
        "a small airplane crossing the sky, and a subtle trophy silhouette merged at the bottom, "
        "combined into one clean iconographic scene with an aura-like amber halo. "
        "Soft LED glow, gradient amber/gold, minimal, modern, premium. No text, no words."
    ),
}


async def main():
    gen = OpenAIImageGeneration(api_key=KEY)
    for name, prompt in PROMPTS.items():
        try:
            imgs = await gen.generate_images(prompt=prompt, model="gpt-image-1", number_of_images=1)
            if imgs:
                p = os.path.join(OUT, f"{name}.png")
                with open(p, "wb") as fh:
                    fh.write(imgs[0])
                print("saved", p, len(imgs[0]))
        except Exception as e:
            print("ERR", name, e, file=sys.stderr)

asyncio.run(main())
print("done")
