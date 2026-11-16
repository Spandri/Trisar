#!/bin/bash
# Dienstreise Nachzug (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/dienstreise2-ausrollen.sh
#
# 1. Migration 20261113230000_bahnhof_ort: Bahnhofs-Speicher fuer train-validate.
# 2. train-validate: Ersatzzuege (nur in den Live-Aenderungen, z. B. ICE 2518), Suche ab Startzeit,
#    hoechstens 40 Bahn-Abfragen je Aufruf, Ankunft nach Mitternacht. Neustart Edge Functions (ca. 10 s).
# 3. Web-Dispo und Web-Fahrer: Startzeit an die Zugabfrage mitschicken.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261113230000_bahnhof_ort

echo "2/3 train-validate"
d=supabase/functions/train-validate/index.ts
scp -q "$HIER/fahrer/$d" "$SERVER:$R/fahrer-app-lokal/$d"
scp -q "$HIER/fahrer/$d" "$SERVER:$R/trisar/fahrer/$d"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

kopieren() { # app container dateien...
  local app=$1 container=$2; shift 2
  for datei in "$@"; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
      scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
    done
    ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
  done
}
echo "3/3 Web"
kopieren admin fahrer-app-lokal-admin-1 src/shared/dienstreise.js src/components/views/DienstreiseAdd.jsx
kopieren fahrer fahrer-app-lokal-fahrer-1 src/shared/dienstreise.js
echo "Fertig. Dispo und Fahrer-App neu laden."
