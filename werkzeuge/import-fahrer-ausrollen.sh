#!/bin/bash
# Import-Verbesserungen ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/import-fahrer-ausrollen.sh
#
# - Spalte "Chauffeur"/"Fahrer": Fahrer wird zugeordnet ("Conrad S." -> Conrad, "Fahrer 3" -> Nummer 3)
# - Spalte "Ankunft": gleicher Fahrer + gleiche Ankunft + gleiches Ziel = eine Fahrt mit Zwischenstopps
# - Weitere Blaetter mit eigenen Fahrten (z. B. "Band Alphaville") kommen automatisch mit,
#   Blaetter, die nur dieselben Fahrten anders zeigen (z. B. "Shuttleplan"), bleiben weg
# - Alte Spaltenvorlagen bekommen Fahrer und Ankunft automatisch dazu
# 1. dispo-admin (import.ts, importKern.js)   2. Web-Dispo (Import-Ansicht, Texte)
# Keine Migration noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN="fahrer/supabase/functions/dispo-admin"

if ! cmp -s "$HIER/$FN/importKern.js" "$HIER/admin/src/services/importKern.js"; then
  echo "importKern.js weicht ab: $FN/importKern.js nach admin/src/services/ kopieren und neu starten."
  exit 1
fi

echo "1/2 Funktion dispo-admin"
for datei in import.ts importKern.js; do
  for ziel in "$R/fahrer-app-lokal/supabase/functions/dispo-admin" "$R/trisar/$FN"; do
    scp -q "$HIER/$FN/$datei" "$SERVER:$ziel/$datei"
  done
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
for datei in src/components/views/ImportView.jsx src/services/importKern.js src/i18n/de.js src/i18n/en.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei" 2>/dev/null || true
  echo "   $datei"
done
echo "Fertig. Dispo neu laden, Fahrten importieren."
