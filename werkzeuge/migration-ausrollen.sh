#!/bin/bash
# Eine oder mehrere Migrationen auf dem MacBook 2018 einspielen. Vom eigenen Mac starten:
#   bash werkzeuge/migration-ausrollen.sh 20261107130000_orte_automatisch_zuordnen [weitere ...]
# Schon eingespielte werden uebersprungen. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
HIER="$(cd "$(dirname "$0")/.." && pwd)"

[[ $# -ge 1 ]] || { sed -n 3p "$0" | sed 's/^# //'; exit 1; }

for m in "$@"; do
  m="${m%.sql}"
  [[ -f "$HIER/fahrer/supabase/migrations/$m.sql" ]] || { echo "Gibt es nicht: $m"; exit 1; }
  v=${m%%_*}; n=${m#*_}
  if ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from supabase_migrations.schema_migrations where version='$v'\"" | grep -q 1; then
    echo "   $m schon eingespielt"
    continue
  fi
  {
    echo "begin;"
    cat "$HIER/fahrer/supabase/migrations/$m.sql"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n') on conflict do nothing;"
    echo "commit;"
  } | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true
  echo "   $m eingespielt"
done
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"notify pgrst, 'reload schema'\"" >/dev/null
echo "Fertig."
