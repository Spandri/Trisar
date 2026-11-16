#!/bin/bash
# Dienstreise: Linien je Abschnitt ueber dispo-admin statt eigener Function (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/dienstreise7-ausrollen.sh
# Die Function abschnitt-linie aus dienstreise6 kennt die lokale Supabase erst nach einem vollen Neustart,
# darum rechnet jetzt dispo-admin (Aktion abschnitt_linie). Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 dispo-admin"
for d in supabase/functions/dispo-admin/index.ts supabase/functions/dispo-admin/linie.ts; do
  for ziel in "$R/fahrer-app-lokal/$d" "$R/trisar/fahrer/$d"; do
    scp -q "$HIER/fahrer/$d" "$SERVER:$ziel"
  done
done
# Ungenutzte Function aus dienstreise6 wieder weg.
ssh "$SERVER" "rm -rf '$R/fahrer-app-lokal/supabase/functions/abschnitt-linie' '$R/trisar/fahrer/supabase/functions/abschnitt-linie'; \
  $DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261114050000_abschnitt_linie_dispo_admin
sleep 10
ssh "$SERVER" "$DOCKER exec supabase_db_fahrer-app-lokal psql -U postgres -At -c \
  \"select art, nummer, coalesce(jsonb_array_length(linie), 0) as punkte from dienstreise_abschnitt where art in ('bus','ubahn','tram') order by dienstreise_id, reihenfolge\" \
  -c \"select status_code, left(content::text, 160) from net._http_response order by created desc limit 1\""
echo "Fertig. Punkte 0 = Linie fehlt."
