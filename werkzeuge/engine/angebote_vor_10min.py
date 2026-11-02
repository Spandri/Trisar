"""Rad- und ÖPNV-Angebote an Standardgäste, vor der Planung verschickt.

Teamvorgabe 16.10.2026: Der Gast wird vorab gefragt. Das Fahrzeug bleibt zur Sicherheit so
eingeplant, als ob es die ganze Fahrt macht (z. B. bei Regen). Sagt der Gast zu, fährt ihn das
Fahrzeug bequem bis zum Umsteigepunkt, von dort geht es mit Leihrad (MyRadl/nextbike) oder
U-Bahn (MVV-Fahrplan) weiter. Gepäck bleibt im Fahrzeug und wird ans Ziel gebracht.

Entscheidungen 02.11.2026: Nur mit Umstieg (ein Weg ganz ohne Auto braucht keinen Fahrer).
Das Angebot muss nicht oft passen, aber wenn, dann sinnvoll:
- Ohne Auto ab Start (Rad oder U-Bahn) wäre der Gast mindestens 10 Minuten langsamer,
  sonst würde der Fahrer nur zur nächsten Station derselben Linie fahren.
- Der Umsteigepunkt liegt mindestens 2 km vom Start, Rad oder U-Bahn übernehmen mindestens
  30 % der Autostrecke und fahren mindestens 8 Minuten.
- Verglichen wird mit dem Auto über 500 Tagesverläufe (Verkehr schwankt von Tag zu Tag):
  An einem Tag mit viel Verkehr (jeder 5.) höchstens 3 Minuten langsamer als das Auto,
  an einem normalen Tag höchstens 5 Minuten. Der Vorteil ist Planbarkeit, U-Bahn und Rad
  stehen nicht im Stau.
- Standardgast (kein VIP), höchstens 2 Personen, Rad nur bei Tageslicht (07:30 bis 18:30).
"""
from __future__ import annotations

import statistics

import daten
import oepnv_gtfs
from daten import KNOTEN, START_UHR_MIN, UMSTIEG_MIN, fahrzeit_min, oepnv_min, rad_min, rad_min_ab_ort, strassen_km

RAD_VON, RAD_BIS = 7 * 60 + 30, 18 * 60 + 30
MIN_KM_GESPART = 3.0
MIN_UMSTIEG_ABSTAND_KM = 0.8
MIN_AUTO_STRECKE_KM = 2.0     # Umsteigepunkt so weit weg vom Start, dass das Auto etwas bringt
MIN_VORTEIL_AUTO_MIN = 10     # so viel schneller als der beste Weg ohne Auto ab Start
MIN_ANTEIL_ERSETZT = 0.3      # Anteil der Autostrecke, den Rad oder U-Bahn übernehmen
MIN_WEITER_MIN = 8            # Rad oder U-Bahn fahren mindestens so lange
VIEL_VERKEHR_QUANTIL = 0.8    # Tag mit viel Verkehr: jeder 5. Tagesverlauf
MAX_LANGSAMER_VIEL_MIN = 3    # an so einem Tag höchstens so viel langsamer als das Auto
MAX_LANGSAMER_NORMAL_MIN = 5  # an einem normalen Tag (Median) höchstens so viel langsamer
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


def fuer_tag(gs, szen) -> list[dict]:
    """szen: Tagesverläufe (szenarien.erzeuge), aus denen der Pkw-Verkehr je Tag kommt."""
    out = []
    for g in gs:
        if g.premium or g.personen > 2:
            continue
        ab = g.ankunft
        auto = fahrzeit_min(g.start, g.ziel, uhrzeit=ab)
        stau = auto >= 1.15 * fahrzeit_min(g.start, g.ziel, uhrzeit=3 * 60)
        km_auto = strassen_km(g.start, g.ziel)
        f_auto = [s.f(g.start, g.ziel) for s in szen]
        # Bester Weg ohne Auto ab Start (U-Bahn ohne 45-min-Grenze)
        ohne = [t for t in (rad_min_ab_ort(g.start, g.ziel) if RAD_VON <= ab <= RAD_BIS else None,
                            oepnv_gtfs.reisezeit_ab_ort_min(g.start, g.ziel, START_UHR_MIN + ab)) if t is not None]
        ohne_auto = min(ohne) if ohne else None
        best = None
        for kn in KNOTEN:
            if daten.luftlinie_km(g.start, kn.ort) < MIN_AUTO_STRECKE_KM \
                    or daten.luftlinie_km(kn.ort, g.ziel) < MIN_UMSTIEG_ABSTAND_KM:
                continue
            km_bis = strassen_km(g.start, kn.ort)
            if km_bis + strassen_km(kn.ort, g.ziel) > 1.2 * km_auto \
                    or km_auto - km_bis < max(MIN_KM_GESPART, MIN_ANTEIL_ERSETZT * km_auto):
                continue
            bis = fahrzeit_min(g.start, kn.ort, uhrzeit=ab)
            weiter_ab = ab + bis + UMSTIEG_MIN
            for modus, dauer in (("rad", rad_min(kn, g.ziel) if RAD_VON <= weiter_ab <= RAD_BIS else None),
                                 ("oepnv", oepnv_min(kn, g.ziel, weiter_ab))):
                if dauer is None or dauer < MIN_WEITER_MIN:
                    continue
                gesamt = bis + UMSTIEG_MIN + dauer
                if ohne_auto is not None and ohne_auto - gesamt < MIN_VORTEIL_AUTO_MIN:
                    continue
                # Vorsprung gegenüber dem Auto je Tagesverlauf (negativ = langsamer)
                vorsprung = sorted(auto * fa - (bis * s.f(g.start, kn.ort) + UMSTIEG_MIN + dauer)
                                   for fa, s in zip(f_auto, szen))
                normal = statistics.median(vorsprung)
                viel = vorsprung[int(VIEL_VERKEHR_QUANTIL * len(vorsprung))]
                if viel < -MAX_LANGSAMER_VIEL_MIN or normal < -MAX_LANGSAMER_NORMAL_MIN:
                    continue
                kand = (-viel, modus, kn, bis, dauer, km_auto - km_bis, gesamt, normal, viel)
                if best is None or kand[0] < best[0]:
                    best = kand
        if not best:
            continue
        _, modus, kn, bis, dauer, km_gespart, gesamt, normal, viel = best
        gespart = auto - gesamt
        co2 = km_gespart * CO2_G_KM_AUTO / 1000 - (km_gespart * CO2_G_PKM_OEPNV * g.personen / 1000 if modus == "oepnv" else 0)
        out.append({
            "ride_id": g.job_id, "modus": modus,
            "umstieg": kn.ort.name,
            "auto_bis_min": bis, "weiter_min": dauer, "gesamt_min": gesamt, "auto_min": auto,
            "ohne_auto_min": ohne_auto,   # bester Weg ohne Auto ab Start, None = nicht sinnvoll möglich
            "vorsprung_normal_min": round(normal), "vorsprung_viel_verkehr_min": round(viel),
            "zeit_gespart_min": gespart, "km_gespart": round(km_gespart, 1), "co2_gespart_kg": round(max(0.0, co2), 2),
            "abfahrt": f"{ab // 60:02d}:{ab % 60:02d}",
            "stau_vorhergesagt": stau,
            "nachricht": _nachricht(g, modus, kn, bis, dauer, gespart, g.gepaeck, stau),
        })
    return out
