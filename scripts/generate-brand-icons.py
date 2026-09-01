"""Deterministically derive transparent and opaque brand icons from the supplied raster."""

from collections import deque
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
SOURCE = PUBLIC / "jeevijay-hrms-icon.png"
TRANSPARENT_LOGO = PUBLIC / "jeevijay-hrms-logo.png"
CACHE_VERSION = "20260902"
OPAQUE_BACKGROUND = (15, 52, 71, 255)
RESAMPLING = Image.Resampling.LANCZOS


def remove_corner_connected_white(image: Image.Image) -> Image.Image:
    """Remove only white-matted pixels reachable from the four corners.

    The original artwork was antialiased against white. For corner-connected
    pixels, alpha is recovered from the strongest distance from white and the
    RGB channels are un-matted. Interior whites are unreachable through the
    solid artwork and therefore remain unchanged.
    """

    rgba = image.convert("RGBA")
    width, height = rgba.size
    pixels = rgba.load()
    visited: set[tuple[int, int]] = set()
    exterior: dict[tuple[int, int], float] = {}
    queue = deque([(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)])

    while queue:
        x, y = queue.popleft()
        if (x, y) in visited:
            continue
        visited.add((x, y))
        red, green, blue, _ = pixels[x, y]
        alpha = max(255 - red, 255 - green, 255 - blue) / 235
        if alpha >= 0.96:
            continue

        exterior[(x, y)] = alpha

        for next_x, next_y in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= next_x < width and 0 <= next_y < height and (next_x, next_y) not in visited:
                queue.append((next_x, next_y))

    for (x, y), alpha in exterior.items():
        if alpha <= 0.08:
            pixels[x, y] = (0, 0, 0, 0)
            continue

        nearest = None
        for radius in range(1, 7):
            candidates = []
            for next_y in range(max(0, y - radius), min(height, y + radius + 1)):
                for next_x in range(max(0, x - radius), min(width, x + radius + 1)):
                    if (next_x, next_y) in exterior:
                        continue
                    distance = (next_x - x) ** 2 + (next_y - y) ** 2
                    candidates.append((distance, next_x, next_y))
            if candidates:
                _, nearest_x, nearest_y = min(candidates)
                nearest = pixels[nearest_x, nearest_y][:3]
                break
        if nearest is None:
            raise RuntimeError("Could not recover a clean foreground edge colour")
        pixels[x, y] = (*nearest, round(alpha * 255))

    alpha_channel = rgba.getchannel("A")
    bounds = alpha_channel.getbbox()
    if not bounds:
        raise RuntimeError("Background removal produced an empty image")
    return rgba.crop(bounds)


def square_icon(subject: Image.Image, size: int, fill: float, background=None) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background or (0, 0, 0, 0))
    target = max(1, round(size * fill))
    scale = min(target / subject.width, target / subject.height)
    rendered_size = (
        max(1, round(subject.width * scale)),
        max(1, round(subject.height * scale)),
    )
    rendered = subject.resize(rendered_size, RESAMPLING)
    position = ((size - rendered.width) // 2, (size - rendered.height) // 2)
    canvas.alpha_composite(rendered, position)
    return canvas


def main() -> None:
    original = Image.open(SOURCE)
    subject = remove_corner_connected_white(original)

    transparent_master = square_icon(subject, 512, 0.92)
    transparent_master.save(TRANSPARENT_LOGO, optimize=True)
    square_icon(subject, 16, 0.88).save(PUBLIC / "favicon-16x16.png", optimize=True)
    square_icon(subject, 32, 0.90).save(PUBLIC / "favicon-32x32.png", optimize=True)

    ico_master = square_icon(subject, 256, 0.90)
    ico_master.save(
        PUBLIC / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    square_icon(subject, 180, 0.84, OPAQUE_BACKGROUND).convert("RGB").save(
        PUBLIC / "apple-touch-icon.png", optimize=True
    )
    square_icon(subject, 192, 0.84, OPAQUE_BACKGROUND).convert("RGB").save(
        PUBLIC / "icon-192.png", optimize=True
    )
    square_icon(subject, 512, 0.84, OPAQUE_BACKGROUND).convert("RGB").save(
        PUBLIC / "icon-512.png", optimize=True
    )

    print(f"Generated JeeVijay brand icons (cache version {CACHE_VERSION})")
    for filename in (
        "jeevijay-hrms-logo.png",
        "favicon.ico",
        "favicon-16x16.png",
        "favicon-32x32.png",
        "apple-touch-icon.png",
        "icon-192.png",
        "icon-512.png",
    ):
        generated = Image.open(PUBLIC / filename).convert("RGBA")
        alpha = generated.getchannel("A")
        corners = (
            generated.getpixel((0, 0)),
            generated.getpixel((generated.width - 1, 0)),
            generated.getpixel((0, generated.height - 1)),
            generated.getpixel((generated.width - 1, generated.height - 1)),
        )
        white_corners = sum(
            pixel[3] > 0 and min(pixel[:3]) > 240 for pixel in corners
        )
        print(
            f"{filename}: mode={Image.open(PUBLIC / filename).mode} "
            f"size={generated.size} alpha={alpha.getextrema()} "
            f"corner_alpha={tuple(pixel[3] for pixel in corners)} "
            f"white_corners={white_corners} bbox={alpha.getbbox()}"
        )


if __name__ == "__main__":
    main()
