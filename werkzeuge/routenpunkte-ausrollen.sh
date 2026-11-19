#!/bin/bash
# Route bearbeiten (15.11.), Server-Teil auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/routenpunkte-ausrollen.sh
#
# 1. Migration 20261115130000: jobs.routen_punkte, Route neu rechnen bei neuen Punkten, Punkte weg bei neuen Adressen
#    Migration 20261116100000: jobs.route_fest (freigegebene Route der Dispo, genau so fuer den Fahrer)
# 2. Edge Functions: tomtom-routing (Route ueber Routenpunkte), external-sync (Spalte + Cache-Schluessel),
#    places-proxy (aktion route_vorschau fuer den Routen-Editor, aktion navi_route fuer die eigene
#    Navigation der Fahrer-App seit 16.11.), dann Edge Runtime neu starten
# Web (Dispo/Fahrer) und Apps sind NICHT dabei. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

migration() { # version name
  local v=$1 n=$2
  if ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from supabase_migrations.schema_migrations where version='$v'\"" | grep -q 1; then
    echo "   $v schon eingespielt"
    return
  fi
  {
    echo "begin;"
    cat "$HIER/fahrer/supabase/migrations/${v}_${n}.sql"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n') on conflict do nothing;"
    echo "commit;"
  } | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true
  echo "   $v eingespielt"
}

echo "1/3 Migration Routenpunkte und freigegebene Route"
migration 20261115130000 routen_punkte
migration 20261116100000 route_fest
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Spalte: ' || count(*) from information_schema.columns where table_name='jobs' and column_name='routen_punkte'\""

echo "2/3 Edge Functions kopieren"
for d in _shared/tomtom-routing.ts external-sync/index.ts places-proxy/index.ts; do
  for ziel in "$R/fahrer-app-lokal/supabase/functions/$d" "$R/trisar/fahrer/supabase/functions/$d"; do
    scp -q "$HIER/fahrer/supabase/functions/$d" "$SERVER:$ziel"
  done
done

echo "3/3 Edge Runtime neu starten"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8 && $DOCKER logs --tail 5 supabase_edge_runtime_fahrer-app-lokal 2>&1"
echo "Fertig."
