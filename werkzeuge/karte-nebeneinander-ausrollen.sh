#!/bin/bash
# Dispo-Karte: Fahrer am gleichen Ort nebeneinander statt uebereinander (19.11.2026), Web-Dispo auf den 2018.
# Aufruf: bash werkzeuge/karte-nebeneinander-ausrollen.sh
# Nur zwei Dateien, nur wenn der Server noch den Stand beim Bauen hat. iOS/Android kommen per Build.
set -euo pipefail
SERVER=100.94.169.59
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
MUX="-o ControlMaster=auto -o ControlPath=/tmp/trisar-ausrollen-%C -o ControlPersist=120"
ssh() { command ssh $MUX "$@"; }
scp() { command scp $MUX "$@"; }
DATEIEN=("src/components/views/KartenView.jsx b3ba8b71626e8b77854917b9408713bb2d80eb9d" "src/shared/karte/maplibreKarte.js 6c3208cbf25cd1c505eef98a5ad008ed8f142ebb")
for e in "${DATEIEN[@]}"; do
  set -- $e
  neu=$(shasum "$HIER/admin/$1" | awk '{print $1}')
  for z in "$R/fahrer-app-lokal/.docker-sync/admin/$1" "$R/trisar/admin/$1"; do
    jetzt=$(ssh "$SERVER" "shasum \"$z\" 2>/dev/null || true" | awk '{print $1}')
    [[ "$jetzt" == "$2" || "$jetzt" == "$neu" ]] || { echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch."; exit 1; }
  done
done
for e in "${DATEIEN[@]}"; do
  set -- $e
  for z in "$R/fahrer-app-lokal/.docker-sync/admin/$1" "$R/trisar/admin/$1"; do scp -q "$HIER/admin/$1" "$SERVER:$z"; done
  ssh "$SERVER" "/usr/local/bin/docker exec fahrer-app-lokal-admin-1 touch /app/$1" 2>/dev/null || true
done
echo "Fertig."
