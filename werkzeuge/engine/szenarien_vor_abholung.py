"""Szenarien des Einsatztages: Erzeugung, Verdichtung, Bewertung von Plänen.

Annahmen [ERSETZEN durch Daten]: Verspätungsverteilung je Flug (später aus
Flughafen-/Eurocontrol-Daten), Stau als Faktor auf Pkw-Fahrzeiten (später aus
Verkehrsdaten je Uhrzeit), Regenwahrscheinlichkeit (später Wetterdienst).
U-Bahn und Rad sind vom Stau nicht betroffen; bei Regen entfällt das Rad.
"""
from __future__ import annotations

import dataclasses
import random
import statistics
from collections import defaultdict
from dataclasses import dataclass

from daten import BETRIEBSSITZ, FLUGHAFEN, HBF, UMSTIEG_MIN, anteil_innen, fahrzeit_min, ist_flughafen
from instanz import Gruppe
from touren import Kandidaten

REGEN_P = 0.25
ABLEHNUNG_P = 0.2   # [Annahme] Gast lehnt die zugesagte Rad/ÖPNV-Option am Tag doch ab
VERSPAETUNG_CT_MIN = 500       # Bewertung je Minute Verspätung einer Gruppe [Annahme]
REGEN_ERSATZ_WARTEN_MIN = 15   # Ersatzfahrzeug am Umsteigepunkt bei Regen
SPAET_SCHWELLE_MIN = 5         # ab dieser Verspätung gilt eine Gruppe als verspätet


_DIREKT: dict[tuple[str, str], int] = {}


def frist(g: Gruppe, s: "Szenario") -> float:
    """Späteste Ankunft im Szenario. Verschiebt sich mit Flug-/Zugverspätung und
    mit dem Stau auf der Direktstrecke: gemessen wird nur die Verspätung, die die
    Disposition verursacht (Warten auf Fahrzeug, Umwege, Umstiege)."""
    schluessel = (g.start.name, g.ziel.name)
    if schluessel not in _DIREKT:
        _DIREKT[schluessel] = fahrzeit_min(g.start, g.ziel)
    return g.spaetestens + max(0, s.verspaetung[g.id]) + max(0.0, s.f(g.start, g.ziel) - 1) * _DIREKT[schluessel]


@dataclass
class Szenario:
    verspaetung: dict[int, int]   # Minuten je Gruppe (negativ = früher)
    stau: float                   # Faktor auf Pkw-Fahrzeiten
    regen: bool
    gewicht: float = 1.0
    abgelehnt: frozenset = frozenset()   # Gäste, die Rad/ÖPNV am Tag doch ablehnen
    stau_stadt: float | None = None      # Faktor Stadtgebiet (Innenstadt, Zufahrten)
    stau_autobahn: float | None = None   # Faktor Autobahn/Außenbereich

    def f(self, a, b) -> float:
        """Stau-Faktor für eine Strecke, gewichtet nach Anteil Stadtgebiet/Autobahn."""
        if self.stau_stadt is None:
            return self.stau
        w = anteil_innen(a, b)
        return w * self.stau_stadt + (1 - w) * self.stau_autobahn


def _flugverspaetung(rnd: random.Random) -> int:
    """Kalibriert auf veröffentlichte Pünktlichkeit: Eurocontrol-Netz 2025 76,1 % der
    Ankünfte höchstens 15 min verspätet, Flughafen München 2025 "über 75 %" (Presse).
    Zusammen mit gemeinsamen Störungen ergibt sich ca. 77 % <= 15 min."""
    u = rnd.random()
    if u < 0.62:
        return rnd.randint(-15, 5)
    if u < 0.80:
        return rnd.randint(5, 15)
    if u < 0.95:
        return rnd.randint(15, 45)
    if u < 0.99:
        return rnd.randint(45, 120)
    return rnd.randint(120, 240)


def _zugverspaetung(rnd: random.Random) -> int:
    """Kalibriert auf DB-Fernverkehr 2025: 60,1 % pünktlich (unter 6 min, Presseberichte)."""
    u = rnd.random()
    if u < 0.60:
        return rnd.randint(-2, 5)
    if u < 0.85:
        return rnd.randint(5, 20)
    if u < 0.97:
        return rnd.randint(20, 60)
    return rnd.randint(60, 120)


