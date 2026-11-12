#!/bin/bash
# Fahrer-Ansicht der Web-Dispo ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/fahrer-ablauf-ausrollen.sh
#
# - Ablauf wie der Verlauf der Fahrer-App: Dienststart, Fahrten, Pausenstart/-ende (grau), Dienstende,
#   darunter die Stundenerfassung (auch bestaetigte).
# - Oben rechts Export-Kreis statt "Fahrer bearbeiten": alle Stunden des Fahrers als Excel.
# - Alle Fahrer: Export-Kreis oben rechts, Zeitraum und Fahrer waehlbar.
# - Die Seite "Alle Stunden, Pausen, Excel" (FahrerStunden.jsx) wird entfernt.
# Nur Web-Dispo, keine Datenbank. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
V=src/components/views
for datei in $V/StundenExport.jsx $V/FahrerStundenKarten.jsx $V/FahrerAnsichtView.jsx $V/AlleFahrer.jsx $V/FahrerErstellenView.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
  echo "   admin/$datei"
done
ssh "$SERVER" "rm -f '$R/fahrer-app-lokal/.docker-sync/admin/$V/FahrerStunden.jsx' '$R/trisar/admin/$V/FahrerStunden.jsx'"
echo "   admin/$V/FahrerStunden.jsx entfernt"
echo "Fertig. Dispo neu laden. iOS und Android brauchen einen neuen Build."
