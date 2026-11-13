#!/usr/bin/env python3
"""Audi: 360-Grad-Bilder aus dem 3D-Stream des Audi-Konfigurators verarbeiten.

Der Audi-Konfigurator zeigt das Auto als Live-Video (Unreal Pixel Streaming). Im Browser wird je Lack
die feste Kamera CAM_EXT_360_<winkel> angesteuert (Umgebung WhiteRoom, Hotspots aus), das Videobild
(1920x1080) abgegriffen und als Paket {"<modell>|<lackname>|NN": "data:image/webp;base64,..."} an den
Empfaenger geschickt. NN ist schon das Mercedes-Raster (00 = von vorne, 27 = Seite Front links,
32 = schraeg vorne links), Audi-Winkel a = (360 - 10*NN) % 360.

Dieses Skript: Pakete entpacken -> roh/audi/<modell>/<lack>/NN.webp, freistellen (Apple Vision,
freistellen-ordner), gemeinsamer Ausschnitt je Modell, ausgabe/<modell>-<lack>-NN.webp (800 px breit).
Schreibt ausserdem konfigurator/audi/<modell>.json (Lacknamen) fuer katalog-bauen.py.
Aufruf: python3 audi-verarbeiten.py <ordner-mit-paketen> [modell ...]
"""
import base64, concurrent.futures as cf, glob, json, os, re, subprocess, sys, unicodedata
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
ROH = os.path.join(HIER, "roh", "audi")
AUSGABE = os.path.join(HIER, "ausgabe")
LISTE = os.path.join(HIER, "konfigurator", "audi")
N, BREITE = 36, 800


def lid(name):
    s = name.lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def entpacken(ordner):
    lacke = {}
    for p in sorted(glob.glob(os.path.join(ordner, "audi-*.json"))):
        for k, v in json.load(open(p)).items():
            if k.count("|") != 2:
                continue
            modell, name, nn = k.split("|")
            lacke.setdefault(modell, {}).setdefault(name, set()).add(nn)
            ziel = os.path.join(ROH, modell, lid(name), f"{nn}.webp")
            if not os.path.exists(ziel):
                os.makedirs(os.path.dirname(ziel), exist_ok=True)
                open(ziel, "wb").write(base64.b64decode(v.split(",", 1)[1]))
    os.makedirs(LISTE, exist_ok=True)
    for modell, d in lacke.items():
        p = os.path.join(LISTE, f"{modell}.json")
        alt = json.load(open(p)) if os.path.exists(p) else []
        namen = [l["name"] for l in alt]
        for name in d:
            if name not in namen:
                alt.append({"name": name})
        json.dump(alt, open(p, "w"), ensure_ascii=False, indent=1)
    return lacke


def speichern(args):
    pfad, box, ziel = args
    c = Image.open(pfad).convert("RGBA").crop(box)
    c = c.resize((BREITE, round(c.height * BREITE / c.width)), Image.LANCZOS)
    c.save(ziel, quality=80, method=4)


def modell(mid, rechner):
    box = None
    for l in json.load(open(os.path.join(LISTE, f"{mid}.json"))):
        lk = lid(l["name"])
        roh = os.path.join(ROH, mid, lk)
        frei = roh + "-frei"
        ziele = [os.path.join(AUSGABE, f"{mid}-{lk}-{k:02d}.webp") for k in range(N)]
        if not all(os.path.exists(os.path.join(roh, f"{k:02d}.webp")) for k in range(N)):
            print("  unvollstaendig", mid, lk, flush=True)
            continue
        pngs = [os.path.join(frei, f"{k:02d}.png") for k in range(N)]
        if not all(os.path.exists(p) for p in pngs):
            subprocess.run([os.path.join(HIER, "freistellen-ordner"), roh, frei], check=True, capture_output=True)
        if box is None:
            kisten = [Image.open(p).getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox() for p in pngs]
            w, h = Image.open(pngs[0]).size
            pad = 10
            box = (max(min(k[0] for k in kisten) - pad, 0), max(min(k[1] for k in kisten) - pad, 0),
                   min(max(k[2] for k in kisten) + pad, w), min(max(k[3] for k in kisten) + pad, h))
        if all(os.path.exists(z) for z in ziele):
            continue
        list(rechner.map(speichern, [(p, box, z) for p, z in zip(pngs, ziele)]))
        print(" ", mid, lk, "ok", flush=True)


def main():
    os.makedirs(AUSGABE, exist_ok=True)
    if len(sys.argv) > 1 and os.path.isdir(sys.argv[1]):
        entpacken(sys.argv[1])
        wahl = sys.argv[2:]
    else:
        wahl = sys.argv[1:]
    wahl = wahl or sorted(f[:-5] for f in os.listdir(LISTE) if f.endswith(".json"))
    with cf.ProcessPoolExecutor(os.cpu_count() or 4) as rechner:
        for mid in wahl:
            print(mid, flush=True)
            modell(mid, rechner)
    print("fertig", flush=True)


if __name__ == "__main__":
    main()
