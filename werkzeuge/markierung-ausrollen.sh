#!/bin/bash
# Markierte Fahrer (14.11.): Auswahl in Alle Fahrer gilt immer als Markierung (auch fuer den KI-Assistenten),
# Flaggenfilter markiert alle Fahrer mit der Flagge, nicht nur die mit Standort (MacBook 2018).
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/markierung-ausrollen.sh
# Nur Web-Dispo. iOS/Android brauchen einen neuen Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
for datei in src/components/views/AlleFahrer.jsx src/components/views/KartenView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden."
