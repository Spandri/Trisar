#!/bin/bash
# Fahrerblatt der Dispo-Karte ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/dispo-blatt-ausrollen.sh
#
# Blatt nach Tipp auf einen Fahrer: "Markieren" weg, erst Name, dann Auto mit Kennzeichen,
# oeffnet so weit, dass der Name zu sehen ist. Ohne naechste Fahrt steht "Keine Fahrt geplant".
# Nur Web-Dispo, keine Datenbank. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
for datei in src/components/views/KartenView.jsx src/i18n/de.js src/i18n/en.js src/i18n/fr.js src/i18n/es.js src/i18n/it.js src/i18n/tr.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden."
