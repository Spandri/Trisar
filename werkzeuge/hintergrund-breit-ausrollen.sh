#!/bin/bash
# Web-Dispo: Hintergrund ueber den ganzen Bildschirm statt schwarzer Raender (19.11.2026). Vom eigenen Mac:
#   bash werkzeuge/hintergrund-breit-ausrollen.sh
#
# - Der Verlauf der sichtbaren Ansicht liegt als ein Lauf ueber dem ganzen Bildschirm, ohne Kante am
#   Spaltenrand (admin/src/hintergrundBreit.js, haengt sich selbst ein, App.jsx bleibt unberuehrt).
#   Gilt auch fuer Vollbild-Fenster wie den Filter. Ansichten mit Karte bleiben schwarz.
# - Fix: auf schmalen Handys (z. B. 360 px) war die Spalte nach dem ersten Ausrollen wieder rechts
#   abgeschnitten (100vw wurde mitgezoomt). Jetzt rechnet die Spalte mit --app-w.
# Demo bleibt unveraendert. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "Web-Dispo"
for datei in src/hintergrundBreit.js src/bildschirm.js src/index.css src/main.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  echo "   $datei"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'touch /app/src/main.jsx'"
echo "Fertig. Web-Dispo neu laden."
