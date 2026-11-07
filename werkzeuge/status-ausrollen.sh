#!/bin/bash
# Auto-Status nach Luftlinie ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/status-ausrollen.sh
#
# Migration 20261107070000: die DB-Engine rechnet bei jeder Live-Position die Luftlinie zu
# Abhol- und Zielort (offen -> beim Gast -> unterwegs -> beendet), auch fuer iOS/Android.
# Nur DB, keine App-Builds noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
HIER="$(cd "$(dirname "$0")/.." && pwd)"

for m in 20261107070000_status_luftlinie; do
  v=${m%%_*}; n=${m#*_}
  if ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from supabase_migrations.schema_migrations where version='$v'\"" | grep -q 1; then
    echo "$m schon eingespielt"
    continue
  fi
  {
    echo "begin;"
    cat "$HIER/fahrer/supabase/migrations/$m.sql"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n') on conflict do nothing;"
    echo "commit;"
  } | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true
  echo "$m eingespielt"
done

ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Luftlinie Test (soll ca. 72 m): ' || public.trisar_luftlinie_m(48.104947, 11.607077, 48.10495, 11.608052)\""
echo "Fertig."
