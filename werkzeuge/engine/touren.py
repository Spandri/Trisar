"""Erzeugt Kandidaten-Fahrten (Touren) und Optionen für den letzten Abschnitt.

Eine Tour ist ein beladener Fahrzeugabschnitt mit festem Start, Ende und Zeit.
Leerfahrten zwischen Touren entstehen erst im Modell (Fahrzeugketten).
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass, field

from daten import (ANKUNFTSORTE, KNOTEN, LIMO_E, SUV_E, UMSTIEG_MIN, VAN_D,
                   Fahrzeugklasse, Knoten, Ort, fahrzeit_min, klassen_fuer, klassen_fuer_gruppe, oepnv_min,
                   oepnv_min_ab_ort, rad_min, rad_min_ab_ort, strassen_km)
from instanz import Gruppe

FENSTER_SCHRITT_MIN = 15   # Raster, in dem die Engine eine Abholzeit im Abholfenster wählt
SAMMEL_FENSTER_MIN = 20     # Gruppen, die so dicht nacheinander landen, können zusammen fahren
MAX_GRUPPEN_JE_SAMMELFAHRT = 3
KNOTEN_JE_SAMMELFAHRT = 3   # nur die passendsten Umsteigepunkte je Sammelfahrt
GEPAECK_PUFFER_MIN = 60     # Gepäck darf so viel später als der Gast ankommen


@dataclass
class Tour:
    id: int
    art: str                    # direkt | sammel_direkt | sammel_knoten | letzte_km | gepaeck
    klasse: Fahrzeugklasse
    start: Ort
    start_zeit: int
    ende: Ort
    ende_zeit: int
    km: float
    gruppen: tuple[int, ...]
    knoten: Knoten | None = None
    zubringer: int | None = None   # bei letzte_km/gepaeck: zugehörige Sammelfahrt
    ankunft_gruppe: dict | None = None   # geplante Ankunft je beförderter Gruppe


@dataclass
class GruenOption:
    id: int
    gruppe: int
    zubringer: int | None       # None = ganzer Weg ohne Auto (z. B. Hotel -> Veranstaltung)
    modus: str                  # rad | oepnv
    ankunft: int
    dauer: int = 0              # Minuten ab Umsteigepunkt bzw. ab Bereitschaft


@dataclass
class Kandidaten:
    touren: list[Tour] = field(default_factory=list)
    gruen: list[GruenOption] = field(default_factory=list)


def _passt(klasse: Fahrzeugklasse, gs: list[Gruppe]) -> bool:
    return (sum(g.personen for g in gs) <= klasse.plaetze
            and sum(g.gepaeck for g in gs) <= klasse.gepaeck)


def _mehrfachstopp(start: Ort, t0: int, gs: list[Gruppe]):
    """Nächster-Nachbar-Reihenfolge; liefert km, Ende, Endzeit, Ankünfte."""
    offen, ort, t, km, ankunft = list(gs), start, t0, 0.0, {}
    while offen:
        g = min(offen, key=lambda x: strassen_km(ort, x.ziel))
        km += strassen_km(ort, g.ziel)
        t += fahrzeit_min(ort, g.ziel, uhrzeit=t) + (2 if ankunft else 0)
        ankunft[g.id] = t
        ort = g.ziel
        offen.remove(g)
    return km, ort, t, ankunft


def erzeuge(gruppen: list[Gruppe], mit_sammeln: bool = True,
            mit_knoten: bool = True, premium: bool = False) -> Kandidaten:
    """premium: Servicestandard "Einzelfahrt bis zur Tür". Gäste verschiedener
    Gruppen teilen sich höchstens die lange Strecke bis zum Umsteigepunkt."""
    k = Kandidaten()
    nid = itertools.count()

    def neu(**kw) -> Tour:
        t = Tour(id=next(nid), **kw)
        k.touren.append(t)
        return t

    # 1. Direktfahrten je Gruppe, kleinste passende Fahrzeuggröße
    for g in gruppen:
        # Abholfenster: Engine darf die Abholzeit im Fenster wählen (Varianten im FENSTER_SCHRITT_MIN-Raster)
        starts = [g.bereit_ab + v for v in range(0, g.abholfenster + 1, FENSTER_SCHRITT_MIN)] or [g.ankunft]
        for t0 in starts:
            ende = t0 + fahrzeit_min(g.start, g.ziel, uhrzeit=t0)
            if t0 != g.ankunft and ende > g.spaetestens:
                continue
            for kl in klassen_fuer_gruppe(g.personen, g.gepaeck):
                neu(art="direkt", klasse=kl, start=g.start, start_zeit=t0,
                    ende=g.ziel, ende_zeit=max(ende, t0 + 1), km=strassen_km(g.start, g.ziel),
                    gruppen=(g.id,), ankunft_gruppe={g.id: ende})
    if not mit_sammeln:
        return k

    # 1b. Ganzer Weg ohne Auto: Standardgäste ohne Gepäck, z. B. Hotel -> Veranstaltung
    for g in gruppen:
        if g.gruen_ok and not g.premium and not g.gepaeck and g.start.name not in ANKUNFTSORTE:
            for modus, dauer in (("rad", rad_min_ab_ort(g.start, g.ziel)),
                                 ("oepnv", oepnv_min_ab_ort(g.start, g.ziel, g.ankunft))):
                if modus in g.erlaubt and dauer is not None and g.ankunft + dauer <= g.spaetestens:
                    k.gruen.append(GruenOption(len(k.gruen), g.id, None, modus, g.ankunft + dauer, dauer))

    # 2. Sammelfahrten im Großraumfahrzeug (nur Gäste ohne Premium-Anspruch;
    #    Premium-Gäste teilen höchstens die lange Strecke bis zum Umsteigepunkt)
    for i, anker in enumerate(gruppen):
        partner = [g for g in gruppen[i + 1:]
                   if g.ankunft - anker.ankunft <= max(SAMMEL_FENSTER_MIN, anker.abholfenster)
                   and (g.start == anker.start or g.ziel == anker.ziel)]
        for r in range(1, MAX_GRUPPEN_JE_SAMMELFAHRT):
            for rest in itertools.combinations(partner, r):
                gs = [anker, *rest]
                klassen = klassen_fuer(sum(g.personen for g in gs), sum(g.gepaeck for g in gs))
                if not klassen:
                    continue
                bis_tuer = not premium and not any(g.premium or "sammeln" not in g.erlaubt for g in gs)
                if all(g.start == anker.start for g in gs):
                    for ab in _sammel_starts(gs):
                        # 2a. ein Abholort, mehrere Zielstopps
                        km, ende, t_ende, ank = _mehrfachstopp(anker.start, ab, gs)
                        if bis_tuer and all(ank[g.id] <= g.spaetestens for g in gs):
                            for kl in klassen:
                                neu(art="sammel_direkt", klasse=kl, start=anker.start, start_zeit=ab,
                                    ende=ende, ende_zeit=t_ende, km=km, gruppen=tuple(g.id for g in gs),
                                    ankunft_gruppe=ank)
                        if mit_knoten and anker.start.name in ANKUNFTSORTE \
                                and all("umstieg" in g.erlaubt for g in gs):
                            _sammel_knoten(gs, ab, neu, k, klassen)
                elif bis_tuer and all(g.ziel == anker.ziel for g in gs):
                    # 2c. mehrere Abholorte, ein Ziel (z. B. Hotels -> Veranstaltung)
                    erg = _mehrfachabholung(gs)
                    if erg:
                        km, start, t_start, t_ende = erg
                        for kl in klassen:
                            neu(art="sammel_direkt", klasse=kl, start=start, start_zeit=t_start,
                                ende=anker.ziel, ende_zeit=t_ende, km=km,
                                gruppen=tuple(g.id for g in gs),
                                ankunft_gruppe={g.id: t_ende for g in gs})
    return k


SAMMEL_IM_RASTER = True   # False: Sammelfahrten nur zur Wunschzeit und frühestmöglich


def _sammel_starts(gs: list[Gruppe]) -> list[int]:
    """Startzeiten einer Sammelfahrt: immer die Wunschzeit (späteste Bereitschaft der Gruppen),
    bei Abholfenstern zusätzlich jede Zeit im FENSTER_SCHRITT_MIN-Raster, die im Fenster
    aller beteiligten Gruppen liegt."""
    wunsch = max(g.ankunft for g in gs)
    frueh = max(g.bereit_ab for g in gs)
    if frueh == wunsch and not any(g.abholfenster for g in gs):
        return [wunsch]
    if not SAMMEL_IM_RASTER:
        return list(dict.fromkeys([wunsch, frueh]))
    spaet = min(g.bereit_ab + g.abholfenster if g.abholfenster else g.ankunft for g in gs)
    raster = list(range(frueh, spaet + 1, FENSTER_SCHRITT_MIN))
    return list(dict.fromkeys([wunsch, *raster]))


def _mehrfachabholung(gs: list[Gruppe]):
    """Abholung in Reihenfolge der Bereitschaft, gemeinsames Ziel."""
    folge = sorted(gs, key=lambda g: g.ankunft)
    ort, t, km = folge[0].start, folge[0].ankunft, 0.0
    for g in folge[1:]:
        km += strassen_km(ort, g.start)
        t = max(t + fahrzeit_min(ort, g.start, uhrzeit=t) + (2 if g.start != ort else 0), g.ankunft)
        ort = g.start
    km += strassen_km(ort, folge[0].ziel)
    t_ende = t + fahrzeit_min(ort, folge[0].ziel, uhrzeit=t)
    if all(t_ende <= g.spaetestens for g in gs):
        return km, folge[0].start, folge[0].ankunft, t_ende
    return None


def _sammel_knoten(gs: list[Gruppe], ab: int, neu, k: Kandidaten,
                   klassen: list[Fahrzeugklasse]) -> None:
    """2b. Sammelfahrt bis Umsteigepunkt, dann je Gruppe Limousine, Rad oder ÖPNV."""
    # Vorauswahl (Korridor): Umsteigepunkte mit kürzester Gesamtzeit Flughafen → Knoten → Ziele
    knoten = sorted(KNOTEN, key=lambda kn: fahrzeit_min(gs[0].start, kn.ort)
                    + sum(fahrzeit_min(kn.ort, g.ziel) for g in gs) / len(gs))
    for kn in knoten[:KNOTEN_JE_SAMMELFAHRT]:
        an = ab + fahrzeit_min(gs[0].start, kn.ort, uhrzeit=ab)
        weiter = an + UMSTIEG_MIN
        optionen_je_gruppe = []
        for g in gs:
            opt = []
            fz = fahrzeit_min(kn.ort, g.ziel, uhrzeit=weiter)
            if weiter + fz <= g.spaetestens:
                opt.append(("auto", weiter + fz))
            if g.gruen_ok:
                for modus, dauer in (("rad", rad_min(kn, g.ziel)), ("oepnv", oepnv_min(kn, g.ziel, weiter))):
                    if modus in g.erlaubt and dauer is not None and weiter + dauer <= g.spaetestens:
                        opt.append((modus, weiter + dauer))
            if not opt:
                break
            optionen_je_gruppe.append((g, opt))
        else:
            zub = neu(art="sammel_knoten", klasse=klassen[0], start=gs[0].start, start_zeit=ab,
                      ende=kn.ort, ende_zeit=an, km=strassen_km(gs[0].start, kn.ort),
                      gruppen=tuple(g.id for g in gs), knoten=kn)
            for g, opt in optionen_je_gruppe:
                for modus, ankunft in opt:
                    if modus == "auto":
                        for kl in klassen_fuer(g.personen, g.gepaeck):
                            if True:
                                neu(art="letzte_km", klasse=kl, start=kn.ort, start_zeit=weiter,
                                    ende=g.ziel, ende_zeit=ankunft,
                                    km=strassen_km(kn.ort, g.ziel), gruppen=(g.id,),
                                    knoten=kn, zubringer=zub.id, ankunft_gruppe={g.id: ankunft})
                    else:
                        k.gruen.append(GruenOption(len(k.gruen), g.id, zub.id, modus, ankunft,
                                                   ankunft - weiter))
            # Gepäck der Gruppen, die Rad/ÖPNV nehmen könnten: gebündelt mit Mehrfachstopp
            mit_gepaeck = [g for g, opt in optionen_je_gruppe
                           if g.gepaeck and any(m != "auto" for m, _ in opt)]
            for r in range(1, len(mit_gepaeck) + 1):
                for teil in itertools.combinations(mit_gepaeck, r):
                    km, ende, t_ende, _ = _mehrfachstopp(kn.ort, weiter, list(teil))
                    for kl in (LIMO_E, SUV_E, VAN_D):
                        if sum(g.gepaeck for g in teil) <= kl.gepaeck:
                            neu(art="gepaeck", klasse=kl, start=kn.ort, start_zeit=weiter,
                                ende=ende, ende_zeit=t_ende, km=km,
                                gruppen=tuple(g.id for g in teil), knoten=kn, zubringer=zub.id)
