#!/bin/bash
# Web-Dispo: Vergroesserung per transform statt CSS zoom (19.11.2026 abends). Vom eigenen Mac:
#   bash werkzeuge/ipad-karte-ausrollen.sh
#
# Auf dem iPad 2018 (aelteres Safari) zeichnete die Karte nur einen Teil der Flaeche mit riesiger Schrift,
# weil aelteres Safari CSS zoom bei WebGL falsch umsetzt. Jetzt wird #root per transform: scale vergroessert
# (admin/src/bildschirm.js), das alle Browser gleich behandeln. Aussehen bleibt wie vorher.
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "Web-Dispo"
for datei in src/bildschirm.js src/index.css src/hintergrundBreit.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  echo "   $datei"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'touch /app/src/main.jsx'"
echo "Fertig. Web-Dispo auf dem iPad neu laden (Safari: Seite neu laden)."
