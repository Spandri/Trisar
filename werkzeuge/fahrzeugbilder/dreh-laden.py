#!/usr/bin/env python3
"""Laedt die 360-Grad-Bilder aller Modelle aus konfigurator/*.json (Mercedes-Pkw usw.).

Je Modell und Lack 36 Ansichten (BE000..BE350), transparent, auf einen gemeinsamen Ausschnitt je Modell
zugeschnitten (sonst wackelt das Auto beim Drehen), 800 px breit als WebP:
  ausgabe/<modell>-<lack>-NN.webp     (NN = Winkel / 10, 32 = schraeg vorne links)
Fertige Bilder werden uebersprungen, Abbruch und Neustart sind also unschaedlich.
Aufruf: python3 dreh-laden.py [modell ...]    (ohne Angabe: alle)
"""
import concurrent.futures as cf
import io, json, os, re, subprocess, sys, unicodedata
from PIL import Image

HIER = os.path.dirname(os.path.abspath(__file__))
AUSGABE = os.path.join(HIER, "ausgabe")
BASIS = {"mercedes": "https://media.oneweb.mercedes-benz.com/images/dynamic/europe/DE/"}
N = 36
BREITE = 800


def lack_id(name):
    """'MANUFAKTUR opalithweiß bright' -> 'manufaktur-opalithweiss-bright'"""
    s = name.lower().replace("ß", "ss").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def adresse(marke, vorlage, token, pov):
    u = vorlage.replace("{LACK}", token).replace("{POV}", f"{pov}&imwidth=1080")
    pfad, rest = u.split("?q=", 1)
    q, weiter = rest.split("&", 1)
    return BASIS[marke] + pfad + "?q=" + q.replace("%", "%25") + "&" + weiter


def holen(url):
    for _ in range(3):
        r = subprocess.run(["curl", "-sf", "--max-time", "40", "-A", "Mozilla/5.0", url], capture_output=True)
        if r.returncode == 0 and r.stdout:
            try:
                return Image.open(io.BytesIO(r.stdout)).convert("RGBA")
            except Exception:
                pass
    return None


def speichern(args):
    pfad, box, ziel = args
    c = Image.open(pfad).crop(box)
    c = c.resize((BREITE, round(c.height * BREITE / c.width)), Image.LANCZOS)
    c.save(ziel, quality=80, method=4)
    os.remove(pfad)


def modell_laden(marke, mid, m, pool, rechner):
    os.makedirs(AUSGABE, exist_ok=True)
    box = None
    for name, token in m["lacke"]:
        lid = lack_id(name)
        ziele = [os.path.join(AUSGABE, f"{mid}-{lid}-{i:02d}.webp") for i in range(N)]
        if all(os.path.exists(z) for z in ziele):
            continue
        bilder = list(pool.map(lambda i: holen(adresse(marke, m["vorlage"], token, f"BE{i * 10:03d}")), range(N)))
        if any(b is None for b in bilder):
            print("  FEHLT", mid, lid, sum(b is None for b in bilder), flush=True)
            continue
        if box is None:
            # gemeinsamer Ausschnitt aus dem ersten Lack (alle Lacke haben dieselbe Form)
            kisten = [b.getchannel("A").point(lambda a: 255 if a > 4 else 0).getbbox() for b in bilder]
            pad = 6
            box = (max(min(k[0] for k in kisten) - pad, 0), max(min(k[1] for k in kisten) - pad, 0),
                   min(max(k[2] for k in kisten) + pad, bilder[0].width), min(max(k[3] for k in kisten) + pad, bilder[0].height))
            m["_box"] = box
        # Zuschneiden und WebP-Kodierung parallel in eigenen Prozessen
        roh = []
        for i, b in enumerate(bilder):
            p = os.path.join(AUSGABE, f".roh-{mid}-{lid}-{i:02d}.png")
            b.save(p, compress_level=1)
            roh.append((p, box, ziele[i]))
        list(rechner.map(speichern, roh))
        print(" ", mid, lid, "ok", flush=True)


def main():
    wahl = set(sys.argv[1:])
    with cf.ThreadPoolExecutor(12) as pool, cf.ProcessPoolExecutor(os.cpu_count() or 4) as rechner:
        for datei in sorted(os.listdir(os.path.join(HIER, "konfigurator"))):
            if not datei.endswith(".json"):
                continue
            marke = datei.split("-")[0]
            daten = json.load(open(os.path.join(HIER, "konfigurator", datei)))
            for mid, m in daten.items():
                if mid.startswith("_") or (wahl and mid not in wahl):
                    continue
                print(mid, len(m["lacke"]), "Lacke", flush=True)
                modell_laden(marke, mid, m, pool, rechner)
    print("fertig", flush=True)


if __name__ == "__main__":
    main()
