"""Exakte Zulaessigkeitsgrenzen je Fahrt und wirksame Fahrerprofile fuer die Demo.

Fuer die Laufzeit-Anpassung in der Demo (planerErgebnisse.js): Ein Fahrer mit
Ruhezeitfenster darf eine Fahrt nur uebernehmen, wenn
  fruehesterStart <= Fahrtbeginn - (Anfahrt + Puffer)     und
  spaetestesEnde  >= Fahrtende + Rueckweg
— genau die Regel aus driver_schedule_solver.solve_schedule. Anfahrt und Rueckweg
haengen von den Zonen ab; alle Demo-Fahrer starten und enden in derselben Zone.
Fahrerprofile: Gruppen von Fahrern, die fuer den Solver austauschbar sind
(wirksame Hoechstdauer, Fairness-Teilnahme, Mindestdauer, Zonen, VIP, ...), einmal
fuer den Hauptblock, einmal zusaetzlich mit der Spaetblock-Kopie aus api_server.py.
"""
import json
import os
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
PLANER = os.path.normpath(os.path.join(HIER, "..", "..", "..", "admin-app-lokal"))
ARBEIT = os.environ.get("PLANER_ARBEIT") or os.path.join(HIER, "arbeit")
sys.path.insert(0, PLANER)

from optimizer import admin_payload_adapter as apa  # noqa: E402
from optimizer.api_server import PlannerRequest, _build_adapter_options  # noqa: E402
from optimizer.driver_schedule_solver import _minutes_from_day_start, _resolve_planning_day  # noqa: E402

with open(os.path.join(HIER, "fahrzeiten_von_muenchen.json"), encoding="utf-8") as _d:
    _TABELLE = json.load(_d)


def _aus_tabelle(self, adresse):
    schluessel = str(adresse or "").strip().lower()
    if schluessel in _TABELLE:
        return int(_TABELLE[schluessel])
    raise RuntimeError(f"Adresse nicht in Fahrzeittabelle: {adresse}")


apa.OpenStreetMapTravelTimeProvider.minutes_from_munich = _aus_tabelle


def anpassen(anfrage):
    payload = PlannerRequest(**anfrage)
    optionen = _build_adapter_options(payload.settings)
    anbieter = apa.OpenStreetMapTravelTimeProvider(origin_address="München, Deutschland")
    return apa.adapt_admin_payload_to_solver_inputs(
        raw_drivers=payload.drivers, raw_rides=payload.rides, service_date_value=payload.serviceDate,
        zone_provider=anbieter, options=optionen,
        place_minutes=payload.travelMinutes or None, depot_place=payload.depot,
    )


def main():
    ergebnis = {"fahrtFenster": {}, "fahrerProfile": {}}
    with open(os.path.join(ARBEIT, "fenster", "anfragen.jsonl"), encoding="utf-8") as datei:
        for zeile in datei:
            eintrag = json.loads(zeile)
            fahrer, fahrten, zonen, _ = anpassen(eintrag["anfrage"])
            if eintrag["art"] == "fahrten":
                zonenpaare = {(f.start_zone, f.end_zone) for f in fahrer}
                if len(zonenpaare) != 1:
                    print("uebersprungen (verschiedene Fahrerzonen):", eintrag["kennung"][:40])
                    continue
                (start_zone, end_zone), = zonenpaare
                tag = _resolve_planning_day(fahrten, None)
                grenzen = {}
                for fahrt in fahrten:
                    beginn = _minutes_from_day_start(tag, fahrt.start_time)
                    ende = _minutes_from_day_start(tag, fahrt.end_time)
                    frueh = beginn - (zonen.minutes(start_zone, fahrt.start_zone) + int(fahrt.pre_buffer_minutes))
                    spaet = ende + zonen.minutes(fahrt.end_zone, end_zone)
                    grenzen[fahrt.ride_id] = [frueh, spaet, 1 if fahrt.is_vip_ride else 0]
                ergebnis["fahrtFenster"][eintrag["kennung"]] = grenzen
            else:
                gruppen_basis, gruppen_kopie, gruppen_rest, profile = {}, {}, {}, {}
                for f in fahrer:
                    basis = (f.is_vip_qualified, f.historical_worked_hours, f.hard_max_hours, f.is_availability_limited,
                             f.min_shift_hours, f.start_zone, f.end_zone, f.is_ev, f.ev_range_km)
                    kopie_verf = max(0.5, f.availability_max_hours - 1e-6)
                    kopie = basis + (min(kopie_verf, f.legal_max_hours), kopie_verf + 1e-9 < f.legal_max_hours)
                    b = gruppen_basis.setdefault(basis, len(gruppen_basis))
                    k = gruppen_kopie.setdefault(kopie, len(gruppen_kopie))
                    # Spaetblock-Platz wirkt wie Hauptblock -> geteilter Dienst darf getrennt werden.
                    wie_haupt = 1 if kopie[-2:] == (f.hard_max_hours, f.is_availability_limited) else 0
                    # Rest: alles ausser Hoechst-/Mindestdauer und Fairness-Teilnahme — fuer den
                    # Notfall-Tausch (Dienst passt in die Grenzen des anderen Fahrers).
                    rest = (f.is_vip_qualified, f.historical_worked_hours, f.start_zone, f.end_zone, f.is_ev, f.ev_range_km)
                    r = gruppen_rest.setdefault(rest, len(gruppen_rest))
                    profile[f.driver_id] = [b, k, wie_haupt, r, int(round(f.hard_max_hours * 60)), int(round(f.min_shift_hours * 60))]
                ergebnis["fahrerProfile"][eintrag["kennung"]] = profile
    ziel = os.path.join(ARBEIT, "fenster", "ergebnis.json")
    with open(ziel, "w", encoding="utf-8") as datei:
        json.dump(ergebnis, datei)
    print(f"{len(ergebnis['fahrtFenster'])} Fahrten-Tabellen, {len(ergebnis['fahrerProfile'])} Profil-Tabellen, {round(os.path.getsize(ziel) / 1024)} KB")
    for kennung, profile in ergebnis["fahrerProfile"].items():
        print("  Profile", kennung[:48], "Gruppen:", len({v[0] for v in profile.values()}), "/", len({v[1] for v in profile.values()}), "wie Haupt:", sum(v[2] for v in profile.values()))


if __name__ == "__main__":
    main()
