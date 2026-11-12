#!/bin/bash
# KI-Assistent: Stundenlohn setzen und nachschauen ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-lohn-ausrollen.sh
#
# dispo-admin mit lohn.ts (neu), ki.ts, kiKern.js, dienst.ts, index.ts. Kein App-Build noetig,
# die Rueckfrage "ja/nein" laeuft ueber den Gespraechs-Kontext in Web, iOS und Android.
# Voraussetzung: Migration 20261112040000_stundenlohn_einsatzkosten (Spalte profiles.stundenlohn).
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

if ! ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from information_schema.columns where table_name='profiles' and column_name='stundenlohn'\"" | grep -q 1; then
  echo "Die Spalte profiles.stundenlohn fehlt. Erst die Migration 20261112040000_stundenlohn_einsatzkosten einspielen."
  exit 1
fi

for d in lohn.ts ki.ts index.ts dienst.ts kiKern.js; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Probe im Chat: „Gib allen Fahrern 30 € Stundenlohn“, dann „ja“."
