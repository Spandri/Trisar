#!/bin/bash
# Dienstreise: Reihenfolge in der Fahrer-Liste nach Uhrzeit, Dienstreise im Fahrerblatt der Dispo-Karte (MacBook 2018).
# Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/dienstreise5-ausrollen.sh
# Nur Web-Dateien, keine Migration. iOS/Android brauchen einen neuen Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

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

echo "1/2 Web-Fahrer"
kopieren fahrer fahrer-app-lokal-fahrer-1 src/features/fahrer/views/FahrtenScreen01View.jsx
echo "2/2 Web-Dispo"
kopieren admin fahrer-app-lokal-admin-1 src/components/views/KartenView.jsx
echo "Fertig. Dispo und Fahrer-App neu laden."
