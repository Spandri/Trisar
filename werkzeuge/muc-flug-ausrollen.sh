#!/bin/bash
# Kostenlose Flugdaten vom Flughafen Muenchen (17.11.2026) auf dem MacBook 2018 ausrollen.
# Vom eigenen Mac starten:
#   bash werkzeuge/muc-flug-ausrollen.sh
#
# 1. _shared/muc-flughafen.ts (neu): Live-Flugsuche munich-airport.de (gestern bis morgen, auch Codeshare, Gate)
#    und Saisonflugplan-PDF (weiter in der Zukunft, hoechstens einmal am Tag geladen).
# 2. flight-validate: MUC zuerst. Bindet pdf.js fest ein (die Edge Runtime laedt keine Module nach und kennt neue
#    Funktionen erst nach einem Neustart von Supabase) und laedt den Plan auch fuer external-sync., dann wie bisher Lufthansa und aviationstack.
# 3. external-sync: MUC zuerst. Auf dem Server laeuft ein aelterer Stand ohne route_fest, darum wird nur die
#    MUC-Aenderung eingebaut (werkzeuge/muc-flug-einbauen.py), nicht die lokale Datei kopiert.
# 4. Migration 20261117100000: Tabellen muc_flugplan und muc_flugplan_stand.
# Reihenfolge: erst Migration (die Funktionen lesen die Tabellen), dann Funktionen.
# Kein App-Build noetig. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

hat_migration() { ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from supabase_migrations.schema_migrations where version='$1'\"" | grep -q 1; }
migration() { # version name
  local v=$1 n=$2
  if hat_migration "$v"; then echo "   $v schon eingespielt"; return; fi
  {
    echo "begin;"
    cat "$HIER/fahrer/supabase/migrations/${v}_${n}.sql"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n') on conflict do nothing;"
    echo "commit;"
  } | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true
  echo "   $v eingespielt"
}
ziele() { echo "$R/fahrer-app-lokal/$FN/$1" "$R/trisar/fahrer/$FN/$1"; }
kopieren() { # Pfad unter supabase/functions
  for z in $(ziele "$1"); do ssh "$SERVER" "mkdir -p \"$(dirname "$z")\""; scp -q "$HIER/fahrer/$FN/$1" "$SERVER:$z"; done
  echo "   $1"
}

echo "1/4 Migration"
migration 20261117100000 muc_flugplan
# Die REST-Schnittstelle kennt neue Tabellen erst nach dem Neuladen ihres Schemas.
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -q -c \"notify pgrst, 'reload schema'\""

echo "2/4 Edge Functions"
kopieren _shared/muc-flughafen.ts
# flight-validate auf dem Server ist der Stand vor dieser Aenderung (gleich HEAD), darum ganz kopieren.
kopieren flight-validate/index.ts
for z in $(ziele external-sync/index.ts); do
  scp -q "$SERVER:$z" "$ARBEIT/es.ts"
  python3 "$HIER/werkzeuge/muc-flug-einbauen.py" "$HIER/fahrer/$FN/external-sync/index.ts" "$ARBEIT/es.ts"
  scp -q "$ARBEIT/es.ts" "$SERVER:$z"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "3/4 Probe: Flug heute und in drei Wochen (laedt beim ersten Mal den Saisonflugplan)"
SCHLUESSEL=$(ssh "$SERVER" "$DOCKER exec supabase_edge_runtime_fahrer-app-lokal printenv SUPABASE_ANON_KEY")
probe() { # flugnummer datum
  ssh "$SERVER" "curl -s -m 90 -X POST http://127.0.0.1:54321/functions/v1/flight-validate \
    -H 'Authorization: Bearer $SCHLUESSEL' -H 'Content-Type: application/json' \
    -d '{\"flight_number\":\"$1\",\"ride_date\":\"$2\",\"require_lufthansa_group\":false}'" \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); s=d.get("summary") or {}; print("  ", sys.argv[1], sys.argv[2], "->", d.get("valid"), d.get("provider"), s.get("flight_iata"), s.get("departure_airport"), s.get("scheduled_arrival_local"), "T"+str(s.get("arrival_terminal")), d.get("message"))' "$1" "$2"
}
HEUTE=$(TZ=Europe/Berlin date +%Y-%m-%d)
SPAETER=$(TZ=Europe/Berlin date -v+21d +%Y-%m-%d)
probe LH2431 "$HEUTE"
probe EY6070 "$HEUTE"
probe LH2431 "$SPAETER"

echo "4/4 Stand Flugplan"
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Flugplan: ' || coalesce(zeilen::text,'-') || ' Ankuenfte, Datenstand ' || coalesce(datenstand,'-') || coalesce(', Fehler ' || fehler, '') from public.muc_flugplan_stand\""
