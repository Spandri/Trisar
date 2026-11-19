#!/bin/bash
# Teltonika-Gateway: Positionen ohne GPS-Fix nicht mehr als Standort uebernehmen (18.11.2026).
# Ohne Fix schickt der Tracker die zuletzt gespeicherte Position weiter (Tracker 2 stand so in Augsburg
# statt in Muenchen). Zuendung, Tempo usw. gehen weiter in die Telemetrie. Vom eigenen Mac starten:
#   bash werkzeuge/gps-fix-ausrollen.sh
# Kein App-Build noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
QUELLE="$HIER/admin/scripts/teltonika-gateway.js"
# Server-Stand vor dieser Aenderung (18.11. 11:45). Weicht er ab, nicht ueberschreiben, erst abgleichen.
VORHER=e34f58f14e9d0f5a10a11ca7ed2a78b0b5af4168
NEU=$(shasum "$QUELLE" | awk '{print $1}')
ZIELE="$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts/teltonika-gateway.js $R/trisar/admin/scripts/teltonika-gateway.js $R/trisar/koordinaten/scripts/teltonika-gateway.js"

for z in $ZIELE; do
  jetzt=$(ssh "$SERVER" "shasum \"$z\"" | awk '{print $1}')
  if [[ "$jetzt" != "$NEU" && "$jetzt" != "$VORHER" ]]; then
    echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch, erst abgleichen."
    exit 1
  fi
done
for z in $ZIELE; do scp -q "$QUELLE" "$SERVER:$z"; done
ssh "$SERVER" "$DOCKER restart fahrer-app-lokal-teltonika-gateway-1 >/dev/null && sleep 40 && $DOCKER logs --since 40s fahrer-app-lokal-teltonika-gateway-1 2>&1 | grep -E 'records_without_fix|locations_written|error' | tail -5"
echo "Fertig. records_without_fix bei Tracker 2 heisst: Position ohne Fix wird nicht mehr uebernommen."
