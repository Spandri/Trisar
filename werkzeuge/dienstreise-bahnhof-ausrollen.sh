#!/bin/bash
# Dienstreise: Halte vom Ticket als Bahnhof orten (19.11.2026). Vom eigenen Mac:
#   bash werkzeuge/dienstreise-bahnhof-ausrollen.sh
#
# Vorher wurde jeder Halt wie eine Adresse gesucht: "München-Trudering" ergab den Stadtteil, nicht den Bahnhof.
# Server: train-validate kennt den Modus halt_orten (Name -> Bahnhof mit Koordinaten der Bahn, Rueckfall Stationsdaten
#   mit Platzhalter "*Trudering*"). Ergebnisse landen in bahnhof_ort, jeder Bahnhof nur einmal bei der Bahn.
# Web-Dispo: Start eines Zug-/S-Bahn-/U-Bahn-/Tram-/Busabschnitts und das Ziel vom Ticket werden zuerst als Bahnhof
#   gesucht, dann "Bahnhof …" in der Adresssuche, eigener Ort hat Vorrang (DienstreiseAdd.jsx, dienstreise.js).
# iOS- und Android-Dispo brauchen dafuer einen neuen Build.
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions

echo "1/2 Edge Function"
for d in train-validate/index.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
for datei in src/components/views/DienstreiseAdd.jsx src/shared/dienstreise.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'touch /app/$datei'"
  echo "   $datei"
done
echo "Fertig. Dienstreise mit Ticket anlegen: Halte wie „München-Trudering“ landen am Bahnhof."
