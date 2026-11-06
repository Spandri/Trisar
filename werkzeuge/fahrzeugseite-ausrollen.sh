#!/bin/bash
# Fahrzeugseite der Web-Fahrer-App ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/fahrzeugseite-ausrollen.sh
#
# Was kommt mit:
# - Fahrzeugkarte (Startseite, "Keine Fahrt") und Fahrzeugblock zeigen nur Angaben,
#   die es gibt (kein VIN-Platzhalter, keine graue Bildflaeche, nur Kacheln mit Wert)
# - Chip an der Karte: "Standort: OBD-Tracker / Fahrer-App" plus Alter ("vor 3 Min.")
# - Karte nimmt den OBD-Standort, sonst den Handy-Standort
#
# VehicleView.jsx und FahrerApp.jsx bauen auf den OBD-Fahrzeugdaten auf
# (FahrzeugTelemetrie.jsx, Standort auf der Fahrzeugseite). Fehlen die auf dem
# Server noch, bricht das Skript vor diesen beiden Dateien ab.
# Keine Migration noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
CONTAINER=fahrer-app-lokal-fahrer-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

kopieren() { # datei (relativ zu fahrer/)
  local datei="$1"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
    ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
    scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $CONTAINER touch /app/$datei"
  echo "   $datei"
}

echo "1/2 Fahrzeugkarte und gemeinsame Bausteine"
for f in src/shared/fahrzeugAngaben.js src/shared/FahrzeugKarte.jsx \
         src/features/fahrer/views/FahrtenScreen01View.jsx src/components/KeineFahrtTrisar.jsx \
         src/i18n/de.js src/i18n/en.js; do
  kopieren "$f"
done

echo "2/2 Fahrzeugseite (Standort-Chip)"
S="$R/fahrer-app-lokal/.docker-sync/fahrer"
if ! ssh "$SERVER" "test -f '$S/src/features/fahrer/views/FahrzeugTelemetrie.jsx' && grep -q fahrzeugStandort '$S/src/features/fahrer/FahrerApp.jsx'"; then
  echo "   Abbruch: Auf dem Server fehlen noch die OBD-Fahrzeugdaten (FahrzeugTelemetrie.jsx,"
  echo "   fahrzeugStandort in FahrerApp.jsx). Erst diese ausrollen, dann dieses Skript erneut starten."
  echo "   Startseiten-Karte ist schon live."
  exit 1
fi
for f in src/features/fahrer/views/VehicleView.jsx src/features/fahrer/FahrerApp.jsx; do
  kopieren "$f"
done
echo "Fertig. Fahrer-App neu laden."
