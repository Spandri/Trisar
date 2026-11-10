#!/bin/bash
# Auto-Status nach Luftlinie ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/status-ausrollen.sh
#
# Migration 20261107070000: die DB-Engine rechnet bei jeder Live-Position die Luftlinie zu
# Abhol- und Zielort (offen -> beim Gast -> unterwegs -> beendet), auch fuer iOS/Android.
# Migration 20261107080000: Auto-Status nur fuer die Fahrt, die gerade dran ist (keine andere
# Fahrt laeuft, Planzeit hoechstens 90 min voraus). Vorher sprangen gleiche Abholorte alle mit.
# Nur DB, keine App-Builds noetig. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
HIER="$(cd "$(dirname "$0")/.." && pwd)"

for m in 20261107070000_status_luftlinie 20261107080000_status_eine_fahrt; do
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
# Einmalig 07.11.: Ralphs Band-Fahrten 22:45 und 01:15, die die Engine faelschlich beendet hat, zurueck.
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"update public.jobs set status = case id when '3f453115-47f1-452a-b606-748f51bac22a' then 'pending' else 'assigned' end where id in ('3f453115-47f1-452a-b606-748f51bac22a', 'e0367a83-451d-4cca-94d6-2a0bf3542a94') and status = 'done' and not exists (select 1 from public.job_status_history h where h.job_id = jobs.id and h.source = 'app' and h.to_status = 'done') returning 'zurueckgesetzt: ' || etd\""
echo "Fertig."
