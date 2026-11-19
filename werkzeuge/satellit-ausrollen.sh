#!/bin/bash
# Satellitenkarte der Web-Dispo reparieren (17.11.2026). Vom eigenen Mac starten:
#   bash werkzeuge/satellit-ausrollen.sh
#
# Esri gibt im Satelliten-Stil je Quelle eine Kachel-Liste (tiles) und eine url auf den ArcGIS-Dienst an.
# MapLibre nimmt die url, bekommt dort kein Kachelverzeichnis und laedt keine Bilder. kartenStil.js
# entfernt die url (esriQuellenRichten), maplibreKarte.js wendet das bei jedem Wechsel auf Satellit an.
# iOS und Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

# Erst kartenStil.js (liefert esriQuellenRichten), dann die Karte, die es importiert.
for datei in src/shared/karte/kartenStil.js src/shared/karte/maplibreKarte.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   $datei"
done
sleep 5
echo "Fehler im Web-Log der letzten Minute: $(ssh "$SERVER" "$DOCKER logs --since 1m fahrer-app-lokal-admin-1 2>&1 | grep -ic error" || true)"
echo "Fertig. Web-Dispo neu laden und im Karten Filter Satellit waehlen."