def _gast_bereit(rnd: random.Random) -> int:
    """[Annahme] Gast steht am Hotel/Veranstaltungsort meist pünktlich bereit."""
    return rnd.randint(10, 20) if rnd.random() < 0.05 else rnd.randint(-2, 6)


VERSPAETUNG_SKALA = 1.0   # für Sensitivitätsanalyse


def _verspaetung(g: Gruppe, rnd: random.Random, gemeinsam: int) -> int:
    return round(VERSPAETUNG_SKALA * _verspaetung_basis(g, rnd, gemeinsam))


def _verspaetung_basis(g: Gruppe, rnd: random.Random, gemeinsam: int) -> int:
    if ist_flughafen(g.start):
        if not g.flug:
            return rnd.randint(-2, 8)   # Abholung am Terminal ohne Flugnummer: Gast meist pünktlich [Annahme]
        return _flugverspaetung(rnd) + gemeinsam
    if g.start.name == HBF.name:
        return _zugverspaetung(rnd)
    return _gast_bereit(rnd)


def erzeuge(gruppen: list[Gruppe], n: int = 1000, seed: int = 7) -> list[Szenario]:
    rnd = random.Random(seed)
    szen = []
    for _ in range(n):
        # gemeinsame Störung (z. B. Flugsicherung, Wetter) verschiebt alle Ankünfte
        gemeinsam = rnd.randint(15, 45) if rnd.random() < 0.08 else 0   # Wetter, Flugsicherung
        verspaetung = {g.id: _verspaetung(g, rnd, gemeinsam) for g in gruppen}
        # Abweichung vom typischen Verkehr (TomTom-Muster): gemeinsamer Tagesfaktor plus
        # eigene Schwankung je Gebiet; Sperrung trifft ein Gebiet [Annahme]
        tag = rnd.lognormvariate(0.0, 0.12)
        stadt = max(0.85, tag * rnd.lognormvariate(0.0, 0.10))
        autobahn = max(0.85, tag * rnd.lognormvariate(0.0, 0.10))
        if rnd.random() < 0.10:
            if rnd.random() < 0.5:
                stadt *= 1.5
            else:
                autobahn *= 1.5
        stau = (stadt + autobahn) / 2
        abgelehnt = frozenset(g.id for g in gruppen
                              if g.gruen_ok and g.gast_waehlt and rnd.random() < ABLEHNUNG_P)
        szen.append(Szenario(verspaetung, round(stau, 3), rnd.random() < REGEN_P, 1.0, abgelehnt,
                             round(stadt, 3), round(autobahn, 3)))
    return szen


def verdichte(szen: list[Szenario], n: int = 20) -> list[Szenario]:
    """Wählt n typische Szenarien über die Bandbreite der Schwere (Quantile)."""
    def schwere(s: Szenario) -> float:
        return statistics.mean(s.verspaetung.values()) + 60 * (s.stau - 1) + (10 if s.regen else 0)
    geordnet = sorted(szen, key=schwere)
    schritt = len(geordnet) / n
    return [dataclasses.replace(s, gewicht=1 / n)
            for s in (geordnet[int((i + 0.5) * schritt)] for i in range(n))]


def _gruen_dauer(o, k: Kandidaten, tour) -> int:
    return o.dauer


def _gruen_ankunft(o, g: Gruppe, s: "Szenario", tour, zub_ende: float | None) -> float:
    """Ankunft bei Rad/ÖPNV im Szenario; bei Regen holt ein Ersatzfahrzeug ab."""
    weiter = (g.bereit_ab + max(0, s.verspaetung[g.id])) if o.zubringer is None else zub_ende + UMSTIEG_MIN
    if (o.modus == "rad" and s.regen) or g.id in s.abgelehnt:
        von = g.start if o.zubringer is None else tour[o.zubringer].ende
        return weiter + REGEN_ERSATZ_WARTEN_MIN + fahrzeit_min(von, g.ziel) * s.f(von, g.ziel)
    return weiter + o.dauer


