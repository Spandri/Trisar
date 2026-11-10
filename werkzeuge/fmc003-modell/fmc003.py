#!/usr/bin/env python3
"""Vereinfachtes 3D-Modell Teltonika FMC003 (OBD-Tracker), Masse in mm.

Grundlage: Teltonika-Produktfotos (Vorderansicht ausgemessen) und Haendlerangabe 67,2 x 49,6 x 25 mm.
Koordinaten: X Breite (mittig), Y Laenge (0 = Rueckseite, Stecker bei +Y), Z Hoehe (Z = 25 = Etikett).

Sicher aus Foto + Datenblatt: Gesamtlaenge, Breite ueber Rastnasen, Gehaeuselaenge, Steckerlaenge und -breite.
Geschaetzt (mit # GESCHAETZT markiert): alles in Z am Stecker, Unterseite, Kontakte, Lage der Luftschlitze.
Am echten Geraet nachmessen und unten aendern, dann neu erzeugen (braucht pip install cadquery): python fmc003.py
"""
import math
from pathlib import Path
import cadquery as cq

# Aussenmasse
L_GESAMT = 67.2
B_NASEN = 49.6
H = 25.0
L_GEHAEUSE = 50.6        # Foto: 513 px bei 0,0987 mm/px
B_GEHAEUSE = 47.9        # Foto: 485 px
NASE = (B_NASEN - B_GEHAEUSE) / 2
# Rastnasen an beiden Laengsseiten, oben und unten. Abstand 10 mm, Laenge 3 mm (Foto).
NASEN_AB_STECKER = [3.75, 13.7, 23.7, 33.7, 43.6]
NASE_L = 3.0
NASE_H = 4.5             # GESCHAETZT
TRENNFUGE_Z = 10.0       # GESCHAETZT

# Stecker (OBD-II J1962)
ST_B = 38.8              # Foto: 393 px
ST_OBEN = 21.5           # GESCHAETZT
ST_UNTEN = 4.0           # GESCHAETZT
ST_WAND = 1.5            # GESCHAETZT
ST_TIEFE = 12.0          # GESCHAETZT
RAHMEN_TIEFE = 0.8       # GESCHAETZT


def stecker_umriss():
    h = ST_B / 2
    t, u = ST_OBEN, ST_UNTEN
    m = (t + u) / 2 + 1
    return [(-h + 1, t), (h - 1, t), (h, t - 1.2), (h, m), (h - 3, u + 0.8), (h - 4, u),
            (-h + 4, u), (-h + 3, u + 0.8), (-h, m), (-h, t - 1.2)]


def xz(y):
    """Arbeitsebene XZ bei Y, Extrusion nach +Y, lokales y ist Z."""
    return cq.Workplane(cq.Plane(origin=(0, y, 0), xDir=(-1, 0, 0), normal=(0, 1, 0)))


def quader(x0, x1, y0, y1, z0, z1):
    return cq.Workplane("XY").box(x1 - x0, y1 - y0, z1 - z0, centered=False).translate((x0, y0, z0))


def gehaeuse():
    g = quader(-B_GEHAEUSE / 2, B_GEHAEUSE / 2, 0, L_GEHAEUSE, 0, H)
    g = g.edges("|Z").fillet(2.5).faces("|Z").edges().fillet(1.2)

    # Rastnasen
    for s in NASEN_AB_STECKER:
        y1 = L_GEHAEUSE - s
        y0 = y1 - NASE_L
        for seite in (-1, 1):
            x0 = B_GEHAEUSE / 2 - 0.6 if seite > 0 else -B_NASEN / 2
            x1 = B_NASEN / 2 if seite > 0 else -B_GEHAEUSE / 2 + 0.6
            for z0, z1 in ((H - NASE_H - 0.4, H - 0.4), (0.4, NASE_H + 0.4)):
                g = g.union(quader(x0, x1, y0, y1, z0, z1).edges("|Y").chamfer(0.3))

    # Trennfuge der beiden Schalen, 0,4 breit, 0,3 tief
    aussen = quader(-30, 30, -5, L_GEHAEUSE + 5, TRENNFUGE_Z - 0.2, TRENNFUGE_Z + 0.2)
    kern = quader(-B_GEHAEUSE / 2 + 0.3, B_GEHAEUSE / 2 - 0.3, 0.3, L_GEHAEUSE - 0.3,
                  TRENNFUGE_Z - 1, TRENNFUGE_Z + 1)
    g = g.cut(aussen.cut(kern))

    # Vertiefte Flaeche mit vier schraegen Luftschlitzen auf +X. GESCHAETZT
    xa = B_GEHAEUSE / 2
    g = g.cut(quader(xa - 0.5, xa + 1, 3.5, 35, TRENNFUGE_Z + 0.5, H - 2.5))
    for i in range(4):
        y = 8.5 + i * 4.7
        schlitz = (cq.Workplane("YZ", origin=(xa - 1.5, 0, 0))
                   .polyline([(y - 0.65 + 2.6, 13.0), (y + 0.65 + 2.6, 13.0), (y + 0.65 - 2.6, 21.0), (y - 0.65 - 2.6, 21.0)])
                   .close().extrude(3))
        g = g.cut(schlitz)

    # Rahmen um den Stecker an der Stirnseite. GESCHAETZT
    rahmen = quader(-22, 22, L_GEHAEUSE - RAHMEN_TIEFE, L_GEHAEUSE + 1, 2.2, H - 2.2).edges("|Y").fillet(2)
    return g.cut(rahmen)


def stecker():
    y0 = L_GEHAEUSE - RAHMEN_TIEFE - 0.5
    laenge = L_GESAMT - y0
    aussen = xz(y0).polyline(stecker_umriss()).close().extrude(laenge)
    aussen = aussen.edges("|Y").fillet(0.5)
    # Schluessel unten mittig
    aussen = aussen.union(quader(-6.2, 6.2, y0, L_GESAMT, ST_UNTEN - 1.5, ST_UNTEN + 0.5).edges("|Y").fillet(0.4))

    boden = L_GESAMT - ST_TIEFE
    hohl = xz(boden).polyline(stecker_umriss()).close().offset2D(-ST_WAND).extrude(ST_TIEFE + 1)
    k = aussen.cut(hohl)

    # Stege und Kontakte. GESCHAETZT
    for x0, x1 in ((-12.8, -3.2), (3.2, 12.8)):
        k = k.union(quader(x0, x1, boden - 0.2, L_GESAMT - 1.7, 11.9, 13.1).edges("|Y").fillet(0.4))
    teilung = 4.4
    for zeile in (16.2, 8.6):
        for i in range(8):
            x = (i - 3.5) * teilung
            k = k.union(quader(x - 0.65, x + 0.65, boden - 0.2, L_GESAMT - 2, zeile - 0.175, zeile + 0.175))
    return k


def bauen():
    return gehaeuse().union(stecker())


if __name__ == "__main__":
    ziel = Path(__file__).parent
    m = bauen()
    bb = m.val().BoundingBox()
    print(f"Masse: {bb.xlen:.1f} x {bb.ylen:.1f} x {bb.zlen:.1f} mm, gueltig: {m.val().isValid()}, Koerper: {len(m.solids().vals())}")
    cq.exporters.export(m, str(ziel / "FMC003.step"))
    cq.exporters.export(m, str(ziel / "FMC003.stl"), tolerance=0.02, angularTolerance=0.15)
