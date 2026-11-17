#!/bin/bash
# Live-Board MUC ohne Lufthansa (17.11.2026) auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/tafel-ausrollen.sh
#
# Die Lufthansa-Schnittstelle lehnt den Zugang seit 17.11. mit 401 ab, das Live-Board der Dispo zeigte
# "Edge Function returned a non-2xx status code: 500".
# 1. _shared/muc-tafel.ts (neu): Ankuenfte/Abfluege MUC von munich-airport.de, ab jetzt, nur Lufthansa-Gruppe
# 2. airport-board: fuer MUC diese Tafel, andere Flughaefen wie bisher ueber Lufthansa
# 3. Web-Dispo: Kasten ohne Daten ausblenden statt roter Fehlermeldung (iOS/Android brauchen einen Build)
# 4. Probe: Tafel Ankuenfte und Abfluege
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions

echo "1/4 + 2/4 Edge Function"
for datei in _shared/muc-tafel.ts airport-board/index.ts; do
  for z in "$R/fahrer-app-lokal/$FN/$datei" "$R/trisar/fahrer/$FN/$datei"; do scp -q "$HIER/fahrer/$FN/$datei" "$SERVER:$z"; done
  echo "   $datei"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "3/4 Web-Dispo"
kopieren() { # datei relativ zu admin/
  local datei="$1"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   $datei"
}
kopieren src/components/views/AnkuenfteView.jsx
kopieren src/components/views/AbfahrtenView.jsx

echo "4/4 Probe"
SCHLUESSEL=$(ssh "$SERVER" "$DOCKER exec supabase_edge_runtime_fahrer-app-lokal printenv SUPABASE_ANON_KEY")
for modus in arrivals departures; do
  ssh "$SERVER" "curl -s -m 60 -X POST http://127.0.0.1:54321/functions/v1/airport-board \
    -H 'Authorization: Bearer $SCHLUESSEL' -H 'Content-Type: application/json' \
    -d '{\"airport_code\":\"MUC\",\"mode\":\"$modus\",\"limit\":3}'" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print("  ", sys.argv[1], d.get("source"), d.get("error") or "", [(i.get("time_label"), i.get("flight_number"), i.get("route_label")) for i in d.get("items", [])])' "$modus"
done
echo "Fertig."
