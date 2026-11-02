"""Fahrzeit ab Muenchen fuer jeden Ort der Demo-Fahrten — einmalig, wie der Planer.

Der Planer (OpenStreetMapTravelTimeProvider.minutes_from_munich) geokodiert
"München, Deutschland" und das Ziel ueber Nominatim und fragt OSRM nach der
Fahrdauer. Nominatim antwortet bei vielen Anfragen nicht (Ratenbegrenzung),
der Planer setzt dann pauschal 75 min an. Hier gleiche Rechnung, aber mit den
festen Koordinaten der Demo (orte.json) und einmal gerechnet.
"""
import json, math, os, time, urllib.request

HIER = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.normpath(os.path.join(HIER, "..", "..", "admin-app-demo", "src", "demo", "data"))
orte = json.load(open(f"{DEMO}/orte.json"))
jobs = json.load(open(f"{DEMO}/jobs.json"))
MUENCHEN = None

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "trisar-driver-planner/1.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))

# Ursprung genau wie der Planer: Nominatim fuer "München, Deutschland"
treffer = get("https://nominatim.openstreetmap.org/search?q=M%C3%BCnchen%2C+Deutschland&format=jsonv2&limit=1&addressdetails=0&countrycodes=de")
MUENCHEN = (float(treffer[0]["lat"]), float(treffer[0]["lon"]))
print("Ursprung München:", MUENCHEN)

adressen = sorted({str(j.get(f) or "").strip() for j in jobs for f in ("pickup_address", "dropoff_address")} - {""})
ergebnis, fehlend = {}, []
for adresse in adressen:
    punkt = orte.get(adresse)
    if not punkt:
        fehlend.append(adresse); continue
    lat = punkt.get("lat") if isinstance(punkt, dict) else punkt[0]
    lng = punkt.get("lng") if isinstance(punkt, dict) else punkt[1]
    url = f"https://router.project-osrm.org/route/v1/driving/{MUENCHEN[1]:.6f},{MUENCHEN[0]:.6f};{float(lng):.6f},{float(lat):.6f}?overview=false&alternatives=false&steps=false"
    for versuch in range(4):
        try:
            daten = get(url)
            sekunden = float(daten["routes"][0]["duration"])
            ergebnis[adresse.lower()] = max(1, int(round(sekunden / 60.0)))
            break
        except Exception as e:
            time.sleep(2 + versuch * 2)
    time.sleep(1.1)
json.dump(ergebnis, open(os.path.join(HIER, "fahrzeiten_von_muenchen.json"), "w"), ensure_ascii=False, indent=1)
print(f"{len(ergebnis)} Fahrzeiten, ohne Koordinaten: {len(fehlend)}")
for a in fehlend[:20]: print("  fehlt:", a)
