"""Alpha and colour statistics for a texture: is that white area a cut-out, or is it paint?

Written for one question about one file: the VRoid onepiece texture is white with cyan trim, while the dress
renders BLACK on screen. If the white is a cut-out (alpha 0) whose RGB is dark, then a mask that is not applied
paints the cut-out black — which is what the operator reported. If the alpha is 1 everywhere, then the bug is
in colour rather than in alpha, and the search moves to the material's base colour.

Usage: python build/texture-alpha-stats.py <texture.png>
"""

import collections
import sys

from PIL import Image


def main(path):
    image = Image.open(path).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    transparent = 0
    opaque = 0
    transparent_rgb = [0, 0, 0]
    opaque_rgb = [0, 0, 0]
    histogram = collections.Counter()
    darkest_opaque = 255
    for y in range(0, height, 4):
        for x in range(0, width, 4):
            red, green, blue, alpha = pixels[x, y]
            histogram[alpha // 32 * 32] += 1
            if alpha < 8:
                transparent += 1
                transparent_rgb[0] += red
                transparent_rgb[1] += green
                transparent_rgb[2] += blue
            else:
                opaque += 1
                opaque_rgb[0] += red
                opaque_rgb[1] += green
                opaque_rgb[2] += blue
                darkest_opaque = min(darkest_opaque, (red + green + blue) // 3)

    total = transparent + opaque
    print(f"{path}")
    print(f"  size {width}x{height}, sampled {total} pixels")
    print(f"  alpha == 0 : {transparent} ({100 * transparent / max(1, total):.1f}%)  mean RGB " +
          f"{[c // max(1, transparent) for c in transparent_rgb]}")
    print(f"  alpha  > 0 : {opaque} ({100 * opaque / max(1, total):.1f}%)  mean RGB " +
          f"{[c // max(1, opaque) for c in opaque_rgb]}  darkest {darkest_opaque}")
    print(f"  alpha buckets (32 wide): {sorted(histogram.items())}")


if __name__ == "__main__":
    main(sys.argv[1])
