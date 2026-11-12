#!/bin/bash
# Reihenfolge der Zeiten ausrollen (MacBook 2018): Dienststart < Pausenanfang < Pausenende < Dienstende,
# ueber Mitternacht ab Dienststart gerechnet. In Dienste planen (Dispo) und in der Stundenerfassung
# (Dispo und Fahrer) zeigt ein roter Hinweis den Fehler, Senden/Speichern ist dann gesperrt.
#   bash werkzeuge/zeit-reihenfolge-ausrollen.sh
# Nur Web. iOS und Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
kopieren() { # app container dateien...
  local app=$1 box=$2; shift 2
  for datei in "$@"; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
      scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
    done
    ssh "$SERVER" "$DOCKER exec $box touch /app/$datei"
    echo "   $app/$datei"
  done
}
echo "1/2 Dispo"
kopieren admin fahrer-app-lokal-admin-1 src/shared/zeitReihenfolge.js src/components/views/DienstePlanenBlatt.jsx \
  src/components/views/AlleFahrer.jsx src/components/views/FahrerStundenKarten.jsx
echo "2/2 Fahrer-App"
kopieren fahrer fahrer-app-lokal-fahrer-1 src/shared/zeitReihenfolge.js src/features/fahrer/views/Stunden.jsx
echo "Fertig. Dispo und Fahrer-App neu laden. iOS und Android brauchen einen neuen Build."
