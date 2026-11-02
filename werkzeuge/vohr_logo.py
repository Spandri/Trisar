"""Baut das VOHR-Logo als Vektor-SVG nach: Buchstabenkaesten aus dem Bild, Formen aus einer Systemschrift."""
import sys
import numpy as np
from PIL import Image
from fontTools.ttLib import TTCollection
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

bild, ziel, fontidx = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 7
a = np.array(Image.open(bild).convert('L')) > 110
fonts = TTCollection('/System/Library/Fonts/HelveticaNeue.ttc').fonts
# Zeile 1 (VOHR) in Light, Zeile 2 (GLOBAL MOBILITY) in Regular: so wirken beide wie im Original gleich kraeftig
schnitte = [fonts[fontidx], fonts[0]]

def zeilen(m):
    r = np.where(m.any(1))[0]; seg = []
    for y in r:
        if seg and y == seg[-1][1] + 1: seg[-1][1] = y
        else: seg.append([y, y])
    return seg

def spalten(m, y0, y1):
    c = np.where(m[y0:y1 + 1].any(0))[0]; seg = []
    for x in c:
        if seg and x == seg[-1][1] + 1: seg[-1][1] = x
        else: seg.append([x, x])
    return seg

texte = ['VOHR', 'GLOBALMOBILITY']
pfade = []
for (y0, y1), text, font in zip(zeilen(a), texte, schnitte):
    gs, cmap = font.getGlyphSet(), font.getBestCmap()
    kaesten = spalten(a, y0, y1)
    assert len(kaesten) == len(text), (text, kaesten)
    for (x0, x1), ch in zip(kaesten, text):
        g = cmap[ord(ch)]
        bp = BoundsPen(gs); gs[g].draw(bp); gx0, gy0, gx1, gy1 = bp.bounds
        # Pixelkasten: Kanten liegen auf Pixelgrenzen
        bx0, bx1, by0, by1 = x0, x1 + 1, y0, y1 + 1
        sy = (by1 - by0) / (gy1 - gy0); sx = (bx1 - bx0) / (gx1 - gx0)
        if ch == 'I':
            # Senkrechter Strich: nicht in die Breite ziehen, Strichstaerke wie die anderen Buchstaben
            sx = sy; bx0 = (bx0 + bx1) / 2 - (gx1 - gx0) * sx / 2
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (sx, 0, 0, -sy, bx0 - gx0 * sx, by1 + gy0 * sy))
        gs[g].draw(tp)
        pfade.append(pen.getCommands())

ys = zeilen(a); x_min = min(spalten(a, *ys[0])[0][0], spalten(a, *ys[1])[0][0])
x_max = max(spalten(a, *ys[0])[-1][1], spalten(a, *ys[1])[-1][1]) + 1
y_min, y_max = ys[0][0], ys[-1][1] + 1
w, h = x_max - x_min, y_max - y_min
# Gleiche Box wie das Quadriga-Logo (113 x 53): volle Breite, senkrecht mittig
W, H = 113, 53
s = W / w; dy = (H - h * s) / 2
d = ' '.join(pfade)
svg = (f'<svg width="{W}" height="{H}" viewBox="0 0 {W} {H}" fill="none" xmlns="http://www.w3.org/2000/svg">\n'
       f'<path transform="translate(0 {dy:.3f}) scale({s:.5f}) translate({-x_min} {-y_min})" d="{d}" fill="#DCDCDC"/>\n</svg>\n')
open(ziel, 'w').write(svg)
print('box', w, h, 'skalierung', round(s, 4), 'hoehe', round(h * s, 2))
