#!/bin/bash
# Liest Tabellen, Trigger, Funktionen, Realtime und Policies aus der Live-DB (MacBook 2018), nur lesend.
#   bash werkzeuge/architektur/db-auslesen.sh
set -euo pipefail
HIER="$(cd "$(dirname "$0")" && pwd)"
SERVER=100.94.169.59
DB=supabase_db_fahrer-app-lokal
ssh "$SERVER" "/usr/local/bin/docker exec -i $DB psql -U postgres -At -v ON_ERROR_STOP=1 -c 'set default_transaction_read_only = on' -f -" < "$HIER/db-abfrage.sql" | tail -n 1 > "$HIER/roh/db.json"
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print('DB:', len(d['tabellen']), 'Tabellen,', len(d['trigger']), 'Trigger,', len(d['funktionen']), 'Funktionen')" "$HIER/roh/db.json"
