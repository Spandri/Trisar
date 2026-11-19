#!/bin/bash
# KBA-Sitze als Beifahreranzahl (Sitze - 1), 18.11.2026, auf den 2018.
# Aufruf: bash werkzeuge/kba-beifahrer-ausrollen.sh
#   1. Migration kba_beifahrer (Trigger und Regel-Standards)
#   2. Web-Dispo: Formular fuellt Beifahreranzahl = KBA-Sitze - 1
set -euo pipefail
SERVER=100.94.169.59
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
MUX="-o ControlMaster=auto -o ControlPath=/tmp/trisar-ausrollen-%C -o ControlPersist=120"
ssh() { command ssh $MUX "$@"; }
scp() { command scp $MUX "$@"; }

DATEI=src/components/views/FahrzeugErstellenView.jsx
VORHER=a4f846976daa865b158c970706ffb34702fb19c3   # Server-Stand nach kba-hsn-ausrollen.sh

echo "1/2 Migrationen"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118230000_kba_beifahrer

echo "2/2 Web-Dispo Fahrzeug-Formular"
NEU=$(shasum "$HIER/admin/$DATEI" | awk '{print $1}')
for z in "$R/fahrer-app-lokal/.docker-sync/admin/$DATEI" "$R/trisar/admin/$DATEI"; do
  jetzt=$(ssh "$SERVER" "shasum \"$z\" 2>/dev/null || true" | awk '{print $1}')
  if [[ "$jetzt" != "$VORHER" && "$jetzt" != "$NEU" ]]; then
    echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch."; exit 1
  fi
done
for z in "$R/fahrer-app-lokal/.docker-sync/admin/$DATEI" "$R/trisar/admin/$DATEI"; do
  scp -q "$HIER/admin/$DATEI" "$SERVER:$z"
done
ssh "$SERVER" "/usr/local/bin/docker exec supabase_db_fahrer-app-lokal psql -U postgres -At -c 'select count(*) from public.kba_typen'" | sed 's/^/   KBA-Typen: /'
echo "Fertig."
