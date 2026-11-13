#!/usr/bin/env python3
"""Laedt V-Klasse-Bilder aus dem Mercedes-Van-Konfigurator (transparent, 1920x1080) in allen Lackfarben.

Die Bild-URL enthaelt die Konfiguration verschluesselt im q-Parameter. Je Lack unterscheidet sich nur ein
kurzes Stueck (TOKEN). Ermittelt am 13.11.2026 aus mercedes-benz.de/vans/buy/van-online-configurator.html
(V 220 d Kompakt, Grundausstattung). Bei neuem Modelljahr Token neu im Konfigurator auslesen.

Aufruf: python3 mercedes-laden.py [POV ...]   (Standard: BE320 = schraeg vorne links, BE040 = schraeg vorne rechts)
BKGND=9 liefert transparenten Hintergrund. POV BE010..BE350 in 10er-Schritten = Rundumsicht.
"""
import os, sys, subprocess
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
ZIEL = os.path.join(HIER, "v-klasse-konfigurator")

VOR = "https://media.oneweb.mercedes-benz.com/images/dynamic/europe/DE/447811/807_057/iris.png?q=COSY-EU-100-1713d0VXq7xoqtyO67PobzIr3eWsrrCsdRRzwQZ"
NACH = ("GE1UHFm9mjP9QCc3eDkzy6gWm7YqWdhKrqRfld9PsgI3xXGmgg1J0hRdwOB%25xwZbAyPxFI5Y259QC7QjDkzK1iWm7vwmdhKLDqf%25vaCDEyLH5LlYa8GG2rHi0opn8vnXuoiLvx3M4aL6NTgHaDj6P8jAVSeii7qtsX1qRcUnfzxXGoY71J0M12wOBd6fZbADbHFI5Wji9QCdjeDkzfjzWm7EVUdhKld4f%25v2ffEyLpDKlYaXZV2rHJj5pn8IFEuoiQFF3M4kd3NTgmfgj6PhEvVSe%25lgqts3sPRcUNWUxXGjU71J08kUwOBil4ZbA4UgFI5Zu39QCFteDkz9VhWm7DVudhKWd3f%25vdfDEyLfEKlYaEWG2rHfrHpn8EnZuoilfi3M4Tn1NTg6HSj6PS8vVSetigqtsc4fRcUvnRxXGLoO1J0aF0wOBHmHZbA8ZEFI5iK39QC5QmDkzCksWm7zSVdhK7Aef%25vKF7EyL2APlYap5A2rHF3Hpn8918uoivjl3Mk5bHlqGeAN5fzQVZG4FNgiaSa202hGnMms%25GI7QPqEboZ"
        "&BKGND=9&IMGT=W27&POV={pov}&cp=G1_ByMTvJGWF9_Hf8G5r8A&uni=m")

LACKE = {  # Code: (Name, Token)
    "9197": ("obsidianschwarz-metallic", "UOpJ"),
    "9134": ("bergkristallweiss-metallic", "UOw%25"),
    "9922": ("hightechsilber-metallic", "UkRP"),
    "7831": ("graphitgrau-metallic", "YZwz"),
    "5842": ("sodalithblau-metallic", "hZBP"),
    "3334": ("hyazinthrot-metallic", "vTw%25"),
    "9147": ("arktikweiss", "UOBJ"),
    "7956": ("alpingrau", "YkHl"),
    "5389": ("stahlblau", "hTGL"),
    "5934": ("vintageblau", "hkw%25"),
    "3589": ("jupiterrot", "v3GL"),
}


def main():
    povs = sys.argv[1:] or ["BE320", "BE040"]
    os.makedirs(ZIEL, exist_ok=True)
    for code, (name, tok) in LACKE.items():
        for pov in povs:
            datei = os.path.join(ZIEL, f"v-klasse-{code}-{name}-{pov}.png")
            url = VOR + tok + NACH.format(pov=pov)
            subprocess.run(["curl", "-sf", "-A", "Mozilla/5.0", "-o", datei, url], check=True)
            im = Image.open(datei)
            box = im.getchannel("A").point(lambda a: 255 if a > 4 else 0).getbbox()
            pad = 12
            im.crop((max(box[0]-pad, 0), max(box[1]-pad, 0), min(box[2]+pad, im.width), min(box[3]+pad, im.height))).save(datei, optimize=True)
            print(os.path.basename(datei))


main()
