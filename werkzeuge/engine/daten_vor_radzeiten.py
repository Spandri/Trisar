"""Orte, Fahrzeugklassen und Reisezeitmodell für den TRISAR-ENGINE-Prototyp.

Alle Werte sind Annahmen für Simulationen (kein Feldergebnis). Stellen mit
[ERSETZEN] werden in der nächsten Ausbaustufe durch echte Datenquellen ersetzt
(OSRM-Fahrzeiten, MVV-GTFS/MVG-API für ÖPNV, nextbike-API für Radstationen).
"""
from __future__ import annotations

import json
import math
from functools import lru_cache
from dataclasses import dataclass
from pathlib import Path

DEMO_DATEN = Path(__file__).resolve().parents[2] / "admin-app-demo/src/demo/data/distances.json"
_DEMO = json.loads(DEMO_DATEN.read_text())
_DEMO_COORDS = _DEMO["coords"]


def demo_ort(name: str) -> "Ort":
    lat, lng = _DEMO_COORDS[name]
    return Ort(name, lat, lng)

ZENTRUM = (48.1374, 11.5755)  # Marienplatz
INNENSTADT_RADIUS_KM = 8.0     # grob: innerhalb Mittlerer Ring plus Rand


@dataclass(frozen=True)
class Ort:
    name: str
    lat: float
    lng: float


FLUGHAFEN = demo_ort("Flughafen München, Terminal 2")
HBF = demo_ort("München Hauptbahnhof, Bayerstraße 10a")
FLUGHAFEN_NAMEN = {n for n in _DEMO_COORDS if "Flughafen" in n or n.startswith("MUC")}
ANKUNFTSORTE = FLUGHAFEN_NAMEN | {HBF.name}
BETRIEBSSITZ = HBF   # Depot der Demo-App (kiDriverPlanner: 'München Hauptbahnhof, Bayerstraße 10a')


def ist_flughafen(o: "Ort") -> bool:
    return o.name in FLUGHAFEN_NAMEN

HOTELS = [
    Ort("Bayerischer Hof", 48.1405, 11.5729),
    Ort("Mandarin Oriental", 48.1373, 11.5808),
    Ort("Vier Jahreszeiten Kempinski", 48.1391, 11.5822),
    Ort("The Charles", 48.1429, 11.5625),
    Ort("Andaz Schwabinger Tor", 48.1721, 11.5864),
    Ort("Westin Grand Arabellapark", 48.1520, 11.6172),
    Ort("Marriott Berliner Straße", 48.1747, 11.5932),
    Ort("Sofitel Bayerpost", 48.1392, 11.5585),
]


START_UHR_MIN = 0           # Demo: Minute 0 = 00:00 Uhr des Einsatztags


@dataclass(frozen=True)
class Knoten:
    """Möglicher Umsteigepunkt. Keine festen Knoten: die ENGINE wählt je Fahrt
    aus allen U-Bahn-Stationen (MVV-Fahrplan) und Radstandorten."""
    ort: Ort
    ubahn: bool
    rad: bool
    station_id: str | None = None


RAD_STATION_MAX_KM = 0.3


@lru_cache(maxsize=1)
def radstationen() -> tuple[Ort, ...]:
    """MyRadl-Stationen (nextbike, München). Quelle: nextbike Live-Feed, abgerufen 14.10.2026.
    Verfügbarkeit am Einsatztag: Reservierung/Absprache mit nextbike (offen)."""
    pfad = Path(__file__).parent / "daten_extern" / "nextbike_muenchen.json"
    try:
        d = json.loads(pfad.read_text())
    except OSError:
        return ()
    return tuple(Ort(s["name"], s["lat"], s["lng"]) for s in d["stationen"])


@lru_cache(maxsize=None)
def radstation_nah(o: Ort) -> bool:
    stationen = radstationen()
    if not stationen:
        return True   # ohne Daten: Annahme wie bisher
    return any(luftlinie_km(o, st) <= RAD_STATION_MAX_KM for st in stationen)


def _lade_knoten() -> list[Knoten]:
    eg = Ort("Englischer Garten Nord", 48.1569, 11.5939)
    knoten = [Knoten(eg, ubahn=False, rad=radstation_nah(eg))]
    try:
        import oepnv_gtfs
        stationen = oepnv_gtfs.stationen_mit("U-Bahn")
    except (OSError, ImportError):
        return knoten
    z = Ort("Z", *ZENTRUM)
    for sid, o in stationen:
        # Ring zwischen Altstadtrand und Stadtrand: dort lohnt das Umsteigen
        if 2.0 <= luftlinie_km(o, z) <= 9.0:
            ort = Ort("U " + o.name, o.lat, o.lng)
            knoten.append(Knoten(ort, ubahn=True, rad=radstation_nah(ort), station_id=sid))
    return knoten


