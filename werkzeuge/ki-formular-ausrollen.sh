#!/bin/bash
# KI-Assistent: Vorschau-Karte oeffnet das Fahrtformular, und fehlender Import in FahrtAdd (MacBook 2018).
# Vom eigenen Mac starten:
#   bash werkzeuge/ki-formular-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

for datei in src/components/views/FahrtAdd.jsx src/components/views/KiAssistentView.jsx src/App.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden."
