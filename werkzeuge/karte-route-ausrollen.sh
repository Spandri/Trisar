#!/bin/bash
# Dispo-Karte: Route ab Fahrer, wenn er unterwegs ist (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/karte-route-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
d=src/components/views/KartenView.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$d" "$R/trisar/admin/$d"; do
  scp -q "$HIER/admin/$d" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$d"
echo "Fertig. Dispo neu laden."
