#!/usr/bin/env python3
"""Faerbt den Lack der freigestellten V-Klasse um.

Eingabe: freigestellt.png (aus freistellen.swift). Ausgabe: farben/v-klasse-<farbe>.png (transparent, zugeschnitten).
Lackflaeche = Auto-Maske minus Scheiben, Raeder, Grill, Scheinwerfer, Kunststoff unten (Polygone unten).
Koordinaten sind im Ausschnitt (206,635)-(1873,1451) des 2000er Fotos.
Aufruf: python3 umfaerben.py [--maske]
"""
import os, sys
import numpy as np
import cv2

HIER = os.path.dirname(os.path.abspath(__file__))
OX, OY = 206, 635
FARBEN = {
    "schwarz": None,  # Original
    "weiss": "#F2F2EF", "silber": "#B9BDC1", "grau": "#5F656B", "blau": "#1E3557",
    "rot": "#8E1820", "gruen": "#2C4A38", "beige": "#BBA57F",
}

AUSSCHLUSS = [  # Polygone in Ausschnitt-Koordinaten
    [(300,250),(470,85),(560,50),(700,35),(800,28),(945,25),(822,245),(660,252),(400,248)],   # Frontscheibe
    [(978,45),(1142,48),(1162,282),(868,308)],                        # Fenster Fahrertuer
    [(1175,50),(1390,55),(1435,275),(1195,280)],                      # Fenster Mitte
    [(1400,58),(1545,95),(1620,275),(1440,275)],                      # Fenster hinten
    [(1450,322),(1640,320),(1640,350),(1450,355)],                    # Zierleiste hinten
    [(75,410),(450,410),(455,500),(420,540),(110,545),(70,500)],      # Grill
    [(455,500),(495,410),(560,390),(725,355),(700,420),(600,470),(500,505),(455,512)],  # Scheinwerfer
    [(25,430),(70,400),(75,520),(40,520)],                            # Scheinwerfer links
    [(125,565),(312,565),(312,632),(125,632)],                        # Schild
    [(12,578),(125,575),(125,633),(312,633),(320,605),(380,600),(640,598),(650,715),(400,718),(20,712)],  # Lufteinlass unten
    [(90,700),(330,705),(330,816),(90,816)],                          # linkes Vorderrad
    [(925,692),(1440,638),(1440,816),(925,816)],                      # Schweller/Schatten
    [(1440,638),(1600,600),(1667,590),(1667,816),(1440,816)],         # Boden hinten
    [(330,715),(700,715),(700,760),(1000,760),(1000,816),(330,816)],  # Boden vorne
    [(0,700),(100,700),(100,816),(0,816)],                            # Boden links
    [(650,690),(700,650),(770,550),(735,770),(650,770)],              # Radhaus vorne
]
ELLIPSEN = [((848,668),(140,140)), ((1525,610),(74,124)), ((260,372),(18,16))]  # Raeder, Stern Haube
LACK_DAZU = [[(970,225),(1060,218),(1100,245),(1102,298),(965,300)]]  # Spiegel ist Lack


def hex_lab(h):
    rgb = np.uint8([[[int(h[5:7],16), int(h[3:5],16), int(h[1:3],16)]]])  # BGR
    return cv2.cvtColor(rgb, cv2.COLOR_BGR2LAB).astype(np.float32)[0,0]


def lackmaske(alpha):
    h, w = alpha.shape
    m = np.zeros((h, w), np.uint8)
    m[OY:OY+816, OX:OX+1667] = 255
    def poly(p, v):
        cv2.fillPoly(m, [np.int32([(x+OX, y+OY) for x, y in p])], v)
    for p in AUSSCHLUSS: poly(p, 0)
    for (c, ax) in ELLIPSEN: cv2.ellipse(m, (c[0]+OX, c[1]+OY), ax, 0, 0, 360, 0, -1)
    for p in LACK_DAZU: poly(p, 255)
    m = np.minimum(m, alpha)
    return cv2.GaussianBlur(m, (0, 0), 2.0).astype(np.float32) / 255.0


def main():
    bgra = cv2.imread(os.path.join(HIER, "freigestellt.png"), cv2.IMREAD_UNCHANGED)
    bgr, alpha = bgra[..., :3], bgra[..., 3]
    m = lackmaske(alpha)
    ys, xs = np.where(alpha > 8)
    box = (xs.min(), ys.min(), xs.max()+1, ys.max()+1)
    if "--maske" in sys.argv:
        vis = bgr.copy(); vis[m > 0.5] = (0.5*vis[m > 0.5] + [0, 0, 127]).astype(np.uint8)
        cv2.imwrite(os.path.join(HIER, "maske-pruefen.png"), vis[box[1]:box[3], box[0]:box[2]])
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[..., 0]
    L0 = float(np.median(L[m > 0.9]))
    os.makedirs(os.path.join(HIER, "farben"), exist_ok=True)
    for name, hx in FARBEN.items():
        if hx is None:
            out = bgr.copy()
        else:
            t = hex_lab(hx)
            hell = t[0] / 255.0
            gain = 1.0 - 0.35 * hell          # helle Lacke: Spiegelungen weniger stark
            neu = lab.copy()
            neu[..., 0] = np.clip(t[0] + (L - L0) * gain, 0, 255)
            # Farbe: Ziel-Farbton, in sehr hellen Spiegelungen etwas ausgebleicht
            spieg = np.clip((L - L0) / 120.0, 0, 1)
            for k in (1, 2):
                neu[..., k] = 128 + (t[k] - 128) * (1 - 0.6 * spieg) + (lab[..., k] - 128) * 0.5
            rec = cv2.cvtColor(np.clip(neu, 0, 255).astype(np.uint8), cv2.COLOR_LAB2BGR).astype(np.float32)
            out = (bgr * (1 - m[..., None]) + rec * m[..., None]).astype(np.uint8)
        res = np.dstack([out, alpha])[box[1]:box[3], box[0]:box[2]]
        cv2.imwrite(os.path.join(HIER, "farben", f"v-klasse-{name}.png"), res)
    print("fertig", box, "L0", round(L0, 1))


main()
