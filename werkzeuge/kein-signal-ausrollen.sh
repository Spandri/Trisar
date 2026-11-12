#!/bin/bash
# Dispo-Karte: Fahrer ohne Signal seit 5 Minuten grau mit rotem Punkt, letztes Signal im Fenster (MacBook 2018).
# Vom eigenen Mac starten:
#   bash werkzeuge/kein-signal-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
# Bilder und Texte zuerst, dann der Code.
for datei in public/icon/_Icon_Karte/Fahrer_Offline_Trisar_01.svg public/icon/_Icon_Karte/Fahrer_Offline_Punkt_Trisar_01.svg \
  public/icon/_Icon_Karte/Fahrer_Offline_Grund_Trisar_01.svg public/icon/_Icon_Karte/Fahrer_Offline_Balken_Trisar_01.svg \
  src/i18n/de.js src/i18n/en.js src/i18n/es.js src/i18n/fr.js src/i18n/it.js src/i18n/tr.js \
  src/shared/karte/maplibreKarte.js src/components/views/KartenView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden."
