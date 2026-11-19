#!/bin/bash
# Tracker-Anschluss USB-C / OBD (18.11.): Server erkennt den Anschluss selbst, OBD-Tracker schlafen beim Parken
# (ausser Dienst Tiefschlaf, im Dienst Online-Tiefschlaf). MacBook 2018. Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/tracker-anschluss-ausrollen.sh
# 1. Migration 20261118160000_tracker_anschluss
# 2. push-dienst.js (ruft jede Minute tracker_schlaf_abgleichen auf), Neustart
# 3. Web-Dispo: Anschluss im Karten Filter je Tracker, Antippen stellt um
# 4. Stand der Tracker
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/4 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118160000_tracker_anschluss

echo "2/4 push-dienst.js"
for ziel in "$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts" "$R/trisar/koordinaten/scripts"; do
  scp -q "$HIER/koordinaten/scripts/push-dienst.js" "$SERVER:$ziel/push-dienst.js"
done
ssh "$SERVER" "$DOCKER restart fahrer-app-lokal-push-dienst-1 >/dev/null"

echo "3/4 Web-Dispo"
d=src/components/views/KartenFilterView.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$d" "$R/trisar/admin/$d"; do
  scp -q "$HIER/admin/$d" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$d" 2>/dev/null || true

echo "4/4 Stand"
sleep 3
ssh "$SERVER" "$DOCKER exec supabase_db_fahrer-app-lokal psql -U postgres -c \
  \"select nummer, anschluss, anschluss_status, schlaf from obd_tracker order by nummer\""
echo "Fertig. Anschluss wird erkannt, sobald der Tracker Daten schickt (OBD: nach 30 min Parken oder mit VIN)."
