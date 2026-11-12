#!/bin/bash
# Stundenerfassung (Figma 2837-12573, 2838-12842, 2823-12431) in Verlauf und Startseite der Web-Fahrer-App ausrollen (MacBook 2018).
# Vom eigenen Mac starten:
#   bash werkzeuge/verlauf-heute-ausrollen.sh
#
# Karte "Stundenerfassung" unter dem heutigen Datum: Start, begonnene Pausen, Ende nach dem Dienst,
# darunter die laufende Arbeitszeit. Erscheint nur, wenn der Fahrer heute einen angenommenen Dienst hat,
# der schon begonnen hat, und die Stundenerfassung fuer ihn an ist.
# Keine Migration noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
CONTAINER=fahrer-app-lokal-fahrer-1
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

for datei in src/features/fahrer/views/Stunden.jsx src/features/fahrer/views/Verlauf.jsx src/features/fahrer/views/FahrtenScreen01View.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
    scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec $CONTAINER touch /app/$datei"
  echo "   $datei"
done
echo "Fertig. Fahrer-App neu laden, dann Profil > Verlauf."
