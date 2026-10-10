"""Luminance histogram of a texture's OPAQUE pixels: is the dark fabric painted, or is it a cut-out?

The question this settles: a garment that renders near-black could be (a) the material drawing texels whose
alpha is 0 — a broken alpha mask — or (b) the material drawing texels that really are dark, with the alpha-0
area being unused UV padding that the geometry never samples. `(a)` and `(b)` look identical on screen and have
opposite fixes, and only the texture's own numbers tell them apart.

Usage: python build/texture-luminance.py <texture.png> [alphaFloor]
"""

import sys

from PIL import Image


def main(path, floor=0.5):
    image = Image.open(path).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    cutoff = int(round(floor * 255))
    buckets = {"near-black (<24)": 0, "24-63": 0, "64-127": 0, "128-191": 0, "192+": 0}
    opaque = 0
    cut = 0
    for y in range(height):
        for x in range(width):
            red, green, blue, alpha = pixels[x, y]
            if alpha <= cutoff:
                cut += 1
                continue
            opaque += 1
            total = red + green + blue
            if total < 24:
                buckets["near-black (<24)"] += 1
            elif total < 64:
                buckets["24-63"] += 1
            elif total < 128:
                buckets["64-127"] += 1
            elif total < 192:
                buckets["128-191"] += 1
            else:
                buckets["192+"] += 1

    total_pixels = width * height
    print(f"{path}  ({width}x{height})")
    print(f"  alpha <= {cutoff}: {cut} ({100 * cut / total_pixels:.1f}%)  [cut-out or padding]")
    print(f"  drawn pixels   : {opaque} ({100 * opaque / total_pixels:.1f}%)")
    for name, count in buckets.items():
        share = 100 * count / max(1, opaque)
        print(f"    luminance {name:<16} {count:>7}  {share:5.1f}% of drawn")


if __name__ == "__main__":
    main(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.5)
