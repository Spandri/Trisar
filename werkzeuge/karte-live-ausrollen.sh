#!/bin/bash
# Dispo-Karte: Standorte sofort setzen ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/karte-live-ausrollen.sh
#
# Eine Standort-Meldung (Realtime auf driver_live_locations) setzt die Position des Fahrers sofort.
# Das komplette Neuladen aller Fahrer, Fahrten und Fahrzeuge kommt hoechstens alle 10 s hinterher.
# Keine Migration noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
CONTAINER=fahrer-app-lokal-admin-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

datei=src/components/views/KartenView.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
  scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec $CONTAINER touch /app/$datei"
echo "   $datei"
echo "Fertig. Dispo neu laden, Karte oeffnen."
