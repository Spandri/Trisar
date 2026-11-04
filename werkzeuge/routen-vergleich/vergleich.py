#!/usr/bin/env python3
"""Vergleich der Fahrzeit-Annahmen fuer die Engine gegen TomTom (typischer Verkehr).

Varianten je Strecke und Zeitpunkt:
  1 zonen     – was die Engine im Live-Betrieb heute annimmt (Zonenmodell aus admin_payload_adapter.py)
  2 osrm_std  – eigener OSRM (frei, ohne Verkehr) x heutiger Stundenfaktor (traffic_factors.json)
  3 osrm_raum – eigener OSRM x Faktor je Raumtyp und Zeitpunkt, gelernt aus einem getrennten Lernsatz
  ref         – TomTom calculateRoute mit departAt (typischer Verkehr dieses Wochentags)

Der TomTom-Schluessel kommt aus admin/.env.local (VITE_TOMTOM_API_KEY) und wird nie ausgegeben.
Ergebnisse: ergebnisse.csv und ERGEBNIS.md in diesem Ordner. Zwischenspeicher: cache.json.
"""
import csv, json, math, os, statistics, sys, time, urllib.parse, urllib.request
from pathlib import Path

HIER = Path(__file__).resolve().parent
REPO = HIER.parents[1]
OSRM = os.environ.get("OSRM_URL", "http://100.94.169.59:5001")
ZENTRUM = (48.1374, 11.5755)  # Marienplatz, wie "München, Deutschland" im Adapter

# Orte so geschrieben, wie sie in Fahrten stehen (Stadtname entscheidet im Zonenmodell).
ORTE = [
    "Flughafen München Terminal 1", "Flughafen München Terminal 2", "Am Messesee 2, München",
    "Bayerstraße 10a, München", "Marienplatz 1, München", "Am Olympiapark 1, München",
    "Werner-Heisenberg-Allee 25, München", "Leopoldstraße 82, München", "Orleansplatz 11, München",
    "Pasinger Bahnhofsplatz 5, München", "Ernastraße 5, München", "Franz-Heubl-Straße 25, München",
    "Boschetsrieder Straße 67, München", "Herkomerplatz 2, München", "Karl-Marx-Ring 52, München",
    "Hanauer Straße 68, München", "Parkring 4, Garching bei München", "Bahnhofstraße 1, Starnberg",
    "Südliche Münchner Straße 1, Grünwald", "Bahnhofstraße 1, Freising", "Münchner Straße 1, Unterföhring",
    "Bahnhofstraße 20, Erding", "Landsberger Straße 300, München", "Prinzregentenplatz 12, München",
]

# Testsatz und Lernsatz: getrennte Paare (Index in ORTE).
TEST = [(0,2),(2,4),(3,5),(4,8),(10,2),(11,10),(12,4),(13,7),(6,1),(9,3),(14,2),(15,6),(16,1),(17,4),
        (18,3),(19,0),(20,7),(21,1),(22,4),(23,2),(7,0),(5,16),(8,22),(12,17),(4,13),(1,9),(2,21),(3,18),(6,20),(14,23)]
LERN = [(1,2),(2,3),(4,5),(3,8),(10,4),(11,2),(12,3),(13,4),(6,0),(9,4),(14,4),(15,7),(16,0),(17,3),
        (18,4),(19,1),(20,4),(21,0),(22,3),(23,4),(7,1),(5,17),(8,9),(12,18),(5,13),(0,9),(2,19),(4,18),(7,20),(14,8)]

# Zeitpunkte naechste Woche (MEZ): Berufsverkehr frueh, Freitag-Feierabend, Sonntag.
ZEITEN = [("Mo 08:00", "2026-11-09T08:00:00+01:00", 8), ("Fr 17:00", "2026-11-13T17:00:00+01:00", 17),
          ("So 11:00", "2026-11-15T11:00:00+01:00", 11)]

