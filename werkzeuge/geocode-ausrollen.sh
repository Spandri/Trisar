#!/bin/bash
# Adresssuche der Routenberechnung: eigene Orte und Flughaefen fest (MacBook 2018).
#   bash werkzeuge/geocode-ausrollen.sh
# Kopiert _shared/tomtom-routing.ts, startet die Edge Functions neu, loescht falsch gemerkte
# Flughafen-Treffer aus dem Cache (Adresssuche UND ganze Routen, die cachen die Adressen mit) und rechnet offene Fahrten mit Flughafen oder eigenem Ort neu.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
D=supabase/functions/_shared/tomtom-routing.ts

echo "1/3 Kopieren und Edge Functions neu starten"
scp -q "$HIER/fahrer/$D" "$SERVER:$R/fahrer-app-lokal/$D"
scp -q "$HIER/fahrer/$D" "$SERVER:$R/trisar/fahrer/$D"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/3 Cache bereinigen"
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"delete from public.api_route_cache where origin_address ~* '(flughafen|airport|terminal|\\mMUC\\M|\\mFRA\\M|\\mNUE\\M|\\mBER\\M|\\mFMM\\M|kongress)' or destination_address ~* '(flughafen|airport|terminal|\\mMUC\\M|\\mFRA\\M|\\mNUE\\M|\\mBER\\M|\\mFMM\\M|kongress)' returning provider\"" | sort | uniq -c | sed 's/^/   weg: /'

echo "3/3 Offene Fahrten neu rechnen"
ssh "$SERVER" 'K=$('"$DOCKER"' exec supabase_edge_runtime_fahrer-app-lokal printenv SUPABASE_SERVICE_ROLE_KEY)
IDS=$('"$DOCKER"' exec '"$DB"' psql -U postgres -At -c "select coalesce(json_agg(id), '"'"'[]'"'"') from public.jobs where ride_date >= current_date and lower(coalesce(status, '"'"''"'"')) not in ('"'"'done'"'"','"'"'cancelled'"'"','"'"'completed'"'"') and (pickup_address ~* '"'"'(flughafen|airport|terminal|muc)'"'"' or dropoff_address ~* '"'"'(flughafen|airport|terminal|muc)'"'"' or pickup_ort_id is not null or dropoff_ort_id is not null)")
curl -s -m 180 -X POST http://127.0.0.1:54321/functions/v1/external-sync -H "Authorization: Bearer $K" -H "apikey: $K" -H "content-type: application/json" -d "{\"reason\":\"manual_refresh\",\"force_refresh\":true,\"job_ids\":$IDS}" | grep -o "\"route\":\"[a-z]*\"" | sort | uniq -c'
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select etd || ' ' || pickup_address || ' -> ' || round((ext_route_payload->'von'->>'lat')::numeric, 4) || ',' || round((ext_route_payload->'von'->>'lon')::numeric, 4) || ' (' || coalesce(ext_route_distance_m, 0) / 1000 || ' km)' from public.jobs where ride_date >= current_date and pickup_address ~* '(flughafen|terminal|muc)'\""
echo "Fertig."