def tourzeiten(gruppen: list[Gruppe], k: Kandidaten, s: Szenario) -> dict[int, tuple[float, float]]:
    """Start und Ende je Tour im Szenario, ohne Verkettung (erste Näherung)."""
    gd = {g.id: g for g in gruppen}
    tour = {t.id: t for t in k.touren}
    zeiten = {}
    for t in sorted(k.touren, key=lambda t: t.art in ("letzte_km", "gepaeck")):
        dauer = (t.ende_zeit - t.start_zeit) * s.f(t.start, t.ende)
        if t.zubringer is None:
            bereit = max(gd[g].bereit_ab + s.verspaetung[g] for g in t.gruppen)
        else:
            bereit = zeiten[t.zubringer][1] + UMSTIEG_MIN
        start = max(t.start_zeit, bereit)
        zeiten[t.id] = (start, start + dauer)
    return zeiten


def ankunft_gruppen(t, start: float, stau: float) -> dict[int, float]:
    return {g: start + (plan - t.start_zeit) * stau for g, plan in (t.ankunft_gruppe or {}).items()}


def erwartete_strafen(gruppen, k: Kandidaten, szen: list[Szenario]):
    """Erwartete Zusatzkosten (ct) je Tour, je grüner Option und eine Funktion je Bogen."""
    gd = {g.id: g for g in gruppen}
    tour = {t.id: t for t in k.touren}
    zeiten = [tourzeiten(gruppen, k, s) for s in szen]
    tour_strafe = defaultdict(float)
    for s, z in zip(szen, zeiten):
        for t in k.touren:
            for gid, an in ankunft_gruppen(t, z[t.id][0], s.f(t.start, t.ende)).items():
                tour_strafe[t.id] += s.gewicht * max(0, an - frist(gd[gid], s)) * VERSPAETUNG_CT_MIN
    gruen_strafe = defaultdict(float)
    for s, z in zip(szen, zeiten):
        for o in k.gruen:
            zub_ende = z[o.zubringer][1] if o.zubringer is not None else None
            an = _gruen_ankunft(o, gd[o.gruppe], s, tour, zub_ende)
            ersatz = 4000 if ((o.modus == "rad" and s.regen) or o.gruppe in s.abgelehnt) else 0   # Ersatzfahrt [Annahme]
            gruen_strafe[o.id] += s.gewicht * (ersatz + max(0, an - frist(gd[o.gruppe], s)) * VERSPAETUNG_CT_MIN)

    def bogen_strafe(von: int, nach: int, leer_min: int) -> float:
        """Erwartete Verspätung, weil das Fahrzeug von der vorherigen Fahrt zu spät kommt."""
        n_gr = len(tour[nach].gruppen) if tour[nach].art != "gepaeck" else 0
        e = 0.0
        for s, z in zip(szen, zeiten):
            frei = z[von][1] + leer_min * s.f(tour[von].ende, tour[nach].start)
            e += s.gewicht * max(0, frei - z[nach][0]) * n_gr
        return e * VERSPAETUNG_CT_MIN

    return tour_strafe, gruen_strafe, bogen_strafe


def bewerte(gruppen, k: Kandidaten, erg, szen: list[Szenario]) -> dict:
    """Simuliert den festen Plan über viele Szenarien inkl. Weitergabe von
    Verspätungen entlang der Fahrzeugketten. Keine Umplanung (konservativ)."""
    gd = {g.id: g for g in gruppen}
    tour = {t.id: t for t in k.touren}
    vorg = {b.nach: b.von for b in erg["boegen"] if b.nach is not None and b.von is not None}
    gewaehlt = sorted(erg["gewaehlt"], key=lambda tid: tour[tid].start_zeit)
    gruen = {(o.zubringer, o.gruppe): o for o in erg["gruen"]}
    spaete_gruppen, spaet_min, ein_spaeter, ersatz = [], [], 0, 0
    for s in szen:
        z = {}
        verspaetet = {}
        for tid in gewaehlt:
            t = tour[tid]
            if t.zubringer is None:
                bereit = max(gd[g].bereit_ab + s.verspaetung[g] for g in t.gruppen)
            else:
                bereit = z[t.zubringer][1] + UMSTIEG_MIN
            if tid in vorg and tid not in erg["fremd"]:
                v = tour[vorg[tid]]
                bereit = max(bereit, z[v.id][1] + fahrzeit_min(v.ende, t.start) * s.f(v.ende, t.start))
            start = max(t.start_zeit, bereit)
            z[tid] = (start, start + (t.ende_zeit - t.start_zeit) * s.f(t.start, t.ende))
            if t.art != "gepaeck":
                for gid, an in ankunft_gruppen(t, start, s.f(t.start, t.ende)).items():
                    verspaetet[gid] = max(0, an - frist(gd[gid], s))
        for (zub, gid), o in gruen.items():
            an = _gruen_ankunft(o, gd[gid], s, tour, z[zub][1] if zub is not None else None)
            ersatz += 1 if ((o.modus == "rad" and s.regen) or gid in s.abgelehnt) else 0
            verspaetet[gid] = max(0, an - frist(gd[gid], s))
        spaet = [v for v in verspaetet.values() if v > SPAET_SCHWELLE_MIN]
        spaete_gruppen.append(len(spaet))
        spaet_min.append(sum(spaet))
        ein_spaeter += 1 if spaet else 0
    n = len(szen)
    q = sorted(spaet_min)
    return {
        "szenarien": n,
        "anteil_tage_mit_verspaetung": round(ein_spaeter / n, 3),
        "verspaetete_gruppen_mittel": round(statistics.mean(spaete_gruppen), 2),
        "anteil_gruppen_puenktlich": round(1 - statistics.mean(spaete_gruppen) / len(gruppen), 3),
        "verspaetungsminuten_mittel": round(statistics.mean(spaet_min), 1),
        "verspaetungsminuten_p95": round(q[int(0.95 * n) - 1], 1),
        "regen_ersatzfahrten_mittel": round(ersatz / n, 2),
    }


