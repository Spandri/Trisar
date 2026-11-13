#!/usr/bin/env python3
"""Baut aus ausgabe/*.webp den Fahrzeugkatalog fuer alle Apps: ausgabe/fahrzeug-dreh.json + Seitenbilder.

Quellen:
  konfigurator/mercedes-pkw.json   Mercedes-Pkw (Namen, Modellwoerter, Lacke) -> dreh-laden.py
  konfigurator/bmw/<modell>.json   BMW (Lacke)                                -> bmw-verarbeiten.py
  v-klasse-360/<code>/NN.webp      V-Klasse (aelterer Stand, wird nach ausgabe/ uebernommen)
Je Modell eigene Bildgroesse und Endstellung (endbox = enger Ausschnitt um Bild 32).
Farbwoerter: genaue Lacknamen zuerst, dann Kurzformen ohne MANUFAKTUR/metallic, dann allgemeine Woerter
(schwarz, weiss, ...). Die Apps nehmen beim Modell das laengste passende Modellwort, bei der Farbe das
erste passende Farbwort (Liste ist nach Laenge sortiert).
Aufruf: python3 katalog-bauen.py
"""
import json, os, re, shutil, unicodedata
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
AUSGABE = os.path.join(HIER, "ausgabe")
N, START, SEITE = 36, 32, 27  # 27 = Seitenansicht Front links (wie die Dispo-Fahrzeugbilder)

BMW = {
    "3er": ("BMW 3er Limousine", ["3er", "318", "320", "330", "340", "m340"]),
    "5er": ("BMW 5er Limousine", ["5er", "520", "530", "540", "550", "i5", "m5"]),
    "7er": ("BMW 7er", ["7er", "740", "750", "760", "i7"]),
    "x3": ("BMW X3", ["x3"]),
    "x5": ("BMW X5", ["x5"]),
    "x7": ("BMW X7", ["x7"]),
    "ix": ("BMW iX", ["bmwix", "ixxdrive"]),
}
VKLASSE_LACKE = {  # Code -> Name (aus dem Van-Konfigurator)
    "9197": "Obsidianschwarz metallic", "9134": "Bergkristallweiß metallic", "9922": "Hightechsilber metallic",
    "7831": "Graphitgrau metallic", "5842": "Sodalithblau metallic", "3334": "Hyazinthrot metallic",
    "9147": "Arktikweiß", "7956": "Alpingrau", "5389": "Stahlblau", "5934": "Vintageblau", "3589": "Jupiterrot",
}
ALLGEMEIN = [  # Wort -> Wurzel im Lacknamen
    ("schwarz", "schwarz"), ("black", "schwarz"), ("weiss", "weiss"), ("white", "weiss"),
    ("silber", "silber"), ("silver", "silber"), ("grau", "grau"), ("grey", "grau"), ("gray", "grau"),
    ("anthrazit", "grau"), ("blau", "blau"), ("blue", "blau"), ("rot", "rot"), ("red", "rot"),
    ("gruen", "gruen"), ("green", "gruen"), ("braun", "braun"), ("brown", "braun"), ("beige", "beige"),
    ("gold", "gold"), ("gelb", "gelb"), ("orange", "orange"),
]


def glatt(s):
    s = s.lower().replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return re.sub(r"[^a-z0-9]", "", s)


def lack_id(name):
    s = name.lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def schoen(name):
    """'obsidianschwarz metallic' -> 'Obsidianschwarz metallic', 'MANUFAKTUR opalithweiß' bleibt"""
    return name[:1].upper() + name[1:] if name and name[0].islower() else name


def kern(name):
    """Lackname ohne MANUFAKTUR/BMW Individual und ohne metallic/uni/... am Ende"""
    g = glatt(name)
    for p in ("manufaktur", "bmwindividual", "individual", "m"):
        if g.startswith(p) and len(g) > len(p) + 3 and p != "m":
            g = g[len(p):]
    return re.sub(r"(metallic|uni|magno|bright|matt|brillanteffekt)+$", "", g)


