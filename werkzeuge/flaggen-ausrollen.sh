#!/bin/bash
# Fahrer-Flaggen ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/flaggen-ausrollen.sh
#
# 1. Migration 20261112090000_fahrer_flagge (profiles.flagge, nur Dispo darf setzen)
# 2. Web-Dispo: Flaggen-Knoepfe auf Karte und in Alle Fahrer, Flagge an Marker und Fahrerkarte
# iOS- und Android-Dispo brauchen einen neuen Build.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112090000_fahrer_flagge

kopieren() { # datei relativ zu admin/
  local datei="$1"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    ssh "$SERVER" "mkdir -p \"\$(dirname \"$ziel\")\""
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'mkdir -p \"\$(dirname /app/$datei)\" && touch /app/$datei'"
}

echo "2/2 Web-Dispo"
for d in src/shared/flaggen.js src/components/ui/FlaggenKnoepfe.jsx src/shared/karte/maplibreKarte.js \
  src/components/views/KartenView.jsx src/components/views/AlleFahrer.jsx \
  src/shared/fahrerMarkierung.js src/components/ui/MarkierungsVermerk.jsx \
  src/shared/dienstBestand.js src/components/views/DienstePlanenBlatt.jsx \
  public/icon/_Icon_Flaggen/Flagge_1.svg public/icon/_Icon_Flaggen/Flagge_1_Voll.svg \
  public/icon/_Icon_Flaggen/Flagge_2.svg public/icon/_Icon_Flaggen/Flagge_2_Voll.svg \
  public/icon/_Icon_Flaggen/Flagge_3.svg public/icon/_Icon_Flaggen/Flagge_3_Voll.svg \
  public/icon/_Icon_Flaggen/Flagge_Kreis.svg; do
  kopieren "$d"
done
echo "Fertig."