def bewerte_rollierend(gruppen, k: Kandidaten, erg, szen: list[Szenario]) -> dict:
    """Wie bewerte(), aber mit Nachsteuern am Einsatztag: Reisewege bleiben wie
    geplant, die Zuordnung zu Fahrzeugen wird Fahrt für Fahrt in der Reihenfolge
    der tatsächlichen Bereitschaft neu entschieden ("Fahrten tauschen statt warten").
    Gleiche Flottengröße je Klasse wie im Plan, Partnerfahrten bleiben beim Partner."""
    import heapq
    gd = {g.id: g for g in gruppen}
    tour = {t.id: t for t in k.touren}
    gewaehlt = set(erg["gewaehlt"])
    kinder = defaultdict(list)
    for tid in gewaehlt:
        if tour[tid].zubringer is not None:
            kinder[tour[tid].zubringer].append(tid)
    flotte = defaultdict(int)
    for b in erg["boegen"]:
        if b.von is None:
            flotte[tour[b.nach].klasse.name] += 1
    gruen = {(o.zubringer, o.gruppe): o for o in erg["gruen"]}
    spaete_gruppen, spaet_min, ein_spaeter, leer_km = [], [], 0, []
    je_stunde = defaultdict(float)
    import daten
    from daten import strassen_km
    for s in szen:
        fahrzeuge = {kl: [[0.0, BETRIEBSSITZ] for _ in range(n)] for kl, n in flotte.items()}
        offen = []
        for tid in gewaehlt:
            t = tour[tid]
            if t.zubringer is None:
                bereit = max(t.start_zeit if t.art == "sammel_direkt" and len(set(gd[g].start for g in t.gruppen)) > 1
                             else 0, max(gd[g].bereit_ab + s.verspaetung[g] for g in t.gruppen))
                heapq.heappush(offen, (bereit, tid))
        ende, verspaetet, km_leer = {}, {}, 0.0
        while offen:
            bereit, tid = heapq.heappop(offen)
            t = tour[tid]
            if tid in erg["fremd"] or not fahrzeuge.get(t.klasse.name):
                start = bereit
            else:
                beste = None
                for f in fahrzeuge[t.klasse.name]:
                    an = f[0] + fahrzeit_min(f[1], t.start) * s.f(f[1], t.start)
                    kandidat = (max(0, an - bereit), strassen_km(f[1], t.start), f)
                    if beste is None or kandidat[:2] < beste[:2]:
                        beste = kandidat
                start = bereit + beste[0]
                km_leer += beste[1]
            fertig = start + (t.ende_zeit - t.start_zeit) * s.f(t.start, t.ende)
            if tid not in erg["fremd"] and fahrzeuge.get(t.klasse.name):
                beste[2][0], beste[2][1] = fertig, t.ende
            ende[tid] = fertig
            if t.art != "gepaeck":
                for gid, an in ankunft_gruppen(t, start, s.f(t.start, t.ende)).items():
                    verspaetet[gid] = max(0, an - frist(gd[gid], s))
                    je_stunde[int((daten.START_UHR_MIN + t.start_zeit) // 60) % 24] += verspaetet[gid]
            for kid in kinder[tid]:
                heapq.heappush(offen, (fertig + UMSTIEG_MIN, kid))
        for (zub, gid), o in gruen.items():
            an = _gruen_ankunft(o, gd[gid], s, tour, ende[zub] if zub is not None else None)
            verspaetet[gid] = max(0, an - frist(gd[gid], s))
        spaet = [v for v in verspaetet.values() if v > SPAET_SCHWELLE_MIN]
        spaete_gruppen.append(len(spaet))
        spaet_min.append(sum(spaet))
        ein_spaeter += 1 if spaet else 0
        leer_km.append(km_leer)
    n = len(szen)
    q = sorted(spaet_min)
    return {
        "szenarien": n,
        "anteil_tage_mit_verspaetung": round(ein_spaeter / n, 3),
        "verspaetete_gruppen_mittel": round(statistics.mean(spaete_gruppen), 2),
        "anteil_gruppen_puenktlich": round(1 - statistics.mean(spaete_gruppen) / len(gruppen), 3),
        "verspaetungsminuten_mittel": round(statistics.mean(spaet_min), 1),
        "verspaetungsminuten_p95": round(q[int(0.95 * n) - 1], 1),
        "leer_km_nachgesteuert_mittel": round(statistics.mean(leer_km)),
        "engpass_stunde": max(je_stunde, key=je_stunde.get) if any(je_stunde.values()) else None,
    }


def bogen_pruefer(gruppen, k: Kandidaten, szen: list[Szenario], reserve_min: float = 0.0):
    """Harte Pünktlichkeit (Demo): Ein Anschluss ist nur zulässig, wenn das Fahrzeug in
    jedem typischen Szenario rechtzeitig am nächsten Abholort ist, mit reserve_min Luft."""
    tour = {t.id: t for t in k.touren}
    zeiten = [tourzeiten(gruppen, k, s) for s in szen]

    def ok(von: int, nach: int, leer_min: int) -> bool:
        for s, z in zip(szen, zeiten):
            frei = z[von][1] + leer_min * s.f(tour[von].ende, tour[nach].start)
            if frei + reserve_min > z[nach][0] + 0.5:
                return False
        return True

    def reserve(von: int, nach: int, leer_min: int) -> float:
        """Kleinste Luft (min) über alle Szenarien."""
        return min(z[nach][0] - (z[von][1] + leer_min * s.f(tour[von].ende, tour[nach].start))
                   for s, z in zip(szen, zeiten))

    return ok, reserve


def bogen_pruefer_quantil(gruppen, k: Kandidaten, szen: list[Szenario], q: float = 0.975,
                          reserve_min: float = 0.0):
    """Harte Pünktlichkeit über viele Verläufe: Ende der vorigen Fahrt und Leerfahrt im
    q-Quantil (je Fahrt), dann muss das Fahrzeug spätestens zur geplanten Abholzeit da sein."""
    tour = {t.id: t for t in k.touren}
    enden = defaultdict(list)
    stau = defaultdict(list)
    for s in szen:
        z = tourzeiten(gruppen, k, s)
        for t in k.touren:
            enden[t.id].append(z[t.id][1])
        stau["stadt"].append(s.stau_stadt or s.stau)
        stau["autobahn"].append(s.stau_autobahn or s.stau)
    def quant(werte):
        w = sorted(werte)
        return w[min(len(w) - 1, int(q * len(w)))]
    ende_q = {tid: quant(v) for tid, v in enden.items()}
    f_stadt, f_ab = quant(stau["stadt"]), quant(stau["autobahn"])

    def f(a, b):
        w = anteil_innen(a, b)
        return w * f_stadt + (1 - w) * f_ab

    def luft(von: int, nach: int, leer_min: int) -> float:
        return tour[nach].start_zeit - (ende_q[von] + leer_min * f(tour[von].ende, tour[nach].start))

    def ok(von: int, nach: int, leer_min: int) -> bool:
        return luft(von, nach, leer_min) >= reserve_min - 0.5

    return ok, luft
