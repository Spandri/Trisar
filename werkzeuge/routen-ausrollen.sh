#!/bin/bash
# Routen auf der Karte aus gespeicherten Koordinaten + Statusregel zusammengefuehrt (MacBook 2018).
#   bash werkzeuge/routen-ausrollen.sh
set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261107140000_statusregel_zusammengefuehrt

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
}

echo "2/3 Web-Dispo"
for d in src/components/views/KartenView.jsx src/shared/karte/maplibreKarte.js; do
  kopieren admin "$d" fahrer-app-lokal-admin-1
done

echo "3/3 Web-Fahrer"
for d in src/features/fahrer/FahrerApp.jsx src/features/fahrer/views/KoloneFlughafen.jsx \
         src/features/fahrer/views/KoloneNormal.jsx src/features/fahrer/views/SoloFlughafen.jsx \
         src/features/fahrer/views/SoloNormal.jsx src/shared/karte/maplibreKarte.js src/shared/utils/routenPunkt.js; do
  kopieren fahrer "$d" fahrer-app-lokal-fahrer-1
done
echo "Fertig. Dispo und Fahrer-App neu laden."
