"""Checks for the bitmap geometry and antialiased edge conversion."""
import importlib.util
import pathlib
import unittest

from PIL import Image

SPEC = importlib.util.spec_from_file_location(
    "generate_logos", pathlib.Path(__file__).with_name("generate_logos.py")
)
logos = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(logos)


class LogoConversionTest(unittest.TestCase):
    def test_tall_logo_keeps_proportions_and_centering(self):
        image = Image.new("RGBA", (10, 20), (255, 0, 0, 255))
        pixels = logos.to_rgb565_array(image)
        self.assertEqual(len(pixels), logos.SIZE * logos.SIZE)
        self.assertEqual(pixels[12 * logos.SIZE + 12], 0xF800)
        self.assertEqual(pixels[12 * logos.SIZE + 0], 0)
        self.assertEqual(pixels[12 * logos.SIZE + 23], 0)

    def test_partial_alpha_survives_on_black(self):
        image = Image.new("RGBA", (24, 24), (255, 0, 0, 64))
        center = logos.to_rgb565_array(image)[12 * logos.SIZE + 12]
        self.assertGreater(center, 0)
        self.assertLess(center, 0xF800)


if __name__ == "__main__":
    unittest.main()
