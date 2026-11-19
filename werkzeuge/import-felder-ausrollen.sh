#!/bin/bash
# Import erkennt alles wie beim manuellen Anlegen (18.11.2026): Zeitraum (etd_bis), Zwischenstopps,
# eigene Orte + Gaeste verknuepfen, Konvoi + mehrere Fahrer, Zugfahrt, Status storniert.
# Aufruf: bash werkzeuge/import-felder-ausrollen.sh
#   1. Funktion dispo-admin: import.ts + importKern.js (laedt beim naechsten Aufruf neu)
#   2. Web-Dispo: ImportView, importKern (Kopie), i18n (6 Sprachen)
# import.ts lokal enthaelt zusaetzlich "think: false" aus einer anderen Session (KI-Umbau). Das geht
# hier NICHT mit raus: die Zeile wird auf den Server-Stand zurueckgesetzt.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=fahrer/supabase/functions/dispo-admin
MUX="-o ControlMaster=auto -o ControlPath=/tmp/trisar-ausrollen-%C -o ControlPersist=120"
ssh() { command ssh $MUX "$@"; }
scp() { command scp $MUX "$@"; }

cmp -s "$HIER/$FN/importKern.js" "$HIER/admin/src/services/importKern.js" || { echo "importKern.js: Server- und Web-Kopie weichen ab. Abbruch."; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sed 's/stream: false, think: false, format/stream: false, format/' "$HIER/$FN/import.ts" > "$TMP/import.ts"

# Erwarteter Server-Stand beim Bauen (Datei: sha1)
pruefen() { # ziel erwartet neu
  local jetzt; jetzt=$(ssh "$SERVER" "shasum \"$1\" 2>/dev/null || true" | awk '{print $1}')
  if [[ "$jetzt" != "$2" && "$jetzt" != "$3" ]]; then echo "Auf dem Server liegt in $1 ein anderer Stand als erwartet. Abbruch."; exit 1; fi
}
sha() { shasum "$1" | awk '{print $1}'; }

FZ=("$R/fahrer-app-lokal/supabase/functions/dispo-admin" "$R/trisar/$FN")
WZ=("$R/fahrer-app-lokal/.docker-sync/admin" "$R/trisar/admin")
declare -a WEB=(
  "src/components/views/ImportView.jsx b24ea2e1294a578b7d81b333c733d9e72bbc3a9f"
  "src/services/importKern.js e6738130439709176a55d77755d69cd4335b58b9"
  "src/i18n/de.js 4da251e9c93340d2a2778ef5b7637a4c4b165b5f"
  "src/i18n/en.js 511c38ea5b3991522742e6792c462b97e5647697"
  "src/i18n/fr.js aebd5f45869a44da49d2bee3ad863ecf7cc19c50"
  "src/i18n/it.js c3e38d8ae4ad092ff0a4c0cfd0749f48ea603970"
  "src/i18n/es.js aa9fc96618c0da1c5f91aac94e196409e4c498c8"
  "src/i18n/tr.js ee2e1022ef95df47d16400d257fe53a1284435b4"
)

echo "Pruefen"
for z in "${FZ[@]}"; do
  pruefen "$z/import.ts" a6e88bbdbe99f7236d335ce4de4cb76733e987b2 "$(sha "$TMP/import.ts")"
  pruefen "$z/importKern.js" e6738130439709176a55d77755d69cd4335b58b9 "$(sha "$HIER/$FN/importKern.js")"
done
for e in "${WEB[@]}"; do
  set -- $e
  for z in "${WZ[@]}"; do
    jetzt=$(ssh "$SERVER" "shasum \"$z/$1\" 2>/dev/null || true" | awk '{print $1}')
    neu=$(sha "$HIER/admin/$1")
    if [[ "$jetzt" != "$neu" && "$jetzt" != "$2" ]]; then echo "Auf dem Server liegt in $z/$1 ein anderer Stand als erwartet. Abbruch."; exit 1; fi
  done
done

echo "1/2 Funktion dispo-admin"
for z in "${FZ[@]}"; do
  scp -q "$TMP/import.ts" "$SERVER:$z/import.ts"
  scp -q "$HIER/$FN/importKern.js" "$SERVER:$z/importKern.js"
done

echo "2/2 Web-Dispo"
for e in "${WEB[@]}"; do
  set -- $e
  for z in "${WZ[@]}"; do scp -q "$HIER/admin/$1" "$SERVER:$z/$1"; done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$1" 2>/dev/null || true
done
echo "Fertig."
