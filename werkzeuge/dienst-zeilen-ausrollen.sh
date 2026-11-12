#!/bin/bash
# Fahrer-App (Web): angenommener Dienst als Zeilen "Dienststart"/"Dienstende" wie im Verlauf (MacBook 2018).
#   bash werkzeuge/dienst-zeilen-ausrollen.sh
# Dienststart steht ueber den Fahrten des Tages, Dienstende darunter. Ist die Uhrzeit vorbei,
# verschwindet die Zeile (steht dann im Verlauf). Offene Anfragen bleiben Karte mit Annehmen/Ablehnen.
# Nur eine Web-Datei, keine Datenbank. iOS/Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
for DATEI in src/features/fahrer/views/FahrtenScreen01View.jsx src/features/fahrer/FahrerApp.jsx; do
for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$DATEI" "$R/trisar/fahrer/$DATEI"; do
  scp -q "$HIER/fahrer/$DATEI" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$DATEI" 2>/dev/null || true
done
echo "Fertig. Fahrer-App neu laden."