def farbe_hex(pfad):
    im = Image.open(pfad).convert("RGBA")
    w, h = im.size
    px = [p for p in im.crop((int(w * .3), int(h * .45), int(w * .7), int(h * .68))).get_flattened_data() if p[3] > 220]
    if not px:
        return "#888888"
    px.sort(key=lambda p: p[0] + p[1] + p[2])
    m = px[len(px) // 2]
    return "#%02X%02X%02X" % m[:3]


def vklasse_uebernehmen():
    q = os.path.join(HIER, "v-klasse-360")
    for code, name in VKLASSE_LACKE.items():
        for i in range(N):
            ziel = os.path.join(AUSGABE, f"v-klasse-{lack_id(name)}-{i:02d}.webp")
            if not os.path.exists(ziel):
                shutil.copyfile(os.path.join(q, code, f"{i:02d}.webp"), ziel)


def modell_eintrag(mid, marke, name, woerter, lacknamen):
    lacke = [(lack_id(n), schoen(n)) for n in lacknamen
             if all(os.path.exists(os.path.join(AUSGABE, f"{mid}-{lack_id(n)}-{i:02d}.webp")) for i in range(N))]
    if not lacke:
        return None
    lacke = list(dict(lacke).items())  # doppelte raus
    erstes = os.path.join(AUSGABE, f"{mid}-{lacke[0][0]}-{START:02d}.webp")
    ende = Image.open(erstes)
    bx = ende.getchannel("A").point(lambda a: 255 if a > 4 else 0).getbbox()
    pad = 5
    endbox = [max(bx[0] - pad, 0), max(bx[1] - pad, 0), min(bx[2] + pad, ende.width), min(bx[3] + pad, ende.height)]
    liste = []
    for code, n in lacke:
        seite = os.path.join(AUSGABE, f"{mid}-{code}-{SEITE:02d}.webp")
        liste.append({"code": code, "name": n, "hex": farbe_hex(seite)})
        b = Image.open(seite)
        k = b.getchannel("A").point(lambda a: 255 if a > 4 else 0).getbbox()
        b.crop((max(k[0] - 4, 0), max(k[1] - 4, 0), min(k[2] + 4, b.width), min(k[3] + 4, b.height))).save(
            os.path.join(AUSGABE, f"{mid}-{code}-seite.webp"), quality=85, method=4)
    farben = {}
    for l in liste:  # 1. genauer Name
        farben.setdefault(glatt(l["name"]), l["code"])
    for l in sorted(liste, key=lambda l: ("manufaktur" in glatt(l["name"]) or "individual" in glatt(l["name"]), len(l["name"]))):
        k = kern(l["name"])  # 2. Kurzform, Serienlack bevorzugt
        if len(k) >= 4:
            farben.setdefault(k, l["code"])
    for wort, wurzel in ALLGEMEIN:  # 3. allgemeine Woerter
        passend = [l for l in liste if wurzel in glatt(l["name"])]
        if passend:
            passend.sort(key=lambda l: ("manufaktur" in glatt(l["name"]) or "individual" in glatt(l["name"]),
                                        "metallic" not in glatt(l["name"]), len(l["name"])))
            farben.setdefault(wort, passend[0]["code"])
    farben = sorted(farben.items(), key=lambda kv: -len(kv[0]))
    return {"id": mid, "marke": marke, "name": name, "modell": woerter, "farben": [list(x) for x in farben],
            "lacke": [l["code"] for l in liste], "lackliste": liste,
            "breite": ende.width, "hoehe": ende.height, "endbox": endbox}


def main():
    vklasse_uebernehmen()
    modelle = []
    mb = json.load(open(os.path.join(HIER, "konfigurator", "mercedes-pkw.json")))
    m = modell_eintrag("v-klasse", "Mercedes-Benz", "Mercedes-Benz V-Klasse",
                       ["vklasse", "vclass", "v220", "v250", "v300", "eqv", "marcopolo"], list(VKLASSE_LACKE.values()))
    if m: modelle.append(m)
    for mid, v in mb.items():
        if mid.startswith("_"):
            continue
        m = modell_eintrag(mid, "Mercedes-Benz", v["name"], v["modell"], [n for n, _ in v["lacke"]])
        if m: modelle.append(m)
    bmw_ordner = os.path.join(HIER, "konfigurator", "bmw")
    for mid, (name, woerter) in BMW.items():
        p = os.path.join(bmw_ordner, f"{mid}.json")
        if not os.path.exists(p):
            continue
        m = modell_eintrag(mid, "BMW", name, woerter, [l["name"] for l in json.load(open(p))])
        if m: modelle.append(m)
    # Kein Modellwort doppelt verschiedenen Modellen zuordnen
    gesehen = {}
    for m in modelle:
        for w in m["modell"]:
            if w in gesehen:
                print("Achtung: Modellwort doppelt", w, gesehen[w], m["id"])
            gesehen[w] = m["id"]
    info = {"bilder": N, "start": START, "seite": SEITE, "modelle": modelle,
            # alte Felder fuer bereits ausgelieferte Apps (V-Klasse)
            "breite": modelle[0]["breite"], "hoehe": modelle[0]["hoehe"], "endbox": modelle[0]["endbox"]}
    with open(os.path.join(AUSGABE, "fahrzeug-dreh.json"), "w") as f:
        json.dump(info, f, ensure_ascii=False, indent=1)
    print(len(modelle), "Modelle,", sum(len(m["lacke"]) for m in modelle), "Lacke")
    # Katalog als Rueckfall in alle Apps (die Bilder selbst liegen nur auf dem Server)
    trisar = os.path.abspath(os.path.join(HIER, "..", ".."))
    for ziel in ["fahrer/public/fahrzeug-dreh", "admin/public/fahrzeug-dreh", "ios-fahrer/TrisarFahrer/FahrzeugDreh",
                 "ios-dispo/TrisarDispo/FahrzeugDreh", "android/fahrer/src/main/assets/fahrzeug-dreh",
                 "android/dispo/src/main/assets/fahrzeug-dreh"]:
        os.makedirs(os.path.join(trisar, ziel), exist_ok=True)
        shutil.copyfile(os.path.join(AUSGABE, "fahrzeug-dreh.json"), os.path.join(trisar, ziel, "fahrzeug-dreh.json"))


if __name__ == "__main__":
    main()
