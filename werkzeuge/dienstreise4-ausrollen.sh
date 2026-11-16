#!/bin/bash
# Dienstreise: Fahrzeug mit Fahrer auf der Karte (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/dienstreise4-ausrollen.sh
#
# 1. Migration 20261114030000_ortung_dienstreise: App-Ortung auch waehrend einer angenommenen Dienstreise
#    (30 min vor Start bis "Dienstreise beenden", ohne Beenden bis 2 h nach der letzten Ankunft).
# 2. Web-Fahrer: blaue Linie (gefahren grau), Bus/U-Bahn/Zug mit dem Fahrer darauf, JETZT/gefahren.
# 3. Web-Dispo: Fahrer auf Dienstreise auf der Karte als Fahrzeug auf seiner Strecke statt Pin.
# iOS/Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261114030000_ortung_dienstreise

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

echo "2/3 Web-Fahrer"
kopieren fahrer fahrer-app-lokal-fahrer-1 \
  src/shared/reiseLage.js src/features/fahrer/views/DienstreiseDetail.jsx src/features/fahrer/FahrerApp.jsx

echo "3/3 Web-Dispo"
kopieren admin fahrer-app-lokal-admin-1 \
  src/shared/reiseLage.js src/shared/dienstreise.js src/components/ui/DienstreiseKartenSchicht.jsx \
  src/components/views/KartenView.jsx
echo "Fertig. Dispo und Fahrer-App neu laden."
