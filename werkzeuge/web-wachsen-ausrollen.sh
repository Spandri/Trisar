#!/bin/bash
# Web-Dispo waechst mit dem Bildschirm (19.11.2026). Vom eigenen Mac:
#   bash werkzeuge/web-wachsen-ausrollen.sh
#
# Bisher war die Web-Dispo ueberall eine feste Handy-Spalte von 402 px: auf Laptop/Tablet schmal in der Mitte,
# auf kleinen Handys (360 px) rechts abgeschnitten. Jetzt vergroessert/verkleinert CSS zoom die ganze Seite
# (admin/src/bildschirm.js): Handy fuellt die Breite, Tablet/Laptop bis 1,5-fach, solange 700 px Hoehe bleiben.
# Hoehen (h-dvh, innerHeight) rechnen in App-Pixeln (index.css, FehlerGrenze, StundenExport, DienstePlanenBlatt,
# KiAssistentView), die Karte zeichnet in voller Aufloesung (maplibreKarte.js).
# AlleFahrer.jsx bekommt dieselbe Tastatur-Rechnung, ist hier aber NICHT dabei, weil die Datei noch eine
# fremde, nicht ausgerollte Aenderung hat (Markierung ohne Mehrfachauswahl, 14.11.). Ohne sie ist nur die
# Tastatur-Erkennung in Alle Fahrer auf Handys ungenauer.
# Demo bleibt unveraendert (dort aus, lokal testbar mit ?wachsen=1).
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "Web-Dispo"
for datei in src/bildschirm.js src/main.jsx src/index.css src/components/FehlerGrenze.jsx \
  src/components/views/StundenExport.jsx src/components/views/DienstePlanenBlatt.jsx \
  src/components/views/KiAssistentView.jsx src/shared/karte/maplibreKarte.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  echo "   $datei"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'touch /app/src/main.jsx'"
echo "Fertig. Web-Dispo neu laden, Fenster breiter/schmaler ziehen."
