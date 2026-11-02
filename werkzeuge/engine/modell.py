"""CP-SAT-Modell der TRISAR-ENGINE (Prototyp, deterministischer Tagesverlauf).

Entscheidet gemeinsam: Reiseweg je Gruppe (direkt, Sammelfahrt, Sammelfahrt
bis Umsteigepunkt + Limousine/Rad/ÖPNV), Gepäckfahrten und die Verkettung
aller Fahrten zu Fahrzeugeinsätzen je Fahrzeugklasse. Zielfunktion in Cent:
Fahrzeug-Fixkosten + km-Kosten + Fahrerzeit + CO2 zum Schattenpreis.

Modus "nacheinander" trifft dieselben Entscheidungen in zwei Stufen
(erst Reisewege nach Fahrtkosten, dann Fahrzeugketten), als Vergleichsbasis.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from ortools.sat.python import cp_model

import daten
from daten import (ANKUNFTSORTE, BETRIEBSSITZ, FAHRER_CT_MIN, KLASSEN,
                   PARTNER_AKTIV, PAUSENREGEL, VORLAUF_PREMIUM_MIN, VORLAUF_STANDARD_MIN,
                   LADE_KM_JE_MIN, LADE_MIN_WARTEN, MAX_OHNE_PAUSE_MIN, PAUSE_MIN,
                   RABATT_ANTEIL, REGEL_DIENST_MIN, UEBERSTUNDE_CT_MIN, VIP_FAHRER,
                   netz_co2_g_kwh,
                   partner_co2_g_km,
                   OEPNV_CT_PERSON, RAD_CT, fahrzeit_min, strassen_km)
from instanz import Gruppe
from touren import Kandidaten, Tour

MAX_WARTEN_MIN = 120   # längste Wartezeit zwischen zwei Fahrten eines Fahrzeugs
KORRIDOR_K = 12        # je Fahrt nur die K günstigsten Anschlussfahrten (Korridor)
OEPNV_CO2_G_PERSON_KM = 55   # [prüfen, UBA]
FREMD_AUFSCHLAG = 1.5        # Partnerflotte: Fahrt inkl. An-/Abfahrt zum 1,5-fachen [Annahme]


BEGINN_VARS: dict = {}
SOC_VARS: dict = {}
LADE_VARS: dict = {}
SOLVER_SEED: int | None = None   # Zufallsstartwert des Optimierers (Wiederholungen)

def fremd_km(t: Tour) -> float:
    """Leer-km der Partnerflotte, angenommen ab gleichem Standort wie eigener Betrieb."""
    return strassen_km(BETRIEBSSITZ, t.start) + strassen_km(t.ende, BETRIEBSSITZ)


def fremd_kosten_ct(t: Tour) -> int:
    """Partner rechnet Betriebskosten mit Aufschlag ab; CO2 nach Partner-Antriebsmix."""
    km = t.km + fremd_km(t)
    minuten = (t.ende_zeit - t.start_zeit) + fahrzeit_min(BETRIEBSSITZ, t.start) \
        + fahrzeit_min(t.ende, BETRIEBSSITZ)
    betrieb = km * t.klasse.kosten_ct_km + minuten * FAHRER_CT_MIN + t.klasse.fix_ct
    co2 = km * partner_co2_g_km(t.klasse) / 1000 * daten.CO2_PREIS_CT_KG
    return round(FREMD_AUFSCHLAG * betrieb + co2)


def _km_kosten_ct(klasse, km: float) -> int:
    return round(km * (klasse.kosten_ct_km + klasse.co2_g_km / 1000 * daten.CO2_PREIS_CT_KG))


def tour_kosten_ct(t: Tour) -> int:
    return _km_kosten_ct(t.klasse, t.km) + (t.ende_zeit - t.start_zeit) * FAHRER_CT_MIN


@dataclass
class Bogen:
    von: int | None      # None = Betriebssitz
    nach: int | None
    km: float
    kosten_ct: int        # Zielfunktion: Betrieb + CO2-Preis (+ erwartete Verspätung)
    betrieb_ct: int = 0   # nur Betriebskosten


BOGEN_OK = None   # Demo: Funktion (von, nach, leer_min) -> bool, Pünktlichkeit in allen Szenarien


def _boegen(touren: list[Tour], klasse, bogen_strafe=None, puffer_min: int = 0,
            vorlauf: dict | None = None, pflicht: set | None = None) -> list[Bogen]:
    """puffer_min: heutige Praxis, Fahrzeug muss so viele Minuten vor einer
    Abholung am Ankunftsort frei sein (Reserve für Verspätungen)."""
    ts = [t for t in touren if t.klasse is klasse]
    tour_je = {t.id: t for t in ts}
    boegen = []
    for t in ts:
        km_hin = strassen_km(BETRIEBSSITZ, t.start)
        zeit_hin = klasse.fix_ct + fahrzeit_min(BETRIEBSSITZ, t.start, uhrzeit=t.start_zeit - 40) * FAHRER_CT_MIN
        boegen.append(Bogen(None, t.id, km_hin, zeit_hin + _km_kosten_ct(klasse, km_hin),
                            zeit_hin + round(km_hin * klasse.kosten_ct_km)))
        km_zur = strassen_km(t.ende, BETRIEBSSITZ)
        zeit_zur = fahrzeit_min(t.ende, BETRIEBSSITZ, uhrzeit=t.ende_zeit) * FAHRER_CT_MIN
        boegen.append(Bogen(t.id, None, km_zur, zeit_zur + _km_kosten_ct(klasse, km_zur),
                            zeit_zur + round(km_zur * klasse.kosten_ct_km)))
        nachfolger = []
        for u in ts:
            if u.id == t.id or u.start_zeit < t.ende_zeit:
                continue
            leer_min = fahrzeit_min(t.ende, u.start, uhrzeit=t.ende_zeit)
            warten = u.start_zeit - t.ende_zeit - leer_min
            if BOGEN_OK is not None and u.start_zeit - t.ende_zeit <= MAX_WARTEN_MIN + 60 \
                    and not BOGEN_OK(t.id, u.id, leer_min):
                continue
            # wie Web-App (AIRPORT_POST_DELAY_MINUTES): Reserve nach Abholung am Flughafen/Bahnhof
            mindest = puffer_min if t.start.name in ANKUNFTSORTE and t.zubringer is None else 0
            mindest = max(mindest, (vorlauf or {}).get(u.id, 0))   # Bereitstellung vor Abholung
            if mindest <= warten <= MAX_WARTEN_MIN:
                km = strassen_km(t.ende, u.start)
                zeit = (leer_min + warten) * FAHRER_CT_MIN
                nachfolger.append(Bogen(t.id, u.id, km, zeit + _km_kosten_ct(klasse, km),
                                        zeit + round(km * klasse.kosten_ct_km)))
        nachfolger.sort(key=lambda b: b.kosten_ct)
        # Anschlüsse der Startlösung bleiben unabhängig vom Korridor erhalten
        nachfolger = nachfolger[:KORRIDOR_K] + [b for b in nachfolger[KORRIDOR_K:]
                                                if pflicht and (b.von, b.nach) in pflicht]
        if bogen_strafe is not None:
            for b in nachfolger:
                b.kosten_ct += round(bogen_strafe(b.von, b.nach, fahrzeit_min(t.ende, tour_je[b.nach].start, uhrzeit=t.ende_zeit)))
        boegen.extend(nachfolger)
    return boegen


def _ketten_regeln(m, kl, ts: list[Tour], boegen, gdict, kosten, vip_starts) -> None:
    """Regeln entlang jeder Fahrzeugkette (= Dienst einer Fahrerin/eines Fahrers; Beginn und Ende
    frei, keine festen Schichten):
    - Dienstdauer höchstens MAX_DIENST_MIN, Überstunden über REGEL_DIENST_MIN kosten Zuschlag
    - Pause nach 6 h nur wenn PAUSENREGEL (Teamentscheidung: aus, Pausen aus Wartezeiten)
    - VIP-Fahrten nur in Ketten mit VIP-qualifizierter Fahrerin/Fahrer, deren Zahl ist begrenzt
    - E-Fahrzeuge: Ladestand je Fahrzeug, Laden in Wartezeiten, bevorzugt in Stunden mit wenig CO2 im Netz
    """
    beginn = {t.id: m.NewIntVar(-600, 3000, "") for t in ts}
    starts_kl = []   # ein Fahrzeug = ein Dienst je Tag (Teamvorgabe)
    arbeit = {t.id: m.NewIntVar(0, MAX_OHNE_PAUSE_MIN, "") for t in ts} if PAUSENREGEL else {}
    vip = {t.id: m.NewBoolVar("") for t in ts}
    R = kl.reichweite_km
    soc = {t.id: m.NewIntVar(0, R, "") for t in ts} if kl.elektrisch else {}
    BEGINN_VARS.update(beginn)
    SOC_VARS.update(soc)
    tour = {t.id: t for t in ts}
    for t in ts:
        if t.art != "gepaeck" and any(gdict[g].premium for g in t.gruppen):
            m.Add(vip[t.id] == 1)
    for v, b in boegen:
        if b.von is None:
            t = tour[b.nach]
            anfahrt = fahrzeit_min(BETRIEBSSITZ, t.start, uhrzeit=t.start_zeit - 40)
            m.Add(beginn[t.id] == t.start_zeit - anfahrt).OnlyEnforceIf(v)
            if arbeit:
                m.Add(arbeit[t.id] == anfahrt + t.ende_zeit - t.start_zeit).OnlyEnforceIf(v)
            starts_kl.append(v)
            z = m.NewBoolVar("")
            m.AddBoolAnd([v, vip[t.id]]).OnlyEnforceIf(z)
            m.AddBoolOr([v.Not(), vip[t.id].Not()]).OnlyEnforceIf(z.Not())
            vip_starts.append(z)
            if soc:
                m.Add(soc[t.id] == R - round(b.km) - round(t.km)).OnlyEnforceIf(v)
        elif b.nach is None:
            t = tour[b.von]
            schluss = t.ende_zeit + fahrzeit_min(t.ende, BETRIEBSSITZ, uhrzeit=t.ende_zeit)
            m.Add(schluss - beginn[t.id] <= daten.MAX_DIENST_MIN).OnlyEnforceIf(v)
            ueber = m.NewIntVar(0, daten.MAX_DIENST_MIN, "")
            m.Add(ueber >= schluss - beginn[t.id] - REGEL_DIENST_MIN).OnlyEnforceIf(v)
            kosten.append(UEBERSTUNDE_CT_MIN * ueber)
            if soc:
                m.Add(soc[t.id] >= round(b.km)).OnlyEnforceIf(v)
        else:
            t, u = tour[b.von], tour[b.nach]
            leer = fahrzeit_min(t.ende, u.start, uhrzeit=t.ende_zeit)
            warten = u.start_zeit - t.ende_zeit - leer
            dauer_u = u.ende_zeit - u.start_zeit
            m.Add(beginn[u.id] == beginn[t.id]).OnlyEnforceIf(v)
            m.Add(vip[u.id] == vip[t.id]).OnlyEnforceIf(v)
            if arbeit and warten >= PAUSE_MIN:
                m.Add(arbeit[u.id] == dauer_u).OnlyEnforceIf(v)
            elif arbeit:
                m.Add(arbeit[u.id] == arbeit[t.id] + leer + warten + dauer_u).OnlyEnforceIf(v)
            if soc:
                max_lade = min(R, LADE_KM_JE_MIN * warten) if warten >= LADE_MIN_WARTEN else 0
                lade = m.NewIntVar(0, max_lade, "")
                LADE_VARS[(t.id, u.id)] = lade
                m.Add(soc[u.id] == soc[t.id] - round(b.km) - round(u.km) + lade).OnlyEnforceIf(v)
                m.Add(lade == 0).OnlyEnforceIf(v.Not())
                if max_lade:
                    # Laden zu Zeiten mit wenig CO2 im Netz wird belohnt, zu Spitzenzeiten bestraft
                    abweichung = (netz_co2_g_kwh(t.ende_zeit) - 363) / 363
                    kosten.append(round(abweichung * kl.co2_g_km / 1000 * daten.CO2_PREIS_CT_KG) * lade)   # Demo: ohne Faktor 10, sonst lohnen Umwege zum Laden
    if not daten.FLOTTE_UNBEGRENZT:
        m.Add(sum(starts_kl) <= kl.anzahl)


def vorlauf_je_tour(k: Kandidaten, gdict) -> dict[int, int]:
    """Bereitstellung vor der Abholung: Fahrzeug muss so viele Minuten vorher am Abholort sein."""
    v = {}
    for t in k.touren:
        if t.art == "gepaeck":
            continue
        v[t.id] = VORLAUF_PREMIUM_MIN if any(gdict[g].premium for g in t.gruppen) else VORLAUF_STANDARD_MIN
    return v


def rabatt_ct(o, gruppen: dict[int, Gruppe], k: Kandidaten) -> int:
    """Rabatt für den Gast bei Rad/ÖPNV: Anteil der Einsparung gegenüber der
    günstigsten Direktfahrt (Fahrt plus CO2), wird aus der Einsparung bezahlt."""
    direkt = [tour_kosten_ct(t) for t in k.touren if t.art == "direkt" and t.gruppen == (o.gruppe,)]
    if not direkt:
        return 0
    return round(RABATT_ANTEIL * max(0, min(direkt) - _gruen_kosten_ct(o, gruppen, k)))


def _gruen_kosten_ct(o, gruppen: dict[int, Gruppe], k: Kandidaten) -> int:
    g = gruppen[o.gruppe]
    if o.modus == "rad":
        return RAD_CT
    von = g.start if o.zubringer is None else next(t for t in k.touren if t.id == o.zubringer).ende
    km = strassen_km(von, g.ziel)
    co2_kg = km * OEPNV_CO2_G_PERSON_KM * g.personen / 1000
    return OEPNV_CT_PERSON * g.personen + round(co2_kg * daten.CO2_PREIS_CT_KG)


def loese(gruppen: list[Gruppe], k: Kandidaten, modus: str = "gemeinsam",
          zeitlimit_s: float = 60, protokoll: bool = False, szen=None,
          puffer_min: int = 0, threads: int = 8, korridor: float | None = None,
          start: tuple | None = None) -> dict:
    """szen: verdichtete Szenarien; dann plant das Modell mit erwarteter
    Verspätung über alle Szenarien statt für den Planfall.
    korridor: Anteil der Sammelfahrt-Kandidaten, die der gelernte Korridor behält.
    start: (Kandidaten, Ergebnis) eines früheren Laufs als Startlösung; dessen Fahrten
    bleiben auch nach dem Korridor erhalten."""
    voll = k
    if korridor:
        import korridor as kor
        if kor.GEWICHTE.exists():
            k = kor.duenne_aus(gruppen, k, anteil=korridor)
            if start:
                k = _mit_startfahrten(voll, k, start)
    strafen = None
    if szen:
        import szenarien
        strafen = szenarien.erwartete_strafen(gruppen, k, szen)
    if modus == "nacheinander":
        stufe1 = _modell(gruppen, k, mit_ketten=False, zeitlimit_s=zeitlimit_s / 2, strafen=strafen,
                         threads=threads)
        if stufe1 is None:
            return {"status": "unzulässig"}
        return _modell(gruppen, k, mit_ketten=True, zeitlimit_s=zeitlimit_s / 2,
                       fest=stufe1["gewaehlt"], protokoll=protokoll, strafen=strafen,
                       puffer_min=puffer_min, threads=threads)
    return _modell(gruppen, k, mit_ketten=True, zeitlimit_s=zeitlimit_s, protokoll=protokoll,
                   strafen=strafen, puffer_min=puffer_min, threads=threads, start=start)


def _sig_touren(k: Kandidaten) -> dict[int, tuple]:
    """Laufunabhängige Kennung je Fahrt (Tour-IDs unterscheiden sich zwischen Kandidatenmengen)."""
    tour = {t.id: t for t in k.touren}
    sig = {}
    for t in sorted(k.touren, key=lambda t: t.zubringer is not None):
        sig[t.id] = (t.art, t.klasse.name, t.start.name, t.start_zeit, t.ende.name, t.gruppen,
                     t.knoten.ort.name if t.knoten else None,
                     sig[t.zubringer] if t.zubringer is not None and t.zubringer in sig else t.zubringer)
    return sig


def _sig_gruen(o, sig_t: dict) -> tuple:
    return (o.gruppe, o.modus, sig_t.get(o.zubringer) if o.zubringer is not None else None)


def _mit_startfahrten(voll: Kandidaten, k: Kandidaten, start: tuple) -> Kandidaten:
    k0, erg0 = start
    s0 = _sig_touren(k0)
    gesucht = {s0[tid] for tid in erg0["gewaehlt"]}
    sv = _sig_touren(voll)
    halten = {tid for tid, s in sv.items() if s in gesucht}
    da = {t.id for t in k.touren}
    neu = Kandidaten()
    neu.touren = [t for t in voll.touren if t.id in da or t.id in halten
                  or (t.zubringer is not None and t.zubringer in halten)]
    ids = {t.id for t in neu.touren}
    neu.gruen = [o for o in voll.gruen if o.zubringer is None or o.zubringer in ids]
    return neu


def _start_boegen(k: Kandidaten, start: tuple) -> set[tuple[int, int]]:
    """Anschlüsse (von, nach) der Startlösung, übersetzt in die Tour-IDs dieser Kandidatenmenge."""
    k0, erg0 = start
    s0 = _sig_touren(k0)
    id_je_sig = {s: tid for tid, s in _sig_touren(k).items()}
    return {(id_je_sig.get(s0[b.von]), id_je_sig.get(s0[b.nach])) for b in erg0["boegen"]
            if b.von is not None and b.nach is not None}


def _hinweise(m, k: Kandidaten, x, y, f, bogen_var, start: tuple) -> int:
    """Setzt die Lösung eines früheren Laufs als Startlösung (AddHint). Liefert die Zahl
    der Fahrten der Startlösung, die in dieser Kandidatenmenge fehlen."""
    k0, erg0 = start
    s0, sk = _sig_touren(k0), _sig_touren(k)
    gew = {s0[t] for t in erg0["gewaehlt"]}
    frm = {s0[t] for t in erg0["fremd"]}
    for tid, v in x.items():
        m.AddHint(v, sk[tid] in gew)
        m.AddHint(f[tid], sk[tid] in frm)
    gr = {_sig_gruen(o, s0) for o in erg0["gruen"]}
    for o in k.gruen:
        m.AddHint(y[o.id], _sig_gruen(o, sk) in gr)
    bg = {(s0.get(b.von), s0.get(b.nach)) for b in erg0["boegen"]}
    for (kl, _), (v, b) in bogen_var.items():
        m.AddHint(v, (sk.get(b.von), sk.get(b.nach)) in bg)
    return len(gew - set(sk.values()))


def _modell(gruppen, k: Kandidaten, mit_ketten: bool, zeitlimit_s: float,
            fest: set[int] | None = None, protokoll: bool = False, strafen=None,
            puffer_min: int = 0, threads: int = 8, start: tuple | None = None) -> dict | None:
    gdict = {g.id: g for g in gruppen}
    BEGINN_VARS.clear(); SOC_VARS.clear(); LADE_VARS.clear()
    m = cp_model.CpModel()
    x = {t.id: m.NewBoolVar(f"t{t.id}") for t in k.touren}
    y = {o.id: m.NewBoolVar(f"o{o.id}") for o in k.gruen}
    tour = {t.id: t for t in k.touren}

    # Jede Gruppe genau ein erster Abschnitt ab Flughafen
    erster = defaultdict(list)
    for t in k.touren:
        if t.art in ("direkt", "sammel_direkt", "sammel_knoten"):
            for gid in t.gruppen:
                erster[gid].append(x[t.id])
    for o in k.gruen:
        if o.zubringer is None:
            erster[o.gruppe].append(y[o.id])
    for g in gruppen:
        m.AddExactlyOne(erster[g.id])

    # Nach Sammelfahrt bis Umsteigepunkt: je Gruppe genau ein letzter Abschnitt
    letzte = defaultdict(list)
    gepaeck = defaultdict(list)
    gruen_je = defaultdict(list)
    for t in k.touren:
        if t.art == "letzte_km":
            letzte[(t.zubringer, t.gruppen[0])].append(x[t.id])
        elif t.art == "gepaeck":
            for gid in t.gruppen:
                gepaeck[(t.zubringer, gid)].append(x[t.id])
    for o in k.gruen:
        if o.zubringer is not None:
            letzte[(o.zubringer, o.gruppe)].append(y[o.id])
            gruen_je[(o.zubringer, o.gruppe)].append(y[o.id])
    for t in k.touren:
        if t.art == "sammel_knoten":
            for gid in t.gruppen:
                m.Add(sum(letzte[(t.id, gid)]) == x[t.id])
    # Gepäck fährt separat, wenn die Gruppe Rad/ÖPNV nimmt
    for key, ys in gruen_je.items():
        if gdict[key[1]].gepaeck:
            m.Add(sum(gepaeck[key]) == sum(ys))
        else:
            for v in gepaeck.get(key, []):
                m.Add(v == 0)
    for key, vs in gepaeck.items():
        if key not in gruen_je:
            for v in vs:
                m.Add(v == 0)

    if fest is not None:
        for tid, v in x.items():
            m.Add(v == (1 if tid in fest else 0))

    kosten = [tour_kosten_ct(t) * x[t.id] for t in k.touren]
    # Fremdvergabe an Partnerflotte: Fahrt wird nicht von eigenem Fahrzeug gefahren
    f = {t.id: m.NewBoolVar(f"f{t.id}") for t in k.touren}
    for t in k.touren:
        m.Add(f[t.id] <= (x[t.id] if PARTNER_AKTIV else 0))
        kosten.append((fremd_kosten_ct(t) - tour_kosten_ct(t)) * f[t.id])
    kosten += [(_gruen_kosten_ct(o, gdict, k) + rabatt_ct(o, gdict, k)) * y[o.id] for o in k.gruen]
    bogen_strafe = None
    if strafen is not None:
        tour_strafe, gruen_strafe, bogen_strafe = strafen
        kosten += [round(tour_strafe[t.id]) * x[t.id] for t in k.touren if tour_strafe[t.id]]
        kosten += [round(gruen_strafe[o.id]) * y[o.id] for o in k.gruen if gruen_strafe[o.id]]

    bogen_var = {}
    vip_starts = []
    vorlauf = vorlauf_je_tour(k, gdict)
    pflicht = _start_boegen(k, start) if start is not None else None
    if mit_ketten:
        for kl in KLASSEN:
            boegen = _boegen(k.touren, kl, bogen_strafe, puffer_min, vorlauf, pflicht)
            ein, aus, starts = defaultdict(list), defaultdict(list), []
            for i, b in enumerate(boegen):
                v = m.NewBoolVar(f"b{kl.name}{i}")
                bogen_var[(kl.name, i)] = (v, b)
                kosten.append(b.kosten_ct * v)
                if b.von is None:
                    starts.append(v)
                else:
                    aus[b.von].append(v)
                if b.nach is not None:
                    ein[b.nach].append(v)
            for t in k.touren:
                if t.klasse is kl:
                    m.Add(sum(ein[t.id]) == x[t.id] - f[t.id])
                    m.Add(sum(aus[t.id]) == x[t.id] - f[t.id])
            _ketten_regeln(m, kl, [t for t in k.touren if t.klasse is kl],
                           [(v, b) for (kn, _), (v, b) in bogen_var.items() if kn == kl.name],
                           gdict, kosten, vip_starts)
        if not daten.FLOTTE_UNBEGRENZT:   # bei offener Flotte auch VIP-Fahrer nach Bedarf
            m.Add(sum(vip_starts) <= VIP_FAHRER)
    else:
        for v in f.values():
            m.Add(v == 0)
        # Stufe 1 "nacheinander": jede Fahrt wird so bewertet, als käme ein eigenes
        # Fahrzeug vom Betriebssitz; Verkettung erst in Stufe 2
        for t in k.touren:
            hin = strassen_km(BETRIEBSSITZ, t.start)
            kosten.append((t.klasse.fix_ct + _km_kosten_ct(t.klasse, hin)) * x[t.id])

    fehlend = None
    if start is not None and mit_ketten:
        fehlend = _hinweise(m, k, x, y, f, bogen_var, start)
    ziel = sum(kosten)
    m.Minimize(ziel)
    s0 = None
    if fehlend == 0:
        # Startlösung erst fest rechnen (übrige Variablen wie Ladestand frei), dann als
        # vollständigen Hinweis setzen und nur noch mindestens gleich gute Pläne zulassen
        s0 = cp_model.CpSolver()
        s0.parameters.fix_variables_to_their_hinted_value = True
        s0.parameters.max_time_in_seconds = min(120, zeitlimit_s / 2)
        s0.parameters.num_workers = threads
        if s0.Solve(m) in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            m.ClearHints()
            for i in range(len(m.Proto().variables)):
                v = m.GetIntVarFromProtoIndex(i)
                m.AddHint(v, s0.Value(v))
            m.Add(ziel <= round(s0.ObjectiveValue()))
            zeitlimit_s = max(10, zeitlimit_s - s0.WallTime())
        else:
            s0 = None
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = zeitlimit_s
    s.parameters.num_workers = threads
    if SOLVER_SEED is not None:
        s.parameters.random_seed = SOLVER_SEED
    s.parameters.log_search_progress = protokoll
    st = s.Solve(m)
    if st not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        if s0 is None:
            return None
        s, st = s0, cp_model.FEASIBLE   # Rückfall: fest gerechnete Startlösung
    gewaehlt = {tid for tid, v in x.items() if s.Value(v)}
    fremd = {tid for tid, v in f.items() if s.Value(v)}
    gruen = [o for o in k.gruen if s.Value(y[o.id])]
    erg = {"status": s.StatusName(st), "gewaehlt": gewaehlt, "fremd": fremd, "gruen": gruen,
           "zielwert_ct": s.ObjectiveValue(), "schranke_ct": s.BestObjectiveBound(),
           "rechenzeit_s": s.WallTime(), "start_fehlend": fehlend}
    if mit_ketten:
        erg["boegen"] = [b for (v, b) in bogen_var.values() if s.Value(v)]
        erg["beginn"] = {tid: s.Value(v) for tid, v in BEGINN_VARS.items() if tid in gewaehlt}
        erg["soc"] = {tid: s.Value(v) for tid, v in SOC_VARS.items() if tid in gewaehlt}
        erg["lade"] = {key: s.Value(v) for key, v in LADE_VARS.items() if s.Value(v)}
        erg["kennzahlen"] = kennzahlen(gruppen, k, erg)
    return erg


def kennzahlen(gruppen, k: Kandidaten, erg) -> dict:
    tour = {t.id: t for t in k.touren}
    gdict = {g.id: g for g in gruppen}
    fahrzeuge = defaultdict(int)
    km_bel = km_leer = co2 = 0.0
    for tid in erg["gewaehlt"]:
        t = tour[tid]
        km_bel += t.km
        faktor = partner_co2_g_km(t.klasse) if tid in erg["fremd"] else t.klasse.co2_g_km
        co2 += t.km * faktor / 1000
    for b in erg["boegen"]:
        kl = tour[b.nach].klasse if b.nach is not None else tour[b.von].klasse
        km_leer += b.km
        co2 += b.km * kl.co2_g_km / 1000
        if b.von is None:
            fahrzeuge[kl.name] += 1
    for o in erg["gruen"]:
        if o.modus == "oepnv":
            g = gdict[o.gruppe]
            von = g.start if o.zubringer is None else tour[o.zubringer].ende
            co2 += strassen_km(von, g.ziel) * OEPNV_CO2_G_PERSON_KM * g.personen / 1000
    for tid in erg["fremd"]:
        km_leer += fremd_km(tour[tid])
        co2 += fremd_km(tour[tid]) * partner_co2_g_km(tour[tid].klasse) / 1000
    km_e = sum(tour[t].km for t in erg["gewaehlt"]
               if tour[t].klasse.elektrisch and t not in erg["fremd"])
    arten = defaultdict(int)
    for tid in erg["gewaehlt"]:
        arten[tour[tid].art] += 1
    return {
        "fahrzeuge": dict(fahrzeuge),
        "fahrzeuge_gesamt": sum(fahrzeuge.values()),
        "fahrten_partner": len(erg["fremd"]),
        "km_gesamt": round(km_bel + km_leer),
        "km_leer": round(km_leer),
        "co2_kg": round(co2, 1),
        "kosten_eur": round(betriebskosten_ct(gruppen, k, erg) / 100),
        "anteil_e_km_beladen": round(km_e / km_bel, 2) if km_bel else 0,
        "fahrten_je_art": dict(arten),
        "gruppen_rad": sum(1 for o in erg["gruen"] if o.modus == "rad"),
        "gruppen_oepnv": sum(1 for o in erg["gruen"] if o.modus == "oepnv"),
        "rabatt_gaeste_eur": round(sum(rabatt_ct(o, gdict, k) for o in erg["gruen"]) / 100),
    }


def betriebskosten_ct(gruppen, k: Kandidaten, erg) -> float:
    """Betriebskosten ohne CO2-Preis und ohne Verspätungsbewertung."""
    tour = {t.id: t for t in k.touren}
    gd = {g.id: g for g in gruppen}
    summe = 0.0
    for tid in erg["gewaehlt"]:
        t = tour[tid]
        eigen = t.km * t.klasse.kosten_ct_km + (t.ende_zeit - t.start_zeit) * FAHRER_CT_MIN
        if tid in erg["fremd"]:
            km = t.km + fremd_km(t)
            minuten = (t.ende_zeit - t.start_zeit) + fahrzeit_min(BETRIEBSSITZ, t.start) \
                + fahrzeit_min(t.ende, BETRIEBSSITZ)
            summe += FREMD_AUFSCHLAG * (km * t.klasse.kosten_ct_km + minuten * FAHRER_CT_MIN
                                        + t.klasse.fix_ct)
        else:
            summe += eigen
    summe += sum(b.betrieb_ct for b in erg["boegen"])
    for o in erg["gruen"]:
        summe += RAD_CT if o.modus == "rad" else OEPNV_CT_PERSON * gd[o.gruppe].personen
        summe += rabatt_ct(o, gd, k)
    return summe
