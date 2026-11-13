#!/usr/bin/env python3
"""Verteilt die 360-Grad-Bilder (v-klasse-360/<code>/NN.webp) in Web, iOS und Android der Fahrer-App.

Ziel ist ueberall derselbe flache Satz Dateien plus fahrzeug-dreh.json:
  fahrer/public/fahrzeug-dreh/                       (Web, geladen unter /fahrzeug-dreh/...)
  ios-fahrer/TrisarFahrer/FahrzeugDreh/              (iOS-Bundle, danach xcodegen)
  android/fahrer/src/main/assets/fahrzeug-dreh/      (Android-Assets)
Dateiname: <modell>-<code>-<NN>.webp, NN = Winkel / 10 (00 = von vorne, 32 = schraeg vorne links).

fahrzeug-dreh.json sagt den Apps, welches Fahrzeug (brand_model) und welche Farbe (color, Freitext) zu
welchem Satz gehoert. Reihenfolge der Farbwoerter zaehlt: genaue Lacknamen zuerst, allgemeine Woerter danach.
Aufruf: python3 dreh-einbauen.py
"""
import json, os, shutil
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
TRISAR = os.path.abspath(os.path.join(HIER, "..", ".."))
ZIELE = [
    os.path.join(TRISAR, "fahrer", "public", "fahrzeug-dreh"),
    os.path.join(TRISAR, "ios-fahrer", "TrisarFahrer", "FahrzeugDreh"),
    os.path.join(TRISAR, "android", "fahrer", "src", "main", "assets", "fahrzeug-dreh"),
]
# Dispo (Web, iOS, Android) braucht fahrzeug-dreh.json (Vorschlaege fuer Modell und Farbe beim Fahrzeug anlegen)
# und je Lack ein Seitenbild <modell>-<code>-seite.webp (Fahrzeugliste und Fahrzeug bearbeiten).
NUR_INFO = [
    os.path.join(TRISAR, "admin", "public", "fahrzeug-dreh"),
    os.path.join(TRISAR, "ios-dispo", "TrisarDispo", "FahrzeugDreh"),
    os.path.join(TRISAR, "android", "dispo", "src", "main", "assets", "fahrzeug-dreh"),
]
N, START = 36, 32
SEITE = 27  # BE270: reine Seitenansicht, Front nach links (wie die uebrigen Fahrzeugbilder der Dispo)

MODELLE = [{
    "id": "v-klasse",
    # Vorschlag im Feld Marke/Modell der Dispo
    "name": "Mercedes-Benz V-Klasse",
    # brand_model enthaelt eines dieser Woerter (klein, ohne Leerzeichen/Bindestrich verglichen)
    "modell": ["vklasse", "vclass", "v220", "v250", "v300", "eqv", "marcopolo"],
    # [Wort, Lackcode] - erstes Wort, das in color vorkommt, gewinnt
    "farben": [
        ["obsidian", "9197"], ["bergkristall", "9134"], ["arktik", "9147"], ["hightech", "9922"],
        ["graphit", "7831"], ["alpin", "7956"], ["sodalith", "5842"], ["stahl", "5389"],
        ["vintage", "5934"], ["hyazinth", "3334"], ["jupiter", "3589"],
        ["anthrazit", "7831"], ["dunkelgrau", "7831"], ["hellblau", "5934"], ["dunkelblau", "5842"],
        ["schwarz", "9197"], ["black", "9197"], ["weiss", "9147"], ["white", "9147"],
        ["silber", "9922"], ["silver", "9922"], ["grau", "7956"], ["grey", "7956"], ["gray", "7956"],
        ["blau", "5842"], ["blue", "5842"], ["rot", "3334"], ["red", "3334"],
    ],
    # Vorschlaege im Feld Farbe der Dispo (Mercedes-Lacknamen), hex nur fuer den Farbpunkt
    "lackliste": [
        {"code": "9197", "name": "Obsidianschwarz metallic", "hex": "#1B1C1E"},
        {"code": "9134", "name": "Bergkristallweiß metallic", "hex": "#E9E9E6"},
        {"code": "9922", "name": "Hightechsilber metallic", "hex": "#B9BEC3"},
        {"code": "7831", "name": "Graphitgrau metallic", "hex": "#55595D"},
        {"code": "5842", "name": "Sodalithblau metallic", "hex": "#233A5C"},
        {"code": "3334", "name": "Hyazinthrot metallic", "hex": "#7D1720"},
        {"code": "9147", "name": "Arktikweiß", "hex": "#F2F3F1"},
        {"code": "7956", "name": "Alpingrau", "hex": "#9A9D9F"},
        {"code": "5389", "name": "Stahlblau", "hex": "#2C4466"},
        {"code": "5934", "name": "Vintageblau", "hex": "#7F9BBD"},
        {"code": "3589", "name": "Jupiterrot", "hex": "#B3201F"},
    ],
}]


def main():
    quelle = os.path.join(HIER, "v-klasse-360")
    codes = sorted(c for c in os.listdir(quelle) if os.path.isdir(os.path.join(quelle, c)))
    # Endstellung = enger Ausschnitt um Bild 32 (wie das Standbild), mit etwas Rand
    ende = Image.open(os.path.join(quelle, codes[0], f"{START:02d}.webp"))
    bx = ende.getchannel("A").point(lambda a: 255 if a > 4 else 0).getbbox()
    pad = 5
    endbox = [max(bx[0] - pad, 0), max(bx[1] - pad, 0), min(bx[2] + pad, ende.width), min(bx[3] + pad, ende.height)]
    for m in MODELLE:
        m["lacke"] = codes
        # nur Lacke vorschlagen, fuer die es Bilder gibt
        m["lackliste"] = [l for l in m["lackliste"] if l["code"] in codes]
    info = {"bilder": N, "start": START, "seite": SEITE, "breite": ende.width, "hoehe": ende.height, "endbox": endbox, "modelle": MODELLE}
    for ziel in ZIELE:
        if os.path.isdir(ziel):
            shutil.rmtree(ziel)
        os.makedirs(ziel)
        for code in codes:
            for i in range(N):
                shutil.copyfile(os.path.join(quelle, code, f"{i:02d}.webp"), os.path.join(ziel, f"v-klasse-{code}-{i:02d}.webp"))
        with open(os.path.join(ziel, "fahrzeug-dreh.json"), "w") as f:
            json.dump(info, f, ensure_ascii=False, indent=1)
        print(os.path.relpath(ziel, TRISAR), len(codes), "Lacke")
    # Seitenbild eng um das Auto zugeschnitten (mit Schatten), je Lack
    seiten = {}
    for code in codes:
        b = Image.open(os.path.join(quelle, code, f"{SEITE:02d}.webp"))
        k = b.getchannel("A").point(lambda a: 255 if a > 4 else 0).getbbox()
        seiten[code] = b.crop((max(k[0] - 4, 0), max(k[1] - 4, 0), min(k[2] + 4, b.width), min(k[3] + 4, b.height)))
    for ziel in NUR_INFO:
        if os.path.isdir(ziel):
            shutil.rmtree(ziel)
        os.makedirs(ziel)
        with open(os.path.join(ziel, "fahrzeug-dreh.json"), "w") as f:
            json.dump(info, f, ensure_ascii=False, indent=1)
        for code, bild in seiten.items():
            bild.save(os.path.join(ziel, f"v-klasse-{code}-seite.webp"), quality=85, method=6)
        print(os.path.relpath(ziel, TRISAR), "Info + Seitenbilder")


main()
