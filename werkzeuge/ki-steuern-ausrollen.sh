#!/bin/bash
# KI-Assistent steuert (fast) alles (13.11.). Vom eigenen Mac starten:
#   bash werkzeuge/ki-steuern-ausrollen.sh
#
# dispo-admin:
#   fahrtenKi.ts (neu): Fahrt stornieren, endgueltig loeschen (nur mit "löschen"), erledigt, kopieren, Notiz,
#                       verspaetete Fahrten, Flugstatus ("Wann landet LH2034?"), Fahrten eines Kunden (Firma der Gaeste)
#   steuernKi.ts (neu): Push-Nachricht an Fahrer, Telefon/Fahrernummer/Flagge/Passwort, Kennzeichen/Farbe/Sitze,
#                       Reichweite, freie Fahrzeuge, Tracker-Stufe, Gast anlegen/aendern, Ort anlegen, Stundenzettel
#                       bestaetigen/zurueckgeben, Fahrerbedarf, "rückgängig", "Was kannst du?"
#   weitereKi.ts, anlegen.ts (passwortErzeugen), ki.ts (Reihenfolge)
# Alles mit Rueckfrage, "ja" fuehrt aus. Kein App-Build, keine Migration. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in fahrtenKi.ts steuernKi.ts weitereKi.ts anlegen.ts ki.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „Was kannst du alles?“"
