#!/bin/bash
# Routenberechnung beim Anlegen jeder Fahrt (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/route-anlegen-ausrollen.sh
# Traegt den Server-Schluessel der Edge Functions in integration_settings ein (ohne ihn anzuzeigen)
# und spielt die Migration 20261107150000_route_beim_anlegen ein.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Schluessel"
ssh "$SERVER" 'K=$('"$DOCKER"' exec supabase_edge_runtime_fahrer-app-lokal printenv SUPABASE_SERVICE_ROLE_KEY); [ -n "$K" ] || { echo "Schluessel nicht gefunden"; exit 1; }; '"$DOCKER"' exec -i '"$DB"' psql -U postgres -q -v ON_ERROR_STOP=1 -v k="$K" <<SQL
insert into public.integration_settings (key, value) values ('"'"'edge_service_role_key'"'"', to_jsonb(:'"'"'k'"'"'::text))
on conflict (key) do update set value = excluded.value;
SQL
echo "   eingetragen"'

echo "2/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261107150000_route_beim_anlegen