@dataclass(frozen=True)
class Fahrzeugklasse:
    name: str
    plaetze: int
    gepaeck: int          # Gepäckstücke
    elektrisch: bool
    co2_g_km: int         # Well-to-Wheel
    kosten_ct_km: int
    fix_ct: int           # je eingesetztem Fahrzeug und Einsatz
    anzahl: int           # verfügbare Fahrzeuge
    reichweite_km: int = 0   # E-Fahrzeuge: nutzbare Reichweite voll geladen
    stufe: int = 1           # Größenstufe (1 Limousine, 2 SUV, 3 Großraum)


# Demo-Flotte (vehicles.json, 101 Fahrzeuge). CO2 Well-to-Wheel [Annahme]:
# Strom 363 g/kWh UBA 2024 + 10 % Ladeverlust, Verbrauch je Modell laut Hersteller (gerundet)
# Anzahl wird aus vehicles.json gesetzt (demo_daten.flotte_setzen)
LIMO_E = Fahrzeugklasse("Limousine elektrisch (i7)", 3, 3, True, 85, 22, 8000, 16, 560, 1)
LIMO_D = Fahrzeugklasse("Limousine Benzin (740)", 3, 3, False, 215, 36, 8000, 14, 0, 1)
SUV_E = Fahrzeugklasse("SUV elektrisch (iX/iX3)", 4, 4, True, 90, 24, 9000, 28, 580, 2)
SUV_P = Fahrzeugklasse("SUV Plug-in-Hybrid (M5)", 4, 4, False, 165, 32, 9000, 14, 0, 2)
SUV_D = Fahrzeugklasse("SUV Diesel (X5 40d)", 4, 4, False, 225, 35, 9000, 13, 0, 2)
VAN_D = Fahrzeugklasse("SUV groß Benzin (X7)", 5, 6, False, 270, 42, 10000, 16, 0, 3)
KLASSEN = [LIMO_E, LIMO_D, SUV_E, SUV_P, SUV_D, VAN_D]

E_REICHWEITE_KM = 300       # je E-Fahrzeug, voll geladen bei Dienstbeginn [Annahme]
LADE_KM_JE_MIN = 3          # Schnellladen ca. 50 kW in Wartezeiten [Annahme]
LADE_MIN_WARTEN = 20        # ab dieser Wartezeit wird geladen (Ladepunkt in Reichweite angenommen)

# Arbeitszeitgesetz (vereinfacht): Wartezeit zählt als Arbeitszeit
MAX_DIENST_MIN = 600        # max. 10 h Dienst inkl. Pausen je Schicht (wird aus den Planer-Regeln gesetzt)
MAX_OHNE_PAUSE_MIN = 360    # nach 6 h Arbeit mind. 30 min Pause (§ 4 ArbZG)
PAUSENREGEL = False         # Teamentscheidung 15.10.2026: Pausen ergeben sich aus Wartezeiten, nicht im Modell
PAUSE_MIN = 30
REGEL_DIENST_MIN = 480      # darüber Überstunden (Fairness)
UEBERSTUNDE_CT_MIN = 30     # Zuschlag je Minute über Regeldienst
VIP_FAHRER = 101            # Demo: alle Fahrer dürfen VIP fahren
VORLAUF_PREMIUM_MIN = 20    # Fahrzeug steht so viele Minuten vor Abholung bereit (VIP, Delegation; Teamvorgabe)
VORLAUF_STANDARD_MIN = 15   # dto. Standardgäste (Teamvorgabe)

RABATT_ANTEIL = 0.3         # Anteil der Einsparung, der als Rabatt an den Gast geht

ERLAUBT_ALLE = frozenset({"sammeln", "umstieg", "rad", "oepnv"})


