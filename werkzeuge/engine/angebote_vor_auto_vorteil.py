"""Rad- und ÖPNV-Angebote an Standardgäste, vor der Planung verschickt.

Teamvorgabe 16.10.2026: Der Gast wird vorab gefragt. Das Fahrzeug bleibt zur Sicherheit so
eingeplant, als ob es die ganze Fahrt macht (z. B. bei Regen). Sagt der Gast zu, fährt ihn das
Fahrzeug bequem bis zum Umsteigepunkt, von dort geht es mit Leihrad (MyRadl/nextbike) oder
U-Bahn (MVV-Fahrplan) weiter. Gepäck bleibt im Fahrzeug und wird ans Ziel gebracht.

Nur mit Umstieg: Ein Weg ganz ohne Auto braucht keinen Fahrer und gehört nicht zur Idee
der multimodalen Knoten (Entscheidung 02.11.2026).

Sinnvoll heißt hier: Standardgast (kein VIP), höchstens 2 Personen, die Alternative ist
nicht langsamer als das Auto im vorhergesagten Verkehr, das Auto spart mindestens 3 km,
Rad nur bei Tageslicht (07:30 bis 18:30).
"""
from __future__ import annotations

import daten
from daten import KNOTEN, UMSTIEG_MIN, fahrzeit_min, oepnv_min, rad_min, strassen_km

RAD_VON, RAD_BIS = 7 * 60 + 30, 18 * 60 + 30
MIN_KM_GESPART = 3.0
RAD_TOLERANZ_MIN = 6      # Rad darf etwas länger dauern als das Auto (Erlebnis, kein Stau)
MIN_UMSTIEG_ABSTAND_KM = 0.8
CO2_G_KM_AUTO = 85        # E-Limousine der Demo, Well-to-Wheel
CO2_G_PKM_OEPNV = 55


def _kurz(name: str) -> str:
    return name.split(",")[0].replace("U ", "U-Bahn ")


def _nachricht(g, modus, knoten, auto_min, weiter_min, gespart, gepaeck, stau) -> str:
    ziel = _kurz(g.ziel.name)
    mittel = "mit dem Leihrad" if modus == "rad" else "mit der U-Bahn"
    einstieg = ("Zu Ihrer Fahrzeit ist auf der Strecke viel Verkehr vorhergesagt. Unsere Alternative: "
                if stau else "Wir haben eine schöne Alternative für Sie: ")
    if knoten is None:
        text = f"{einstieg}{mittel[0].upper() + mittel[1:]} sind Sie in rund {weiter_min} Minuten bei {ziel}"
    else:
        text = (f"{einstieg}Wir fahren Sie bequem bis {_kurz(knoten.ort.name)} ({auto_min} Minuten), von dort sind Sie "
                f"{mittel} in rund {weiter_min} Minuten bei {ziel}")
    if gespart >= 3 and stau:
        text += f", etwa {gespart} Minuten schneller als mit dem Auto im Stau"
    if gespart > 0:
        text += ". So sparen Sie Zeit, reisen entspannter"
    else:
        text += ". So reisen Sie entspannter, ganz ohne Stau"
    text += " und sehen etwas von der Stadt." if modus == "rad" else " und kommen planbar an."
    if gepaeck:
        text += " Ihr Gepäck bringen wir direkt ans Ziel."
    text += " Ihr Fahrzeug bleibt für Sie reserviert, falls Sie es sich anders überlegen oder das Wetter umschlägt."
    return text


def fuer_tag(gs) -> list[dict]:
    out = []
    for g in gs:
        if g.premium or g.personen > 2:
            continue
        ab = g.ankunft
        auto = fahrzeit_min(g.start, g.ziel, uhrzeit=ab)
        stau = auto >= 1.15 * fahrzeit_min(g.start, g.ziel, uhrzeit=3 * 60)
        km_auto = strassen_km(g.start, g.ziel)
        best = None
        def wert(k):   # Rad leicht bevorzugt (Erlebnis), sonst schnellste Variante
            return k[0] - (4 if k[1] == "rad" else 0)
        # Auto bis Umsteigepunkt, dann Rad oder U-Bahn
        for kn in KNOTEN:
            bis = fahrzeit_min(g.start, kn.ort, uhrzeit=ab)
            km_bis = strassen_km(g.start, kn.ort)
            if km_bis + strassen_km(kn.ort, g.ziel) > 1.2 * km_auto or km_auto - km_bis < MIN_KM_GESPART \
                    or daten.luftlinie_km(kn.ort, g.ziel) < MIN_UMSTIEG_ABSTAND_KM:
                continue
            weiter_ab = ab + bis + UMSTIEG_MIN
            for modus, dauer in (("rad", rad_min(kn, g.ziel) if RAD_VON <= weiter_ab <= RAD_BIS else None),
                                 ("oepnv", oepnv_min(kn, g.ziel, weiter_ab))):
                if dauer is None:
                    continue
                gesamt = bis + UMSTIEG_MIN + dauer
                if gesamt <= auto + (RAD_TOLERANZ_MIN if modus == "rad" else 0):
                    kand = (gesamt, modus, kn, bis, dauer, km_auto - km_bis)
                    best = min(best, kand, key=wert) if best else kand
        if not best:
            continue
        gesamt, modus, kn, bis, dauer, km_gespart = best
        gespart = auto - gesamt
        co2 = km_gespart * CO2_G_KM_AUTO / 1000 - (km_gespart * CO2_G_PKM_OEPNV * g.personen / 1000 if modus == "oepnv" else 0)
        out.append({
            "ride_id": g.job_id, "modus": modus,
            "umstieg": kn.ort.name if kn else None,
            "auto_bis_min": bis, "weiter_min": dauer, "gesamt_min": gesamt, "auto_min": auto,
            "zeit_gespart_min": gespart, "km_gespart": round(km_gespart, 1), "co2_gespart_kg": round(max(0.0, co2), 2),
            "abfahrt": f"{ab // 60:02d}:{ab % 60:02d}",
            "stau_vorhergesagt": stau,
            "nachricht": _nachricht(g, modus, kn, bis, dauer, gespart, g.gepaeck, stau),
        })
    return out
