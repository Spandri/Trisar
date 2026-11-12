#!/bin/bash
# Ortung startet zum Dienstbeginn auch bei schlafender App, laufende Stundenerfassung nur im Verlauf
# (MacBook 2018).   bash werkzeuge/ortung-wecken-ausrollen.sh
#
# 1. Datenbank: ortung_zustand und ortung_wecken() (Wechsel in die Arbeitszeit -> Mitteilung
#    "Arbeitszeit beginnt", art ortung_start).
# 2. push-dienst: ruft jede Minute ortung_wecken(), iOS-Mitteilung mit content-available (weckt die App).
# 3. Web-Fahrer-App: Stundenerfassung des laufenden Tages nicht mehr auf der Startseite.
# iOS und Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Datenbank"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112140000_ortung_wecken

echo "2/3 push-dienst"
for ziel in "$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts" "$R/trisar/koordinaten/scripts"; do
  scp -q "$HIER/koordinaten/scripts/push-dienst.js" "$SERVER:$ziel/push-dienst.js"
done
ssh "$SERVER" "$DOCKER restart fahrer-app-lokal-push-dienst-1 >/dev/null && sleep 5 && $DOCKER logs --tail 5 fahrer-app-lokal-push-dienst-1"

echo "3/3 Fahrer-App"
for datei in src/features/fahrer/views/Stunden.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
    scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei"
  echo "   fahrer/$datei"
done
echo "Fertig. Fahrer-App neu laden. iOS und Android brauchen einen neuen Build."