def netz_co2_g_kwh(uhrzeit_min: int) -> float:
    """[Annahme] Typischer Tagesverlauf CO2-Intensität Strommix: mittags Solar niedrig,
    abends hoch. Später: Echtzeit-/Prognosedaten (z. B. Netzbetreiber, §14a EnWG)."""
    h = ((START_UHR_MIN + uhrzeit_min) // 60) % 24
    return {10: 290, 11: 270, 12: 260, 13: 260, 14: 270, 15: 290}.get(h, 420 if 17 <= h <= 21 else 370)
PARTNER_E_ANTEIL = 0.3      # Antriebsmix der Partnerflotte [Annahme]
PARTNER_AKTIV = False       # Teamvorgabe 15.10.2026: erst ohne Partnerflotte rechnen
FLOTTE_UNBEGRENZT = False   # Demo: Flotte aus vehicles.json


def partner_co2_g_km(kl: Fahrzeugklasse) -> float:
    """Partnerflotte ist in der Demo aus (PARTNER_AKTIV False)."""
    return kl.co2_g_km


def klassen_fuer(personen: int, gepaeck: int) -> list[Fahrzeugklasse]:
    """Alle Klassen mit verfügbaren Fahrzeugen, in die Personen und Gepäck passen, kleinste zuerst.
    Demo: größere Fahrzeuge dürfen kleinere Fahrten übernehmen (begrenzte Flotte je Klasse)."""
    return sorted((k for k in KLASSEN if k.anzahl > 0 and personen <= k.plaetze and gepaeck <= k.gepaeck),
                  key=lambda k: (k.stufe, not k.elektrisch))


def klassen_fuer_gruppe(personen: int, gepaeck: int) -> list[Fahrzeugklasse]:
    """Für eine einzelne Buchung: notfalls die größte Klasse (Übergepäck fährt separat)."""
    groesste = [k for k in KLASSEN if k.stufe == 3 and k.anzahl > 0]
    return klassen_fuer(personen, gepaeck) or ([k for k in groesste if personen <= k.plaetze])

FAHRER_CT_MIN = 60          # 36 EUR/h Fahrerkosten
CO2_PREIS_CT_KG = 89        # UBA-Schattenpreis 890 EUR/t [prüfen]
RAD_CT = 300                # Leihrad je Gruppe
OEPNV_CT_PERSON = 150       # Anteil KongressTicket je Fahrt und Person [Annahme]
UMSTIEG_MIN = 5


@lru_cache(maxsize=None)
def luftlinie_km(a: Ort, b: Ort) -> float:
    r = 6371.0
    p1, p2 = math.radians(a.lat), math.radians(b.lat)
    dp, dl = p2 - p1, math.radians(b.lng - a.lng)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(h))


