#!/bin/bash
# Echte Abfahrt und Ankunft je Fahrt (18.11.2026) auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/echte-zeiten-ausrollen.sh
#
# 1. Migration 20261118100000_echte_zeiten: jobs.abfahrt_echt/abfahrt_quelle/ankunft_echt/ankunft_erwartet,
#    Trigger beim Statuswechsel, GPS-Abfahrt und Live-Ankunft (trisar_fahrt_live auf driver_live_locations),
#    Fahrer-Historie (verlauf_fahrten) mit echten Zeiten, Nachtrag der letzten 60 Tage.
# 2. external-sync: Schalter nur_ziel (nur Anfahrt Fahrer -> Ziel). Nur diese Stelle wird eingebaut
#    (werkzeuge/nur-ziel-einbauen.py), die Datei wird nicht kopiert.
# 3. Web-Dispo App.jsx: nur die Zeit-Stellen (werkzeuge/echte-zeiten-einbauen.py). Die lokale App.jsx hat
#    noch Routen-Aenderungen der Dispo, die auf dem Server nicht ausgerollt sind.
# 4. Probe: Spalten, Trigger, Joris' Fahrt vom 17.11.
# iOS- und Android-Dispo brauchen einen neuen Build. Fahrer-Historie in allen Apps kommt aus der Datenbank.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
FN=supabase/functions
HIER="$(cd "$(dirname "$0")/.." && pwd)"
ARBEIT=$(mktemp -d)
trap 'rm -rf "$ARBEIT"' EXIT

echo "1/4 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118100000_echte_zeiten
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -q -c \"notify pgrst, 'reload schema'\""

echo "2/4 external-sync: nur_ziel"
for z in "$R/fahrer-app-lokal/$FN/external-sync/index.ts" "$R/trisar/fahrer/$FN/external-sync/index.ts"; do
  scp -q "$SERVER:$z" "$ARBEIT/es.ts"
  python3 "$HIER/werkzeuge/nur-ziel-einbauen.py" "$ARBEIT/es.ts"
  scp -q "$ARBEIT/es.ts" "$SERVER:$z"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "3/4 Web-Dispo"
for z in "$R/fahrer-app-lokal/.docker-sync/admin/src/App.jsx" "$R/trisar/admin/src/App.jsx"; do
  scp -q "$SERVER:$z" "$ARBEIT/App.jsx"
  python3 "$HIER/werkzeuge/echte-zeiten-einbauen.py" "$ARBEIT/App.jsx"
  scp -q "$ARBEIT/App.jsx" "$SERVER:$z"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/src/App.jsx"

echo "4/4 Probe"
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -c \"select
  (select count(*) from information_schema.columns where table_name = 'jobs' and column_name in ('abfahrt_echt','abfahrt_quelle','ankunft_echt','ankunft_erwartet')) as spalten,
  (select count(*) from pg_trigger where tgname in ('trg_jobs_echte_zeiten','trg_fahrt_live')) as trigger,
  (select count(*) from public.jobs where abfahrt_echt is not null) as fahrten_mit_abfahrt\""
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -c \"select status,
  to_char(abfahrt_echt at time zone 'Europe/Berlin', 'HH24:MI') abfahrt, abfahrt_quelle,
  to_char(ankunft_echt at time zone 'Europe/Berlin', 'HH24:MI') ankunft
  from public.jobs where id = 'cfb146d3-c356-43c6-9aa5-1c1e2c058775'\""
ssh "$SERVER" "$DOCKER exec supabase_edge_runtime_fahrer-app-lokal sh -c 'grep -c nurZiel /home/deno/functions/external-sync/index.ts 2>/dev/null || true'"
echo "Fertig. Joris' Fahrt (17.11.) soll Abfahrt 21:13 (gps), Ankunft 22:12 zeigen."
