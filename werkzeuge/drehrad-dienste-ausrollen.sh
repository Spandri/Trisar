#!/bin/bash
# Drehrad in "Dienste planen" ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/drehrad-dienste-ausrollen.sh
#
# Dienste planen: Tipp auf eine Zeit oeffnet das Drehrad wie in der Stundenerfassung (Stunden und
# Minuten in 15-Minuten-Schritten) statt Plus und Minus. Das Drehrad liegt jetzt in ui/ZeitRad.jsx und
# wird von der Stundenerfassung mitbenutzt. Im Drehrad "Nicht senden" bzw. "Pause entfernen".
# Senden geht auch nur mit einer Pause. Ein Fahrer und ein Tag: vorhandener Dienst wird vorausgefuellt
# (shared/dienstBestand.js), gesendet wird nur, was sich aendert. Nur Web-Dispo. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
for datei in src/shared/dienstBestand.js src/components/ui/ZeitRad.jsx src/components/views/FahrerStundenKarten.jsx src/components/views/DienstePlanenBlatt.jsx src/components/views/AlleFahrer.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
echo "Fertig. Dispo neu laden. iOS und Android brauchen einen neuen Build."
