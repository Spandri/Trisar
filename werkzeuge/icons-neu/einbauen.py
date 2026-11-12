#!/usr/bin/env python3
"""Verteilt die Icons aus icons.py in Web, iOS und Android, in der Namensform der vorhandenen Icons.

  hotel -> Hotel_Trisar_Icons_01.svg        (admin/icon/_Icon_Schwarz, fahrer/icon/_Icon_Schwarz)
           Hotel_Trisar_Icons_01_Lime.svg   (_Icon_Lime), _grau (_Icon_Grau), _green (_Icon_Green), _rot (_Icon_Rot)
  iOS:     Assets.xcassets/WebIcons/<Name>.imageset in ios-dispo und ios-fahrer
  Android: android/kern/src/main/assets/icon/<Name>.svg

Aufruf: python3 einbauen.py   (schreibt nur eigene Dateien, vorhandene fremde Icons bleiben unberuehrt)
"""
import json
import os

import icons

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL = os.path.dirname(os.path.dirname(HIER))
MARKE = "<!-- TRISAR icons-neu -->"

FARBEN = [
    ("_Icon_Schwarz", "", "#010001"),
    ("_Icon_Lime", "_Lime", "#E3F654"),
    ("_Icon_Grau", "_grau", "#B5B4B5"),
    ("_Icon_Green", "_green", "#59BF80"),
    ("_Icon_Rot", "_rot", "#FF6F63"),
]
WEB = ["admin/icon", "fahrer/icon"]
IOS = ["ios-dispo/TrisarDispo/Assets.xcassets/WebIcons", "ios-fahrer/TrisarFahrer/Assets.xcassets/WebIcons"]
ANDROID = "android/kern/src/main/assets/icon"


def dateiname(kurz):
    return "_".join(t.capitalize() for t in kurz.split("-")) + "_Trisar_Icons_01"


def svg(teile, farbe):
    return (f'<svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">\n{MARKE}\n'
            f'<g stroke="{farbe}" stroke-width="{icons.SW}" stroke-linecap="butt" stroke-linejoin="miter" '
            f'stroke-miterlimit="10">{"".join(teile)}</g>\n</svg>\n')


def schreiben(pfad, inhalt):
    if os.path.exists(pfad) and MARKE not in open(pfad).read():
        raise SystemExit(f"Fremde Datei, nicht ueberschrieben: {pfad}")
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    with open(pfad, "w") as f:
        f.write(inhalt)


def main():
    zahl = 0
    liste = []
    for kurz, teile in icons.ICONS.items():
        name = dateiname(kurz)
        liste.append(f"{kurz}\t{name}")
        for ordner, endung, farbe in FARBEN:
            datei = f"{name}{endung}.svg"
            inhalt = svg(teile, farbe)
            for web in WEB:
                schreiben(os.path.join(WURZEL, web, ordner, datei), inhalt)
            for ios in IOS:
                satz = os.path.join(WURZEL, ios, f"{name}{endung}.imageset")
                schreiben(os.path.join(satz, datei), inhalt)
                with open(os.path.join(satz, "Contents.json"), "w") as f:
                    json.dump({"images": [{"filename": datei, "idiom": "universal"}],
                               "info": {"author": "xcode", "version": 1},
                               "properties": {"preserves-vector-representation": True}}, f, indent=2)
                    f.write("\n")
            schreiben(os.path.join(WURZEL, ANDROID, datei), inhalt)
            zahl += 1
    with open(os.path.join(HIER, "namen.txt"), "w") as f:
        f.write("\n".join(liste) + "\n")
    print(zahl, "Varianten von", len(icons.ICONS), "Icons verteilt")


if __name__ == "__main__":
    main()
