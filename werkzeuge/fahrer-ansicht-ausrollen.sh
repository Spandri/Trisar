#!/bin/bash
# Fahrer-Ansicht in der Web-Dispo (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/fahrer-ansicht-ausrollen.sh
#
# Klick auf einen Fahrer (Alle Fahrer) oeffnet seinen Ablauf (Fahrten), Dienste und Stunden
# statt "Fahrer bearbeiten". Stammdaten ueber den Knopf "Fahrer bearbeiten" oder Wischen.
# Nur Web-Dateien, keine Datenbank-Aenderung. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
CONTAINER=fahrer-app-lokal-admin-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

for datei in src/services/supabase.js src/components/AnmeldeTor.jsx src/components/FehlerGrenze.jsx src/main.jsx src/components/views/FahrerStundenKarten.jsx src/components/views/FahrerAnsichtView.jsx src/components/views/AnkuenfteView.jsx src/components/views/AlleFahrer.jsx src/App.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $CONTAINER touch /app/$datei" 2>/dev/null || true
done
echo "Fertig. Dispo neu laden, Alle Fahrer -> Fahrer antippen."
