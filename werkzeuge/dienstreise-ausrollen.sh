#!/bin/bash
# Dienstreise (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/dienstreise-ausrollen.sh
#
# 1. Migration 20261113220000_dienstreise: Tabellen dienstreise + dienstreise_fahrer, Push, Antworten, Beenden.
# 2. Edge Function flight-validate: liefert zusaetzlich die Abflugzeiten (fuer Dienstreise mit Flug).
#    train-validate: Ersatzzuege (nur in den Live-Aenderungen), Suche ab Startzeit, Bahnhofs-Speicher
#    (Tabelle bahnhof_ort), hoechstens 40 Bahn-Abfragen je Aufruf, Ankunft nach Mitternacht.
# 3. Web-Dispo: Reiter "Dienstreise" in Fahrt hinzufuegen, Uebersicht, Kachel in Alle Fahrten.
# 4. Web-Fahrer: Dienstreise-Karte in der Fahrtenliste, Ansicht mit Karte und Verbindung.
# iOS/Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/4 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261113220000_dienstreise

echo "2/4 flight-validate + train-validate"
for d in supabase/functions/flight-validate/index.ts supabase/functions/train-validate/index.ts; do
  scp -q "$HIER/fahrer/$d" "$SERVER:$R/fahrer-app-lokal/$d"
  scp -q "$HIER/fahrer/$d" "$SERVER:$R/trisar/fahrer/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

kopieren() { # app container dateien...
  local app=$1 container=$2; shift 2
  for datei in "$@"; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
      ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
      scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
    done
    ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
  done
}

echo "3/4 Web-Dispo"
kopieren admin fahrer-app-lokal-admin-1 \
  src/shared/dienstreise.js src/components/ui/ArtUmschalter.jsx src/components/ui/DienstreiseKacheln.jsx \
  src/components/views/DienstreiseAdd.jsx src/components/views/DienstreiseView.jsx \
  src/components/views/FahrtAdd.jsx src/components/views/StandbyAdd.jsx src/components/views/AnkuenfteView.jsx \
  src/App.jsx

echo "4/4 Web-Fahrer"
kopieren fahrer fahrer-app-lokal-fahrer-1 \
  src/shared/dienstreise.js src/features/fahrer/views/DienstreiseKarte.jsx src/features/fahrer/views/DienstreiseDetail.jsx \
  src/features/fahrer/views/FahrtenScreen01View.jsx src/features/fahrer/FahrerApp.jsx
echo "Fertig. Dispo und Fahrer-App neu laden."
