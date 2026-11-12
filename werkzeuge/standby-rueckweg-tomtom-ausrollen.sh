#!/bin/bash
# Standby-Rueckweg: Ankunft zurueck am Event rechnet der Server mit TomTom (MacBook 2018).
#   bash werkzeuge/standby-rueckweg-tomtom-ausrollen.sh
#
# 1. Datenbank: standby_fahrer.rueck_ankunft/rueck_minuten/rueck_sync, Trigger rufen external-sync
#    (hoechstens alle 45 s je Fahrer auf dem Rueckweg).
# 2. external-sync (index.ts): aktion standby_rueckweg fragt TomTom mit Verkehr.
# 3. Web-Dispo: liest die Ankunft vom Server statt selbst TomTom zu fragen.
# iOS und Android brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/external-sync

echo "1/3 Datenbank"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112130000_standby_rueckweg_tomtom

echo "2/3 external-sync"
scp -q "$HIER/fahrer/$FN/index.ts" "$SERVER:$R/fahrer-app-lokal/$FN/index.ts"
scp -q "$HIER/fahrer/$FN/index.ts" "$SERVER:$R/trisar/fahrer/$FN/index.ts"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "3/3 Web-Dispo"
for datei in src/shared/standby.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden. iOS und Android brauchen einen neuen Build."