NEAR = ("garching","unterfoehring","unterföhring","aschheim","haar","gruenwald","grünwald","pullach","planegg",
        "ottobrunn","oberschleissheim","oberschleißheim","neubiberg","ismaning","hallbergmoos","freising","erding",
        "dachau","starnberg")
INNER = ("münchen","muenchen","munchen","muc","80331","80333","80335","80336","80337","80339","80636","80801","80939")

cache_pfad = HIER / "cache.json"
cache = json.loads(cache_pfad.read_text()) if cache_pfad.exists() else {}
def speichern(): cache_pfad.write_text(json.dumps(cache, ensure_ascii=False, indent=1))

def schluessel():
    for zeile in (REPO / "admin/.env.local").read_text().splitlines():
        if zeile.startswith("VITE_TOMTOM_API_KEY="):
            return zeile.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("kein TomTom-Schluessel")
KEY = schluessel()

def hole(url, versuche=3):
    for i in range(versuche):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "trisar-routenvergleich"}), timeout=20) as r:
                return json.load(r)
        except Exception as e:
            if i == versuche - 1: raise
            time.sleep(1.5 * (i + 1))

def geocode(adresse):
    k = "geo|" + adresse
    if k not in cache:
        url = (f"https://api.tomtom.com/search/2/geocode/{urllib.parse.quote(adresse)}.json"
               f"?key={KEY}&limit=1&lat=48.137&lon=11.575&countrySet=DE&language=de-DE")
        pos = hole(url)["results"][0]["position"]
        cache[k] = [pos["lat"], pos["lon"]]; speichern(); time.sleep(0.25)
    return tuple(cache[k])

def osrm_min(a, b):
    k = f"osrm|{a}|{b}"
    if k not in cache:
        r = hole(f"{OSRM}/route/v1/driving/{a[1]},{a[0]};{b[1]},{b[0]}?overview=false")["routes"][0]
        cache[k] = [r["duration"] / 60, r["distance"] / 1000]; speichern()
    return cache[k]

def tomtom_min(a, b, depart):
    k = f"tt|{a}|{b}|{depart}"
    if k not in cache:
        url = (f"https://api.tomtom.com/routing/1/calculateRoute/{a[0]},{a[1]}:{b[0]},{b[1]}/json"
               f"?key={KEY}&traffic=true&travelMode=car&departAt={urllib.parse.quote(depart)}&computeTravelTimeFor=all")
        s = hole(url)["routes"][0]["summary"]
        cache[k] = [s["travelTimeInSeconds"] / 60, s.get("noTrafficTravelTimeInSeconds", s["travelTimeInSeconds"]) / 60,
                    s["lengthInMeters"] / 1000]
        speichern(); time.sleep(0.25)
    return cache[k]

def km(a, b):
    r = 6371; p1, p2 = math.radians(a[0]), math.radians(b[0])
    d = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(b[1] - a[1]) / 2) ** 2
    return 2 * r * math.asin(math.sqrt(d))

def zone(adresse):
    """_infer_zone_from_address mit OSRM-Provider ab Muenchen-Zentrum."""
    t = adresse.lower()
    if any(x in t for x in ("flughafen", "airport", "terminal 1", "terminal 2")): return ("FLUGHAFEN_MUC", 40)
    if any(x in t for x in INNER): return ("MUENCHEN_INNEN", 0)
    m = max(1, round(osrm_min(ZENTRUM, geocode(adresse))[0]))
    if m <= 30: return ("MUENCHEN_UMFELD_30", 30)
    b = max(15, math.ceil(m / 15) * 15)
    return (f"REMOTE_{b}M", b)

def zonen_min(a, b):
    za, zb = zone(a), zone(b)
    return 0 if za[0] == zb[0] else max(30, za[1], zb[1])

def raumtyp(a, b):
    if "flughafen" in a.lower() or "flughafen" in b.lower(): return "flughafen"
    ka, kb = km(ZENTRUM, geocode(a)), km(ZENTRUM, geocode(b))
    if ka < 4 and kb < 4: return "innenstadt"
    if ka < 10 and kb < 10: return "stadt"
    return "umland"

