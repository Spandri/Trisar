#!/usr/bin/env python3
"""App-Icon der Fahrer-App: Lime-Pfeil auf Schwarz mit dem Lime-Schimmer oben links,
wie der Hintergrund der App (TrisarHintergrund) und analog zum blauen Schimmer im Dispo-Icon.
Nimmt den Pfeil aus dem bisherigen Icon (schwarzer Grund) und legt den Verlauf darunter."""
import math, sys
from pathlib import Path
from PIL import Image

HIER = Path(__file__).resolve().parent.parent
ICON = HIER / "TrisarFahrer/Assets.xcassets/AppIcon.appiconset/icon-1024.png"
QUELLE = Path(sys.argv[1]) if len(sys.argv) > 1 else ICON

# Farbe aus der App (Stil.swift TrisarHintergrund, Startfarbe 49/55/1, etwas kraeftiger),
# Verlauf wie das Blau im Dispo-Icon: gleichmaessig bis schwarz bei etwa 650 px von der Ecke.
STOPPS = [(0.0, (64, 72, 2)), (1.0, (0, 0, 0))]
R = 650.0
# Optionaler Verstaerker, falls der Schimmer auf dem Homescreen kraeftiger sein soll.
STAERKE = float(sys.argv[2]) if len(sys.argv) > 2 else 1.0

def farbe(t):
    for (a, ca), (b, cb) in zip(STOPPS, STOPPS[1:]):
        if t <= b:
            u = (t - a) / (b - a) if b > a else 0
            return tuple(min(255, (ca[i] + (cb[i] - ca[i]) * u) * STAERKE) for i in range(3))
    return (0, 0, 0)

pfeil = Image.open(QUELLE).convert("RGB")
w, h = pfeil.size
aus = Image.new("RGB", (w, h))
px, pp = aus.load(), pfeil.load()
LIME = (226, 247, 84)
for y in range(h):
    for x in range(w):
        g = farbe(math.hypot(x, y) * 1024 / w / R)
        # Deckkraft des Pfeils aus dem Gruenanteil (Kanten weich lassen).
        a = min(1.0, pp[x, y][1] / LIME[1])
        px[x, y] = tuple(int(round(g[i] * (1 - a) + LIME[i] * a)) for i in range(3))
aus.save(ICON)
print("geschrieben:", ICON)
