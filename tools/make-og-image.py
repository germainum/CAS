#!/usr/bin/env python3
"""Génère l'image de partage (Open Graph / Twitter) : og-image.png, 1200×630.

C'est la vignette qu'affichent WhatsApp, LinkedIn, Facebook et X quand on
partage le lien. Elle doit exister : une balise `og:image` qui pointe vers un
fichier absent donne une carte cassée, pire que pas de carte du tout.

Usage : python3 tools/make-og-image.py
Dépendance : pillow  (pip install pillow)
"""

import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "og-image.png")

# Format imposé par Open Graph : 1200×630 (ratio 1,91:1). Rendu au double puis
# réduit, faute d'anticrénelage sur le texte comme sur les courbes.
W, H = 1200, 630
SCALE = 2

TOP = (109, 74, 240)      # violet profond, comme les icônes
BOTTOM = (196, 178, 255)  # lilas
WHITE = (255, 255, 255)

TITLE = "Bains Froids Léman"
TAGLINE = "La température du lac,"
TAGLINE2 = "et le souffle pour y entrer."
FOOT = "GENÈVE · LAUSANNE · VEVEY · MONTREUX · ÉVIAN · THONON"

SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        # Sans la police attendue, l'image reste produite — en moins joli.
        return ImageFont.load_default()


def gradient(w, h):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    # Dégradé diagonal : une simple bande horizontale paraîtrait plate sur un
    # format aussi large.
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)],
               fill=tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    return img


def waves(img):
    """Trois vagues translucides en bas : la signature visuelle de l'app."""
    w, h = img.size
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for offset, alpha, phase in [(0.00, 105, 0.0), (0.06, 72, 1.1), (0.12, 46, 2.2)]:
        y0 = h * (0.72 + offset)
        amp = h * 0.055
        # Un point par pixel : à pas plus large, la réduction finale transforme
        # les segments en pointillés.
        pts = [(x, y0 + math.sin(x / w * 2 * math.pi * 1.7 + phase) * amp)
               for x in range(-20, w + 20)]
        d.line(pts, fill=WHITE + (alpha,), width=max(3, int(h * 0.016)), joint="curve")
    return Image.alpha_composite(img.convert("RGBA"), overlay)


def thermometer(d, cx, cy, span):
    """Thermomètre blanc en filet, à droite du texte."""
    w = span * 0.17
    top = cy - span * 0.52
    bulb_r = w * 0.92
    bulb_y = cy + span * 0.34
    d.rounded_rectangle([cx - w / 2, top, cx + w / 2, bulb_y],
                        radius=w / 2, outline=WHITE + (235,), width=max(2, int(span * 0.022)))
    d.ellipse([cx - bulb_r, bulb_y - bulb_r, cx + bulb_r, bulb_y + bulb_r],
              fill=WHITE + (235,))
    # Trois graduations, côté droit du tube.
    for k in (0.30, 0.48, 0.66):
        y = top + (bulb_y - top) * k
        d.line([(cx + w * 0.75, y), (cx + w * 1.5, y)],
               fill=WHITE + (170,), width=max(2, int(span * 0.016)))


def build():
    w, h = W * SCALE, H * SCALE
    img = waves(gradient(w, h))
    d = ImageDraw.Draw(img)

    pad = int(w * 0.075)
    f_title = font(SANS_BOLD, int(h * 0.125))
    f_tag = font(SANS, int(h * 0.072))
    f_foot = font(SANS_BOLD, int(h * 0.030))

    y = int(h * 0.20)
    d.text((pad, y), TITLE, font=f_title, fill=WHITE)
    y += int(h * 0.175)
    d.text((pad, y), TAGLINE, font=f_tag, fill=WHITE + (225,))
    y += int(h * 0.098)
    d.text((pad, y), TAGLINE2, font=f_tag, fill=WHITE + (225,))

    # Les lieux couverts, en bas : ce sont eux qu'on cherche dans un moteur.
    d.text((pad, int(h * 0.855)), FOOT, font=f_foot, fill=WHITE + (195,))

    thermometer(d, int(w * 0.845), int(h * 0.46), int(h * 0.38))

    return img.convert("RGB").resize((W, H), Image.LANCZOS)


def main():
    build().save(OUT, optimize=True)
    size_kb = os.path.getsize(OUT) / 1024
    print(f"écrit og-image.png — {W}×{H}, {size_kb:.0f} ko")


if __name__ == "__main__":
    main()
