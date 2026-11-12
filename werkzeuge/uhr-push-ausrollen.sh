#!/bin/bash
# Dispo-Warnungen und Antwort-Knoepfe in Mitteilungen auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/uhr-push-ausrollen.sh
#
# 1. Migration 20261111060000_push_dispo_warnungen einspielen (push_dispo_warnungen())
# 2. push-dienst.js (aps.category, Aufruf push_dispo_warnungen jede Minute) auf den 2018er kopieren
# 3. Container push-dienst neu starten und die letzten Zeilen seines Logs zeigen
#
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/3 Migration einspielen"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261111060000_push_dispo_warnungen

echo "2/3 push-dienst.js kopieren"
for ziel in "$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts" "$R/trisar/koordinaten/scripts"; do
  scp -q "$HIER/koordinaten/scripts/push-dienst.js" "$SERVER:$ziel/push-dienst.js"
done

echo "3/3 Dienst neu starten"
ssh "$SERVER" "cd $R/fahrer-app-lokal && $DOCKER compose up -d push-dienst && $DOCKER restart fahrer-app-lokal-push-dienst-1 >/dev/null && sleep 6 && $DOCKER logs --tail 15 fahrer-app-lokal-push-dienst-1"
echo "Fertig."
