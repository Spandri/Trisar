#!/bin/bash
# Teltonika-Gateway: nachgelieferte alte Pakete (aelter als 10 min, z. B. "Zuendung aus" kurz vor dem Tiefschlaf)
# nicht mehr wegwerfen. Sie gehen in Verlauf, Ereignisse und Zuendung, den Live-Stand ersetzen sie nur, wenn sie
# neuer sind; den Live-Standort nie. Inhalt verworfener Pakete steht im Log (old_records_dropped). 18.11.2026.
# Vom eigenen Mac starten:
#   bash werkzeuge/alte-pakete-ausrollen.sh
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
QUELLE="$HIER/admin/scripts/teltonika-gateway.js"
# Server-Stand vor dieser Aenderung (nach obd-werte-ausrollen.sh). Weicht er ab, erst abgleichen.
VORHER=a62c99dd7d415bfd24466752800d956783c61cab
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
