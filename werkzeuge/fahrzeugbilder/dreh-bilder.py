#!/usr/bin/env python3
"""Laedt die 36 Ansichten (BE000..BE350) einer Lackfarbe fuer die 360-Grad-Drehung.

Alle Bilder bekommen denselben Ausschnitt (sonst wackelt das Auto beim Drehen), werden auf BREITE px
verkleinert und als WebP gespeichert: v-klasse-360/<code>/00.webp .. 35.webp (Index = Winkel / 10).
Aufruf: python3 dreh-bilder.py [Lackcode ...]   (Standard: 9197 obsidianschwarz)
"""
import os, sys, subprocess, tempfile
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HIER)
quelle = open(os.path.join(HIER, "mercedes-laden.py")).read().split("def main")[0]
g = {"__file__": os.path.join(HIER, "mercedes-laden.py")}
exec(quelle, g)
VOR, NACH, LACKE = g["VOR"], g["NACH"], g["LACKE"]
BREITE = 800


def laden(code):
    tok = LACKE[code][1]
    with tempfile.TemporaryDirectory() as tmp:
        bilder = []
        for i in range(36):
            pov = f"BE{i*10:03d}"
            datei = os.path.join(tmp, f"{i:02d}.png")
            subprocess.run(["curl", "-sf", "-A", "Mozilla/5.0", "-o", datei, VOR + tok + NACH.format(pov=pov)], check=True)
            bilder.append(Image.open(datei).convert("RGBA"))
        boxen = [b.getchannel("A").point(lambda a: 255 if a > 4 else 0).getbbox() for b in bilder]
        pad = 10
        box = (min(b[0] for b in boxen) - pad, min(b[1] for b in boxen) - pad,
               max(b[2] for b in boxen) + pad, max(b[3] for b in boxen) + pad)
        ziel = os.path.join(HIER, "v-klasse-360", code)
        os.makedirs(ziel, exist_ok=True)
        for i, b in enumerate(bilder):
            c = b.crop(box)
            c = c.resize((BREITE, round(c.height * BREITE / c.width)), Image.LANCZOS)
            c.save(os.path.join(ziel, f"{i:02d}.webp"), quality=82, method=6)
        print(code, LACKE[code][0], "Ausschnitt", box)


for code in sys.argv[1:] or ["9197"]:
    laden(code)
