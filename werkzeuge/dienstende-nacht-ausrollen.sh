#!/bin/bash
# Dienstende ueber Mitternacht (18.11.2026) auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/dienstende-nacht-ausrollen.sh
#
# 1. Migration 20261118110000_ortung_offenes_ende: Dienst ohne Ende bleibt fuer die Ortung offen (nicht mehr
#    nur bis Mitternacht), "Arbeitszeit beginnt" nur, wenn noch mindestens 15 Minuten Arbeitszeit sind,
#    ortung_status meldet offenes Ende als null.
# 2. dispo-admin/dienst.ts: KI-Vorschlag nachts "Dienstende heute 01:25 (Dienst vom Di 17.11.)".
# Kein App-Build noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
FN=supabase/functions
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118110000_ortung_offenes_ende

echo "2/2 dispo-admin/dienst.ts"
# Server-Stand vor dieser Aenderung (18.11. 01:30). Weicht er ab, nicht ueberschreiben, erst abgleichen.
VORHER=49d5323f8b6894b8a5cb122bc45e1f0cce32ea4a
NEU=$(shasum "$HIER/fahrer/$FN/dispo-admin/dienst.ts" | awk '{print $1}')
for z in "$R/fahrer-app-lokal/$FN/dispo-admin/dienst.ts" "$R/trisar/fahrer/$FN/dispo-admin/dienst.ts"; do
  jetzt=$(ssh "$SERVER" "shasum \"$z\"" | awk '{print $1}')
  if [[ "$jetzt" == "$NEU" ]]; then continue; fi
  if [[ "$jetzt" != "$VORHER" ]]; then
    echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch, erst abgleichen."
    exit 1
  fi
  scp -q "$HIER/fahrer/$FN/dispo-admin/dienst.ts" "$SERVER:$z"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
ssh "$SERVER" "$DOCKER exec supabase_db_fahrer-app-lokal psql -U postgres -At -c \"select 'ortung_fenster offen: ' || (prosrc ilike '%infinity%') from pg_proc where proname = 'ortung_fenster'\""
echo "Fertig."
