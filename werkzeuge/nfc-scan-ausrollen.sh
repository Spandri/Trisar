#!/bin/bash
# Hinweis "Kein Fahrzeug? NFC-Tag" in der Web-Fahrer-App (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/nfc-scan-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
for datei in src/i18n/de.js src/i18n/en.js src/i18n/es.js src/i18n/fr.js src/i18n/it.js src/i18n/tr.js src/features/fahrer/views/VehicleView.jsx src/components/KeinAuto.jsx src/features/fahrer/FahrerApp.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
    scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Fahrer-Web neu laden."