def _kalibriere_umwegfaktor() -> float:
    """Verhältnis Straßen-km (OSRM-Matrix der Demo) zu Luftlinie, Median."""
    try:
        d = json.loads(DEMO_DATEN.read_text())
    except OSError:
        return 1.3
    coords, km = d["coords"], d["km"]
    faktoren = []
    for schluessel, strasse in km.items():
        a, b = schluessel.split("|")
        if a in coords and b in coords and strasse > 1:
            l = luftlinie_km(Ort(a, *coords[a]), Ort(b, *coords[b]))
            if l > 0.5:
                faktoren.append(strasse / l)
    faktoren.sort()
    return faktoren[len(faktoren) // 2] if faktoren else 1.3


UMWEGFAKTOR = _kalibriere_umwegfaktor()


TAGTYP = "werktag"          # werktag | samstag | sonntag (Verkehrsmuster)
_EXTERN = Path(__file__).parent / "daten_extern"


@lru_cache(maxsize=1)
def _osrm():
    """Straßen-km und Fahrzeit ohne Verkehr (OSRM, OpenStreetMap) für alle Planungsorte."""
    try:
        d = json.loads((_EXTERN / "osrm_matrix.json").read_text())
    except OSError:
        return None
    return {n: i for i, n in enumerate(d["orte"])}, d["km"], d["min_frei"]


@lru_cache(maxsize=1)
def _verkehr():
    """Typische Verkehrsfaktoren je Tagestyp, Gebiet und Stunde (TomTom, historische Muster)."""
    try:
        return json.loads((_EXTERN / "verkehrsfaktoren_tomtom.json").read_text())["werte"]
    except OSError:
        return None


def _demo_wert(tab: dict, a: Ort, b: Ort):
    return tab.get(f"{a.name}|{b.name}", tab.get(f"{b.name}|{a.name}"))


@lru_cache(maxsize=None)
def strassen_km(a: Ort, b: Ort) -> float:
    """Straßen-km aus der OSRM-Matrix der Demo (distances.json), sonst Luftlinie × Umwegfaktor."""
    if a.name == b.name:
        return 0.0
    km = _demo_wert(_DEMO["km"], a, b)
    return km if km is not None else luftlinie_km(a, b) * UMWEGFAKTOR


def _innen_anteil_km(a: Ort, b: Ort, km: float) -> float:
    """Grobe Annahme: Strecke verläuft radial, innerer Anteil je Endpunkt
    ist der Abstand bis zum Innenstadtrand."""
    za = Ort("Z", *ZENTRUM)
    ra, rb = luftlinie_km(a, za), luftlinie_km(b, za)
    if ra < INNENSTADT_RADIUS_KM and rb < INNENSTADT_RADIUS_KM:
        return km
    innen = max(0.0, INNENSTADT_RADIUS_KM - ra) + max(0.0, INNENSTADT_RADIUS_KM - rb)
    return min(km, innen * UMWEGFAKTOR)


@lru_cache(maxsize=None)
def anteil_innen(a: Ort, b: Ort) -> float:
    """Anteil der Strecke im Stadtgebiet (für gebietsbezogene Stau-Szenarien)."""
    km = strassen_km(a, b)
    return _innen_anteil_km(a, b, km) / km if km > 0 else 1.0


def _gebiete(a: Ort, b: Ort) -> list[tuple[str, float]]:
    """Gebiete der Strecke mit Anteil: Innenstadt, Zufahrt (Stadtrand bis Mitte), Autobahn."""
    za = Ort("Z", *ZENTRUM)
    w = anteil_innen(a, b)
    if luftlinie_km(a, za) < INNENSTADT_RADIUS_KM and luftlinie_km(b, za) < INNENSTADT_RADIUS_KM:
        return [("innenstadt", 1.0)]
    return [("zufahrt", w), ("autobahn", 1 - w)]


def verkehrsfaktor(a: Ort, b: Ort, uhrzeit: int | None, tagtyp: str) -> float:
    v = _verkehr()
    if v is None:
        return 1.0
    stunde = str(((START_UHR_MIN + (uhrzeit if uhrzeit is not None else 12 * 60)) // 60) % 24)
    tab = v[tagtyp]
    return sum(anteil * tab[g].get(stunde, 1.0) for g, anteil in _gebiete(a, b))


# ---------------------------------------------------------------------------
# Verkehrsereignisse (Demo): Strecken über die A9 im Münchner Norden.
# Zonen grob aus Koordinaten: Nord = Flughafen/Garching, Ost = Messe/Riem.
# Fahrten zwischen Nord und dem übrigen Stadtgebiet laufen über A92/A9 und das
# Kreuz München-Nord (vorbei an der Allianz Arena, AS Fröttmaning). Nord <-> Ost
# kann alternativ über die Flughafentangente Ost (FTO) und die A94 fahren.
# Zuschläge sind Planungsannahmen nach Recherche vom 16.10.2026 (Polizei München,
# Mobilitätsreferat, Unfallbeispiele A9/A92), keine Messwerte.
# ---------------------------------------------------------------------------

FTO_UMWEG_MIN = {("nord", "ost"): 6, ("nord", "stadt"): 15, ("nord", "schwabing"): 15}


def zone(o: Ort) -> str:
    if o.lat > 48.235:
        return "nord"
    if o.lng > 11.65 and o.lat < 48.2:
        return "ost"
    if 48.155 < o.lat < 48.19 and 11.57 < o.lng < 11.62:
        return "schwabing"
    return "stadt"


@dataclass(frozen=True)
class Ereignis:
    """Zuschlag in Minuten auf Fahrten über die A9 Nord (Abfahrt im Zeitfenster).
    profil: Liste (von_min, bis_min, zuschlag_einwaerts, zuschlag_auswaerts); dazwischen linear."""
    name: str
    art: str                 # unfall | grossveranstaltung
    profil: tuple
    schwabing_min: float = 0.0   # zusätzlicher Zuschlag für Fahrten durch Schwabing-Nord (Ungererstraße)
    bekannt: bool = True         # vorab bekannt (Spielplan) oder erst am Einsatztag (Unfall)
    fto_zusatz: float = 0.0      # Umleitung über die FTO ist selbst belastet (umgeleiteter Verkehr)


EREIGNISSE: list[Ereignis] = []   # vom Demo-Lauf gesetzt
_EREIGNIS_STAND = [0]


def ereignisse_setzen(liste: list[Ereignis]) -> None:
    EREIGNISSE[:] = liste
    _EREIGNIS_STAND[0] += 1


def _profil_wert(profil, t: float, idx: int) -> float:
    for (a, b, *w) in profil:
        if a <= t < b:
            return w[idx]
    return 0.0


def a9_betroffen(a: Ort, b: Ort) -> str | None:
    """'einwaerts' (Richtung Stadt), 'auswaerts' (Richtung Flughafen) oder None."""
    za, zb = zone(a), zone(b)
    if za == "nord" and zb != "nord":
        return "einwaerts"
    if zb == "nord" and za != "nord":
        return "auswaerts"
    return None


def ereignis_zuschlag(a: Ort, b: Ort, uhrzeit: int | None) -> tuple[float, str | None]:
    """Zusatzminuten durch Ereignisse und gewählte Route ('A9' oder 'FTO')."""
    if not EREIGNISSE or uhrzeit is None:
        return 0.0, None
    richtung = a9_betroffen(a, b)
    zusatz = 0.0
    for e in EREIGNISSE:
        if richtung:
            zusatz += _profil_wert(e.profil, uhrzeit, 0 if richtung == "einwaerts" else 1)
        if e.schwabing_min and "schwabing" in (zone(a), zone(b)):
            zusatz += _profil_wert(e.profil, uhrzeit, 0) and e.schwabing_min
    if not zusatz:
        return 0.0, None
    if richtung:
        andere = zone(b) if zone(a) == "nord" else zone(a)
        umweg = FTO_UMWEG_MIN.get(("nord", andere))
        if umweg is not None:
            umweg += sum(e.fto_zusatz for e in EREIGNISSE
                         if e.fto_zusatz and _profil_wert(e.profil, uhrzeit, 0 if richtung == "einwaerts" else 1))
        if umweg is not None and umweg < zusatz:
            return float(umweg), "FTO"
    return zusatz, "A9"


def fahrzeit_min(a: Ort, b: Ort, stau_faktor: float = 1.0, uhrzeit: int | None = None) -> int:
    """Fahrzeit ohne Verkehr aus OSRM (Straßennetz), multipliziert mit dem typischen
    Verkehrsfaktor aus TomTom für Gebiet, Stunde und Tagestyp, plus Zuschlag aus Ereignissen."""
    return _fahrzeit(a, b, stau_faktor, uhrzeit, TAGTYP, _EREIGNIS_STAND[0])


def route(a: Ort, b: Ort, uhrzeit: int | None) -> str | None:
    return ereignis_zuschlag(a, b, uhrzeit)[1]


@lru_cache(maxsize=None)
def _fahrzeit(a: Ort, b: Ort, stau_faktor: float, uhrzeit: int | None, tagtyp: str, stand: int = 0) -> int:
    if a.name == b.name:
        return 1
    frei = _demo_wert(_DEMO["minuten"], a, b)
    if frei is None:
        km = strassen_km(a, b)
        innen = _innen_anteil_km(a, b, km)
        frei = (km - innen) / 70 * 60 + innen / 30 * 60   # Rückfall: Freifluss-Annahme
    zusatz, _ = ereignis_zuschlag(a, b, uhrzeit)
    return max(1, round((frei * verkehrsfaktor(a, b, uhrzeit, tagtyp) + zusatz) * stau_faktor))


def rad_min(knoten: Knoten, ziel: Ort) -> int | None:
    """Rad/E-Bike bis 5 km, 16 km/h, 3 min Übergabe."""
    if not knoten.rad or not radstation_nah(ziel):
        return None
    km = luftlinie_km(knoten.ort, ziel) * 1.25
    return None if km > 5 else round(km / 16 * 60) + 3


def oepnv_min(knoten: Knoten, ziel: Ort, ab_min: int) -> int | None:
    """Reisezeit laut MVV-Soll-Fahrplan ab Umsteigepunkt (ab_min relativ zu
    START_UHR_MIN), inkl. Warten und Fußweg. Echtzeit folgt für den Einsatztag."""
    if not knoten.ubahn or knoten.station_id is None:
        return None
    import oepnv_gtfs
    t = oepnv_gtfs.reisezeit_min(knoten.station_id, ziel, START_UHR_MIN + ab_min)
    return t if t is not None and t <= 45 else None


KNOTEN = _lade_knoten()


def rad_min_ab_ort(start: Ort, ziel: Ort) -> int | None:
    """Rad/E-Bike direkt ab Hotel o. Ä., bis 5 km, MyRadl-Station an Start und Ziel."""
    if not (radstation_nah(start) and radstation_nah(ziel)):
        return None
    km = luftlinie_km(start, ziel) * 1.25
    return None if km > 5 or km < 0.3 else round(km / 16 * 60) + 5


def oepnv_min_ab_ort(start: Ort, ziel: Ort, ab_min: int) -> int | None:
    import oepnv_gtfs
    t = oepnv_gtfs.reisezeit_ab_ort_min(start, ziel, START_UHR_MIN + ab_min)
    return t if t is not None and t <= 45 else None
