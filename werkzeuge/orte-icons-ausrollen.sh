#!/bin/bash
# Eigene Orte (neue Icons, Ort-Zeichen, Radien ohne Schild) und Signal-Stufen der Fahrer, beim Antippen nur
# die Radien (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/orte-icons-ausrollen.sh
# 1. Migration 20261110140000_orte_icons_erweitert
# 2. Icon-Dateien fuer Dispo- und Fahrer-Web (nur hinzufuegen, nichts loeschen)
# 3. Web-Dispo
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261110140000_orte_icons_erweitert

echo "2/3 Icons"
for app in admin fahrer; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/icon/" "$R/trisar/$app/icon/"; do
    rsync -a "$HIER/$app/icon/" "$SERVER:$ziel"
  done
done

echo "3/3 Web-Dispo"
for datei in src/shared/karte/maplibreKarte.js src/shared/orte.js src/shared/karte/ortKreise.js src/components/views/OrtBearbeitenView.jsx src/components/views/KartenView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden."
