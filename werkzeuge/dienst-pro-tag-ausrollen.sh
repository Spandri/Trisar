#!/bin/bash
# Ein Dienst pro Fahrer und Tag + Dienste je Fahrer in der Web-Dispo (MacBook 2018).
# Vom eigenen Mac starten:
#   bash werkzeuge/dienst-pro-tag-ausrollen.sh
#
# 1. Migration 20261111080000_ein_dienst_pro_tag: neue Dienstanfrage ersetzt den Dienst des Tages,
#    raeumt vorhandene Doppelte auf (der neueste bleibt, abgelehnte bleiben als Verlauf).
# 2. Web-Dispo: Fahrer bearbeiten -> Bereich "Dienste" (aendern, loeschen, hinzufuegen).
# iOS- und Android-Dispo brauchen einen neuen Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
CONTAINER=fahrer-app-lokal-admin-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261111080000_ein_dienst_pro_tag

echo "2/2 Web-Dispo"
for datei in src/components/views/FahrerDienste.jsx src/components/views/FahrerErstellenView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $CONTAINER touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden, Alle Fahrer -> Fahrer bearbeiten -> Dienste."
