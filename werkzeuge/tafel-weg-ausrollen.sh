#!/bin/bash
# Live-Board des Flughafens aus der Web-Dispo entfernen (17.11.2026, Wunsch User). Vom eigenen Mac starten:
#   bash werkzeuge/tafel-weg-ausrollen.sh
#
# 1. Ankuenfte/Abfahrten ohne den Kasten "Live-Board"
# 2. App.jsx: Tafel nicht mehr laden (werkzeuge/tafel-weg-einbauen.py baut nur das in die Server-Fassung
#    ein, die lokale App.jsx hat noch nicht ausgerollte Aenderungen anderer Sitzungen)
# Die Funktion airport-board bleibt, bis die alten App-Builds ersetzt sind.
# Dazu (17.11.): Wischen auch in "Meine Fahrten" (Standort ausgefuellt), gleiche Dateien.
# iOS- und Android-Dispo brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Ankuenfte und Abfahrten"
for datei in src/components/views/AnkuenfteView.jsx src/components/views/AbfahrtenView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   $datei"
done

echo "2/2 App.jsx"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/src/App.jsx" "$R/trisar/admin/src/App.jsx"; do
  scp -q "$SERVER:$ziel" "$ARBEIT/App.jsx"
  python3 "$HIER/werkzeuge/tafel-weg-einbauen.py" "$ARBEIT/App.jsx"
  scp -q "$ARBEIT/App.jsx" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/src/App.jsx"
sleep 5
echo "Fehler im Web-Log der letzten Minute: $(ssh "$SERVER" "$DOCKER logs --since 1m fahrer-app-lokal-admin-1 2>&1 | grep -ic error" || true)"
echo "Fertig."
