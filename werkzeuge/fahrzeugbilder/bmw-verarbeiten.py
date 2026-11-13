#!/usr/bin/env python3
"""BMW: 360-Grad-Bilder aus konfigurator/bmw/<modell>.json laden, freistellen, zuschneiden.

Die JSON stammt aus dem BMW-Konfigurator (360-Ansicht, je Lack 36 Bildadressen in Drehreihenfolge,
beginnend mit der Startansicht). BMW liefert Bilder mit Studio-Hintergrund, darum Freistellen per
Apple Vision (freistellen-ordner). Ergebnis wie bei Mercedes: ausgabe/<modell>-<lack>-NN.webp,
NN = Winkel / 10 im Mercedes-Raster (00 = von vorne, 32 = schraeg vorne links).
Aufruf: python3 bmw-verarbeiten.py [modell ...]
"""
import concurrent.futures as cf
import io, json, os, subprocess, sys
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
QUELLE = os.path.join(HIER, "konfigurator", "bmw")
ROH = os.path.join(HIER, "roh", "bmw")
AUSGABE = os.path.join(HIER, "ausgabe")
N, BREITE = 36, 800
# BMW-Viewer-Index i (Winkel i*10, 0 = Front, 9 = linke Seite) -> Raster (36 - i) % 36
START, RICHTUNG = 0, -1

def lid(name):
    import re, unicodedata
    s = name.lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def holen(args):
    url, ziel = args
    if os.path.exists(ziel):
        return True
    for _ in range(3):
        r = subprocess.run(["curl", "-sf", "--max-time", "60", "-A", "Mozilla/5.0", "-o", ziel, url])
        if r.returncode == 0 and os.path.getsize(ziel) > 1000:
            return True
    return False


def speichern(args):
    pfad, box, ziel = args
    c = Image.open(pfad).convert("RGBA").crop(box)
    c = c.resize((BREITE, round(c.height * BREITE / c.width)), Image.LANCZOS)
    c.save(ziel, quality=80, method=4)


def modell(mid, pool, rechner):
    lacke = json.load(open(os.path.join(QUELLE, f"{mid}.json")))
    box = None
    for l in lacke:
        if len(l.get("frames", [])) != N:
            print("  uebersprungen", mid, l["name"], len(l.get("frames", [])), flush=True)
            continue
        lk = lid(l["name"])
        ziele = [os.path.join(AUSGABE, f"{mid}-{lk}-{(START + RICHTUNG * k) % N:02d}.webp") for k in range(N)]
        if all(os.path.exists(z) for z in ziele):
            continue
        roh = os.path.join(ROH, mid, lk); frei = roh + "-frei"
        os.makedirs(roh, exist_ok=True)
        ok = list(pool.map(holen, [(u, os.path.join(roh, f"{k:02d}.webp")) for k, u in enumerate(l["frames"])]))
        if not all(ok):
            print("  FEHLT", mid, lk, flush=True); continue
        subprocess.run([os.path.join(HIER, "freistellen-ordner"), roh, frei], check=True, capture_output=True)
        pngs = [os.path.join(frei, f"{k:02d}.png") for k in range(N)]
        if box is None:
            kisten = [Image.open(p).getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox() for p in pngs]
            w, h = Image.open(pngs[0]).size
            pad = 10
            box = (max(min(k[0] for k in kisten) - pad, 0), max(min(k[1] for k in kisten) - pad, 0),
                   min(max(k[2] for k in kisten) + pad, w), min(max(k[3] for k in kisten) + pad, h))
        list(rechner.map(speichern, [(p, box, z) for p, z in zip(pngs, ziele)]))
        print(" ", mid, lk, "ok", flush=True)


def main():
    os.makedirs(AUSGABE, exist_ok=True)
    wahl = sys.argv[1:] or sorted(f[:-5] for f in os.listdir(QUELLE) if f.endswith(".json"))
    with cf.ThreadPoolExecutor(12) as pool, cf.ProcessPoolExecutor(os.cpu_count() or 4) as rechner:
        for mid in wahl:
            print(mid, flush=True)
            modell(mid, pool, rechner)
    print("fertig", flush=True)


if __name__ == "__main__":
    main()
