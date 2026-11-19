#!/bin/bash
# Teltonika-Gateway: letzte OBD-Werte (km, Tank, VIN ...) bleiben stehen, wenn ein Paket keine OBD-Werte hat
# (Motor aus, unter 13,3 V fragt der Tracker nicht ab). Geloescht wird nur bei anderer VIN, Drehzahl/Tempo/Last
# nur ohne frische OBD-Daten (18.11.2026). Vom eigenen Mac starten:
#   bash werkzeuge/obd-werte-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
QUELLE="$HIER/admin/scripts/teltonika-gateway.js"
# Server-Stand vor dieser Aenderung (nach fahrzeug-vin-ausrollen.sh). Weicht er ab, erst abgleichen.
VORHER=038557082317563d8fc21e80f24a284167bd1f98
NEU=$(shasum "$QUELLE" | awk '{print $1}')
ZIELE="$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts/teltonika-gateway.js $R/trisar/admin/scripts/teltonika-gateway.js $R/trisar/koordinaten/scripts/teltonika-gateway.js"
for z in $ZIELE; do
  jetzt=$(ssh "$SERVER" "shasum \"$z\"" | awk '{print $1}')
  if [[ "$jetzt" != "$NEU" && "$jetzt" != "$VORHER" ]]; then
    echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch, erst abgleichen."; exit 1
  fi
done
for z in $ZIELE; do scp -q "$QUELLE" "$SERVER:$z"; done
ssh "$SERVER" "$DOCKER restart fahrer-app-lokal-teltonika-gateway-1 >/dev/null && sleep 30 && $DOCKER logs --since 30s fahrer-app-lokal-teltonika-gateway-1 2>&1 | grep -E 'health_server_started|error' | tail -3"
echo "Fertig."
