"""Erzeugt Event-Instanzen: Gästegruppen landen am Flughafen und fahren in Hotels."""
from __future__ import annotations

import random
from dataclasses import dataclass

from daten import ERLAUBT_ALLE, FLUGHAFEN, HOTELS, Ort, fahrzeit_min

MESSE_RIEM = Ort("Messe München Riem", 48.1344, 11.6926)


@dataclass(frozen=True)
class Gruppe:
    id: int
    personen: int
    gepaeck: int
    ankunft: int          # Minute, ab der die Gruppe abholbereit ist
    ziel: Ort
    spaetestens: int      # späteste Ankunft am Ziel (Abholfenster des Gastes)
    gruen_ok: bool        # würde Rad/ÖPNV annehmen (Annahme-Szenario)
    start: Ort = FLUGHAFEN
    premium: bool = False     # Einzelfahrt bis zur Tür, keine Sammelfahrt mit anderen
    tag: int = 0
    art: str = ""            # anreise | shuttle | abreise
    erlaubt: frozenset = ERLAUBT_ALLE   # vom Auftraggeber freigegebene Optionen
    gast_waehlt: bool = True  # False: Auftraggeber entscheidet, Annahme sicher
    abholfenster: int = 0     # Minuten Spielraum der Abholung (Engine wählt die Zeit)
    frueher: int = 0          # davon so viele Minuten vor der Wunschzeit 'ankunft'
    flug: str = ""            # Flugnummer (Demo), steuert Flugverspätung in den Szenarien
    job_id: str = ""          # Fahrt-ID der Demo (jobs.json)

    @property
    def bereit_ab(self) -> int:
        """Frühester Abholzeitpunkt: Wunschzeit minus erlaubter Vorlauf im Abholfenster."""
        return self.ankunft - self.frueher


def erzeuge(n_gruppen: int = 30, fenster_min: int = 90, puffer_min: int = 30,
            annahme_gruen: float = 0.3, seed: int = 1,
            start: Ort = FLUGHAFEN) -> list[Gruppe]:
    """puffer_min: wie viel später als bei sofortiger Direktfahrt der Gast
    ankommen darf (Abholfenster statt fester Uhrzeit)."""
    rnd = random.Random(seed)
    gruppen = []
    for i in range(n_gruppen):
        ankunft = rnd.randint(0, fenster_min)
        personen = rnd.choice([1, 1, 2, 2, 2, 3])
        gepaeck = personen + rnd.choice([0, 0, 1])
        ziel = rnd.choice(HOTELS)
        direkt = fahrzeit_min(start, ziel)
        gruppen.append(Gruppe(i, personen, gepaeck, ankunft, ziel,
                              ankunft + direkt + puffer_min,
                              rnd.random() < annahme_gruen, start))
    return sorted(gruppen, key=lambda g: g.ankunft)
