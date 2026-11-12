#!/bin/bash
# Web-Dispo ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/listen-schneller-ausrollen.sh
#
# - Fahrten: Nebentabellen werden gleichzeitig statt nacheinander geladen.
# - Fahrzeugliste: letzter Stand bleibt gemerkt, beim Oeffnen kein Leerstart.
# - Fahrer bearbeiten: Abschnitt "Dienste" entfernt.
# Nur Web-Dispo, keine Datenbank. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
for datei in src/App.jsx src/components/views/FahrzeugeView.jsx src/components/views/FahrerErstellenView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden."
