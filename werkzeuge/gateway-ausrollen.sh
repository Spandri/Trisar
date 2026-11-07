#!/bin/bash
# Teltonika-Gateway ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/gateway-ausrollen.sh
#
# Kopiert scripts/teltonika-gateway.js nach .docker-sync/koordinaten (das ist im Container
# gemountet) und in die Spiegel trisar/admin + trisar/koordinaten, startet dann den Container neu.
# Tracker verbinden sich danach von selbst wieder (je nach Sendeintervall bis ca. 2 Minuten).

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
CONTAINER=fahrer-app-lokal-teltonika-gateway-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
DATEI=scripts/teltonika-gateway.js

node --check "$HIER/admin/$DATEI"

echo "1/2 Kopieren"
for ziel in "$R/fahrer-app-lokal/.docker-sync/koordinaten/$DATEI" "$R/trisar/koordinaten/$DATEI" "$R/trisar/admin/$DATEI"; do
  scp -q "$HIER/admin/$DATEI" "$SERVER:$ziel"
done

echo "2/2 Neustart"
ssh "$SERVER" "$DOCKER restart $CONTAINER >/dev/null && sleep 5 && $DOCKER logs --since 10s $CONTAINER 2>&1 | tail -n 5"
echo "Fertig."