stunden = json.loads((REPO / "admin/src/demo/data/traffic_factors.json").read_text())["stundenFaktor"]

def zeilen(paare):
    out = []
    for i, j in paare:
        a, b = ORTE[i], ORTE[j]
        ga, gb = geocode(a), geocode(b)
        o_min, o_km = osrm_min(ga, gb)
        for name, depart, h in ZEITEN:
            tt, tt_frei, tt_km = tomtom_min(ga, gb, depart)
            out.append(dict(von=a, nach=b, zeit=name, raum=raumtyp(a, b), osrm=o_min, osrm_km=o_km,
                            tomtom=tt, tomtom_frei=tt_frei, tomtom_km=tt_km,
                            zonen=zonen_min(a, b), osrm_std=o_min * float(stunden.get(str(h), 1))))
    return out

print("Lernsatz ..."); lern = zeilen(LERN)
faktor = {}
for r in lern:
    faktor.setdefault((r["raum"], r["zeit"]), []).append(r["tomtom"] / max(r["osrm"], 0.5))
faktor = {k: statistics.median(v) for k, v in faktor.items()}
print("Testsatz ..."); test = zeilen(TEST)
for r in test:
    f = faktor.get((r["raum"], r["zeit"]))
    if f is None:  # Raumtyp im Lernsatz nicht vorhanden: Median aller Faktoren zu diesem Zeitpunkt
        f = statistics.median([v for (raum, z), v in faktor.items() if z == r["zeit"]])
    r["osrm_raum"] = r["osrm"] * f

with open(HIER / "ergebnisse.csv", "w", newline="") as fh:
    w = csv.DictWriter(fh, fieldnames=list(test[0].keys())); w.writeheader(); w.writerows(test)

def kennzahlen(feld, rows):
    fehler = [r[feld] - r["tomtom"] for r in rows]
    absf = [abs(x) for x in fehler]
    return dict(mittel=statistics.mean(absf), median=statistics.median(absf), max=max(absf),
                ueber5=sum(1 for x in absf if x > 5), unter=sum(1 for x in fehler if x < -5), n=len(rows))

zeilen_md = ["# Routenvergleich Engine-Annahmen gegen TomTom (typischer Verkehr)", "",
             f"{len(TEST)} Teststrecken x {len(ZEITEN)} Zeitpunkte = {len(test)} Fälle. Abweichung in Minuten gegenüber TomTom.", "",
             "| Variante | mittlere Abw. | Median | größte | > 5 min daneben | davon zu kurz geplant |", "|---|---|---|---|---|---|"]
namen = {"zonen": "1 Engine heute (Zonen)", "osrm_std": "2 OSRM x Stundenfaktor", "osrm_raum": "3 OSRM x Faktor je Raum/Zeit"}
for feld in ("zonen", "osrm_std", "osrm_raum"):
    k = kennzahlen(feld, test)
    zeilen_md.append(f"| {namen[feld]} | {k['mittel']:.1f} | {k['median']:.1f} | {k['max']:.0f} | {k['ueber5']} von {k['n']} | {k['unter']} |")
zeilen_md += ["", "Je Raumtyp (mittlere Abweichung in min):", "", "| Raum | Fälle | Zonen | OSRM x Std | OSRM x Raum |", "|---|---|---|---|---|"]
for raum in sorted({r["raum"] for r in test}):
    rs = [r for r in test if r["raum"] == raum]
    zeilen_md.append(f"| {raum} | {len(rs)} | " + " | ".join(f"{kennzahlen(f, rs)['mittel']:.1f}" for f in ("zonen", "osrm_std", "osrm_raum")) + " |")
zeilen_md += ["", "Gelernte Faktoren (TomTom / OSRM, Median):", "", "| Raum | Zeit | Faktor |", "|---|---|---|"]
for (raum, z), f in sorted(faktor.items()):
    zeilen_md.append(f"| {raum} | {z} | {f:.2f} |")
(HIER / "ERGEBNIS.md").write_text("\n".join(zeilen_md) + "\n")
print("\n".join(zeilen_md))
