#!/bin/bash
# Treffpunkt Teil 2 (MacBook 2018). Vom eigenen Mac starten (Pfad egal):
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/treffpunkt2-ausrollen.sh
#
# 1. Migration 20261113160000_push_treffpunkt: Push zum Dienst nennt den Treffpunkt, eigene Mitteilung
#    wenn die Dispo nur Treffpunkt oder Notiz eines vorhandenen Dienstes aendert.
# 2. Web-Dispo: Treffpunkt wird vor dem Dienst gespeichert (gleiche ID, fuer den Push-Text),
#    Fahrer-Ansicht zeigt beim Dienststart Ort und Notiz.
# iOS/Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261113160000_push_treffpunkt

echo "2/2 Web-Dispo"
for datei in src/components/views/AlleFahrer.jsx src/components/views/FahrerAnsichtView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden."
