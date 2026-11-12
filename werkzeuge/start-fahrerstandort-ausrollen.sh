#!/bin/bash
# Fahrt ohne Start: Abholort = Standort des Fahrers (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/start-fahrerstandort-ausrollen.sh
# 1. Migration jobs.start_fahrerstandort + Trigger
# 2. Web-Dispo (Start kein Pflichtfeld mehr, Texte)
# iOS- und Android-Dispo brauchen einen neuen Build (FahrtSpeichern, FahrtFormular, FahrtText).
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261110160000_start_fahrerstandort

kopieren() { # app datei container
  local app="$1" datei="$2" container="$3"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
    scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
}
echo "2/2 Web-Dispo"
A=fahrer-app-lokal-admin-1
for l in de en es fr it tr; do kopieren admin "src/i18n/$l.js" "$A"; done
kopieren admin src/components/views/FahrtAdd.jsx "$A"
kopieren admin src/App.jsx "$A"
echo "Fertig. Dispo neu laden."
