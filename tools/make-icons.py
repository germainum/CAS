#!/usr/bin/env python3
"""Génère les icônes PNG de l'app (dégradé lac + vagues + thermomètre).

Usage : python3 tools/make-icons.py
Dépendance : pillow  (pip install pillow)
"""

import math
import os

from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
BASE = 2048   # rendu super-échantillonné, réduit ensuite (anticrénelage)

TOP = (109, 74, 240)     # violet profond
BOTTOM = (196, 178, 255) # lilas
WHITE = (255, 255, 255)
MERCURY = (255, 96, 92)


def gradient(size):
    img = Image.new("RGB", (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line(
            [(0, y), (size, y)],
            fill=tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)),
        )
    return img


def waves(img, scale, cx, cy, span):
    """Trois vagues sinusoïdales translucides sous le thermomètre."""
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for offset, alpha, phase in [(0.00, 210, 0.0), (0.13, 135, 1.1), (0.26, 85, 2.2)]:
        y0 = cy + span * (0.18 + offset)
        amp = span * 0.055
        pts = []
        x = cx - span * 0.62
        while x <= cx + span * 0.62:
            k = (x - (cx - span * 0.62)) / (span * 1.24)
            pts.append((x, y0 + math.sin(k * 2 * math.pi * 1.6 + phase) * amp))
            x += 1.0
        d.line(pts, fill=WHITE + (alpha,), width=max(2, int(span * 0.05)), joint="curve")
    return Image.alpha_composite(img.convert("RGBA"), overlay)


def thermometer(img, cx, cy, span):
    """Thermomètre blanc, bulbe rouge, centré sur (cx, cy)."""
    d = ImageDraw.Draw(img)
    w = span * 0.20            # largeur du tube
    top = cy - span * 0.60
    bulb_r = w * 0.86
    bulb_c = (cx, cy + span * 0.06)

    d.rounded_rectangle(
        [cx - w / 2, top, cx + w / 2, bulb_c[1]],
        radius=w / 2, fill=WHITE,
    )
    d.ellipse(
        [bulb_c[0] - bulb_r, bulb_c[1] - bulb_r, bulb_c[0] + bulb_r, bulb_c[1] + bulb_r],
        fill=WHITE,
    )

    inner = w * 0.42
    d.rounded_rectangle(
        [cx - inner / 2, top + w * 0.42, cx + inner / 2, bulb_c[1]],
        radius=inner / 2, fill=MERCURY,
    )
    r = bulb_r * 0.62
    d.ellipse(
        [bulb_c[0] - r, bulb_c[1] - r, bulb_c[0] + r, bulb_c[1] + r],
        fill=MERCURY,
    )


def build(content_ratio):
    """content_ratio : part de l'icône occupée par le motif (marge de sécurité)."""
    img = gradient(BASE)
    span = BASE * content_ratio
    cx, cy = BASE / 2, BASE * 0.46
    img = waves(img, BASE / 1024, cx, cy, span)
    thermometer(img, cx, cy, span)
    return img.convert("RGB")


def main():
    os.makedirs(OUT, exist_ok=True)
    standard = build(0.46)
    maskable = build(0.32)      # motif resserré : la zone sûre est un cercle de 80 %

    for name, src, size in [
        ("icon-1024.png", standard, 1024),
        ("icon-512.png", standard, 512),
        ("icon-192.png", standard, 192),
        ("icon-180.png", standard, 180),
        ("favicon-32.png", standard, 32),
        ("favicon-16.png", standard, 16),
        ("icon-maskable-512.png", maskable, 512),
    ]:
        src.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
        print("écrit", os.path.join("icons", name))


if __name__ == "__main__":
    main()
