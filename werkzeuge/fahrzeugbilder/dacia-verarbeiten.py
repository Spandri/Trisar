#!/usr/bin/env python3
"""Dacia: 360-Grad-Bilder vom Renault-3D-Dienst (3dv.renault.com), den der Dacia-Konfigurator nutzt.

Der Konfigurator holt den Drehteller als Bookmark-Set TOURNETTE_3: 72 Bilder = 3 Ringe x 24 Ansichten (15 Grad),
Ring 1 (Bild 0..23) ist der flache, wie bei den anderen Marken. Mit background=transparent kommt PNG mit Alpha,
aber samt Bodenschatten. Der Schatten faellt weg ueber die Vision-Maske (freistellen-ordner), die Kanten bleiben
aus dem Original-Alpha.

Raster wie Mercedes: NN = 0..35, Winkel 10*NN (00 = von vorne, 09 = Seite Front rechts, 27 = Seite Front links).
Dacia-Bild j zeigt Winkel (21 - j) * 15. Fuer 10-Grad-Plaetze gibt es nur 15-Grad-Bilder, also nimmt jeder Platz
das naechste Bild (hoechstens 5 Grad daneben). Die echten Winkel stehen in ausgabe/<modell>-winkel.json,
form-bauen.py schneidet die Form damit.

Quelle je Modell: konfigurator/dacia/<modell>.json (Grundkonfiguration mit {LACK}, Lacke mit Code und Name).
Ausgabe: ausgabe/<modell>-<lack>-NN.webp (800 px breit, gemeinsamer Ausschnitt je Modell).
Aufruf: python3 dacia-verarbeiten.py [modell ...]
"""
import concurrent.futures as cf, json, os, re, subprocess, sys, unicodedata, urllib.parse, urllib.request
import numpy as np
from PIL import Image
from scipy.ndimage import binary_dilation

HIER = os.path.dirname(os.path.abspath(__file__))
ROH = os.path.join(HIER, "roh", "dacia")
AUSGABE = os.path.join(HIER, "ausgabe")
LISTE = os.path.join(HIER, "konfigurator", "dacia")
N, BREITE, RING = 36, 800, 24
DIENST = "https://3dv.renault.com/ImagesFromBookmarkSet"
KOPF = {"User-Agent": "Mozilla/5.0", "Referer": "https://www.dacia.de/"}


def lid(name):
    s = name.lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def bild_fuer_platz(nn):
    """Dacia-Bild (0..23) mit dem Winkel am naechsten an 10*nn, dazu dessen Winkel"""
    stufe = round(nn * 10 / 15) % RING
    return (21 - stufe) % RING, stufe * 15


def laden(url, ziel):
    if not os.path.exists(ziel):
        with urllib.request.urlopen(urllib.request.Request(url, headers=KOPF), timeout=60) as r:
            daten = r.read()
        open(ziel, "wb").write(daten)


def lack_laden(cfg, code, roh):
    os.makedirs(roh, exist_ok=True)
    if all(os.path.exists(os.path.join(roh, f"{j:02d}.png")) for j in range(RING)):
        return
    q = urllib.parse.urlencode({"databaseId": cfg["datenbank"], "configuration": cfg["konfiguration"].replace("{LACK}", code),
                                "bookmarkSet": "TOURNETTE_3", "background": "transparent", "width": 1600, "height": 900,
                                "superSampling": 2, "imageFormat": "png"}, safe="/")
    with urllib.request.urlopen(urllib.request.Request(f"{DIENST}?{q}", headers=KOPF), timeout=60) as r:
        xml = r.read().decode()
    urls = [u.replace("&amp;", "&") for u in re.findall(r'directUrl="([^"]+)"', xml)]
    if len(urls) < RING:
        raise RuntimeError(f"{code}: nur {len(urls)} Bilder")
    with cf.ThreadPoolExecutor(8) as t:
        list(t.map(lambda j: laden(urls[j], os.path.join(roh, f"{j:02d}.png")), range(RING)))


def ohne_schatten(roh, frei):
    """Vision-Maske (auf weissem Grund) begrenzt das Original-Alpha: Schatten weg, Kanten bleiben."""
    weiss = roh + "-weiss"
    os.makedirs(weiss, exist_ok=True)
    for j in range(RING):
        z = os.path.join(weiss, f"{j:02d}.png")
        if not os.path.exists(z):
            im = Image.open(os.path.join(roh, f"{j:02d}.png")).convert("RGBA")
            bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
            bg.alpha_composite(im)
            bg.convert("RGB").save(z)
    maske = roh + "-maske"
    subprocess.run([os.path.join(HIER, "freistellen-ordner"), weiss, maske], check=True, capture_output=True)
    os.makedirs(frei, exist_ok=True)
    for j in range(RING):
        z = os.path.join(frei, f"{j:02d}.png")
        if os.path.exists(z):
            continue
        im = np.array(Image.open(os.path.join(roh, f"{j:02d}.png")).convert("RGBA"))
        m = np.array(Image.open(os.path.join(maske, f"{j:02d}.png")).convert("RGBA"))[..., 3] > 100
        m = binary_dilation(m, iterations=3)
        im[..., 3] = np.where(m, im[..., 3], 0)
        Image.fromarray(im).save(z)


def speichern(args):
    pfad, box, ziel = args
    c = Image.open(pfad).convert("RGBA").crop(box)
    c = c.resize((BREITE, round(c.height * BREITE / c.width)), Image.LANCZOS)
    c.save(ziel, quality=80, method=4)


def modell(mid, rechner):
    cfg = json.load(open(os.path.join(LISTE, f"{mid}.json")))
    box = None
    for l in cfg["lacke"]:
        lk = lid(l["name"])
        roh = os.path.join(ROH, mid, lk)
        frei = roh + "-frei"
        lack_laden(cfg, l["code"], roh)
        ohne_schatten(roh, frei)
        if box is None:  # Ausschnitt aus allen 24 Ansichten des ersten Lacks
            kisten = [Image.open(os.path.join(frei, f"{j:02d}.png")).getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
                      for j in range(RING)]
            w, h = Image.open(os.path.join(frei, "00.png")).size
            pad = 10
            box = (max(min(k[0] for k in kisten) - pad, 0), max(min(k[1] for k in kisten) - pad, 0),
                   min(max(k[2] for k in kisten) + pad, w), min(max(k[3] for k in kisten) + pad, h))
        auftraege = [(os.path.join(frei, f"{bild_fuer_platz(nn)[0]:02d}.png"), box,
                      os.path.join(AUSGABE, f"{mid}-{lk}-{nn:02d}.webp")) for nn in range(N)]
        list(rechner.map(speichern, [a for a in auftraege if not os.path.exists(a[2])]))
        print(" ", mid, lk, "ok", flush=True)
    json.dump([bild_fuer_platz(nn)[1] for nn in range(N)], open(os.path.join(AUSGABE, f"{mid}-winkel.json"), "w"))


def main():
    os.makedirs(AUSGABE, exist_ok=True)
    wahl = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(LISTE) if f.endswith(".json"))
    with cf.ProcessPoolExecutor(os.cpu_count() or 4) as rechner:
        for mid in wahl:
            print(mid, flush=True)
            modell(mid, rechner)
    print("fertig", flush=True)


if __name__ == "__main__":
    main()
