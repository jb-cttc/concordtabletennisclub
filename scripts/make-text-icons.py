#!/usr/bin/env python3
"""The Text CTTC Home Screen icons (text.html, assets/text.webmanifest), drawn from the club icon.

Run: python3 scripts/make-text-icons.py [A|B|C]   (needs Pillow: pip install pillow)

  A  the club icon as it is, with a green chat bubble on its lower right corner
  B  the same shield on green, with a white chat bubble (the one in use)
  C  one big green chat bubble holding the shield

Writes assets/icons/text-apple-touch-icon.png (180, iPhone and iPad), text-icon-192.png and text-icon-512.png (Android),
and text-icon-maskable-512.png (Android's round or squircle crop: the drawing shrunk into the middle 80%).
"""
import os
import sys

from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
ICONS = os.path.join(ROOT, 'assets', 'icons')
CREAM = (252, 247, 229)
GREEN = (31, 107, 58)
WHITE = (255, 255, 255)
SMOOTH = 4  # drawn this many times larger, then shrunk, for smooth edges


def bubble(size, fill, dots, outline=None, outline_width=0):
    """A chat bubble with three dots and its tail at the lower left, size x size, transparent around it."""
    w = size * SMOOTH
    im = Image.new('RGBA', (w, w), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    body = (int(w * .04), int(w * .06), int(w * .96), int(w * .74))
    tail = [(int(w * .20), int(w * .66)), (int(w * .14), int(w * .95)), (int(w * .46), int(w * .72))]
    if outline:
        g = int(outline_width * SMOOTH)
        d.rounded_rectangle((body[0] - g, body[1] - g, body[2] + g, body[3] + g), radius=int(w * .30) + g, fill=outline)
        cx = sum(p[0] for p in tail) / 3
        cy = sum(p[1] for p in tail) / 3
        d.polygon([(x + (x - cx) * .35, y + (y - cy) * .35) for x, y in tail], fill=outline)
    d.rounded_rectangle(body, radius=int(w * .30), fill=fill)
    d.polygon(tail, fill=fill)
    cy = (body[1] + body[3]) // 2
    r = int(w * .075)
    for cx in (w * .30, w * .50, w * .70):
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=dots)
    return im.resize((size, size), Image.LANCZOS)


def solid_logo():
    """The transparent logo with its letters and ball (holes in it) filled in cream, cropped to the shield."""
    logo = Image.open(os.path.join(ROOT, 'assets', 'logo-transparent.png')).convert('RGBA')
    logo = logo.crop(logo.split()[3].getbbox())
    solid = logo.split()[3].point(lambda v: 255 if v > 8 else 0).convert('L')
    pad = Image.new('L', (solid.width + 4, solid.height + 4), 0)
    pad.paste(solid, (2, 2))
    ImageDraw.floodfill(pad, (0, 0), 128)
    shape = pad.point(lambda v: 0 if v == 128 else 255).crop((2, 2, solid.width + 2, solid.height + 2))
    filled = Image.new('RGBA', logo.size, CREAM + (0,))
    filled.putalpha(shape)
    filled.alpha_composite(logo)
    return filled


def concept(letter):
    base = Image.open(os.path.join(ICONS, 'icon-512.png')).convert('RGBA')
    if letter == 'A':
        im = base.copy()
        im.alpha_composite(bubble(230, GREEN, WHITE, outline=CREAM + (255,), outline_width=12), (272, 286))
        return im, CREAM
    if letter == 'B':
        im = base.copy()
        for corner in [(2, 2), (509, 2), (2, 509), (509, 509)]:
            ImageDraw.floodfill(im, corner, GREEN + (255,), thresh=40)
        im.alpha_composite(bubble(200, WHITE, GREEN, outline=GREEN + (255,), outline_width=10), (296, 300))
        return im, GREEN
    if letter == 'C':
        im = Image.new('RGBA', (512, 512), CREAM + (255,))
        im.alpha_composite(bubble(500, GREEN, GREEN), (6, 30))
        logo = solid_logo()
        h = 250
        w = round(logo.width * h / logo.height)
        im.alpha_composite(logo.resize((w, h), Image.LANCZOS), ((512 - w) // 2, 60 + (340 - h) // 2))
        return im, CREAM
    raise SystemExit('Pick A, B or C')


def main():
    letter = (sys.argv[1] if len(sys.argv) > 1 else 'B').upper()
    icon, background = concept(letter)
    flat = Image.new('RGB', icon.size, background)
    flat.paste(icon, mask=icon.split()[3])
    flat.resize((180, 180), Image.LANCZOS).save(os.path.join(ICONS, 'text-apple-touch-icon.png'), optimize=True)
    flat.resize((192, 192), Image.LANCZOS).save(os.path.join(ICONS, 'text-icon-192.png'), optimize=True)
    flat.save(os.path.join(ICONS, 'text-icon-512.png'), optimize=True)
    maskable = Image.new('RGB', (512, 512), background)
    inner = flat.resize((400, 400), Image.LANCZOS)
    maskable.paste(inner, (56, 56))
    maskable.save(os.path.join(ICONS, 'text-icon-maskable-512.png'), optimize=True)
    print('Text CTTC icons written (concept ' + letter + ')')


if __name__ == '__main__':
    main()
