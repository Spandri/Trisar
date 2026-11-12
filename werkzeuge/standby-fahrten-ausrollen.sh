#!/bin/bash
# Standby-Fahrten in Alle Fahrten ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/standby-fahrten-ausrollen.sh
#
# Faehrt ein Fahrer vom Event los, steht in der Dispo unter Alle Fahrten eine "Standby-Fahrt" mit
# Abfahrtszeit und Status Unterwegs, auf dem Rueckweg mit Ankunftszeit am Event, danach "Zurück".
# Dazu: Standby-Formular mit Notizfeld wie Fahrt hinzufuegen und "Fahrer #1, #2 ...".
# Datenbank: standby_ereignis live (Realtime). Nur Web-Dispo. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Datenbank"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112070000_standby_ereignis_live

echo "2/2 Web-Dispo"
for datei in src/shared/standby.js src/components/ui/StandbyFahrten.jsx src/components/views/AnkuenfteView.jsx src/components/views/StandbyAdd.jsx src/components/views/StandbyView.jsx src/App.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden."
