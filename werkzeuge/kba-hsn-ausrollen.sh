#!/bin/bash
# HSN/TSN + KBA-Typliste + VIN-Regeln (18.11.2026) auf den 2018.
# Aufruf: bash werkzeuge/kba-hsn-ausrollen.sh
#   1. Migrationen kba_typen (Tabellen, Trigger, Regeln) und kba_typen_daten (37.852 KBA-Typen, ~6 MB)
#   2. Web-Dispo: Fahrzeug-Formular mit HSN/TSN. Nur wenn der Server noch den erwarteten Stand hat.
set -euo pipefail
SERVER=100.94.169.59
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
MUX="-o ControlMaster=auto -o ControlPath=/tmp/trisar-ausrollen-%C -o ControlPersist=120"
ssh() { command ssh $MUX "$@"; }
scp() { command scp $MUX "$@"; }

DATEI=src/components/views/FahrzeugErstellenView.jsx
VORHER=b9daf3e2146bb7b4455b692f1c65d60fef4ba71a   # Server-Stand beim Bauen

echo "1/2 Migrationen"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118220000_kba_typen 20261118220100_kba_typen_daten

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
