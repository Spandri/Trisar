#!/bin/bash
# Befunde aus dem Test vom 16.11. (Screenshots Fahrer-App und KI-Assistent) auf dem MacBook 2018 ausrollen.
# Vom eigenen Mac starten:
#   bash werkzeuge/flug-buchung-ausrollen.sh
#
# 1. KI-Assistent (dispo-admin): "zu einer unbestimmten Zeit" wird nicht mehr Ziel und Gast, Gastname endet vor der
#    Strecke, "zwischen 15 und 16 Uhr" wird ein Start Zeitraum (startZeitBis), zweite Fahrt im selben Satz wird
#    genannt statt still verworfen, Nachname aus zwei Woertern ("Joris Worm Moser"), Adresssuche bevorzugt die
#    Gegend der Flotte und nimmt keinen Treffer, der nichts mit dem Text zu tun hat.
# 2. external-sync: Schalter nur_flug (nur Flugstatus und Position, keine Routen).
# 3. Migration 20261116150000: Flug-Herkunft mit Stadt ("Köln/Bonn (CGN)" statt "CGN"), Tabelle flughafen_orte.
#    Migration 20261116151000: Flugposition regelmaessig holen (Trigger auf Fahrer-Standort, ruft external-sync).
# Reihenfolge wichtig: erst die Funktionen, dann die Migrationen (der Trigger braucht nur_flug).
# Kein App-Build noetig. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions

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
kopieren() { # Pfad unter supabase/functions
  scp -q "$HIER/fahrer/$FN/$1" "$SERVER:$R/fahrer-app-lokal/$FN/$1"
  scp -q "$HIER/fahrer/$FN/$1" "$SERVER:$R/trisar/fahrer/$FN/$1"
  echo "   $1"
}

echo "1/3 Edge Functions"
for d in ki.ts kiKern.js glaetten.ts namenAngleichen.ts ortSuche.ts; do kopieren "dispo-admin/$d"; done
# external-sync liest lokal schon jobs.route_fest (Navigation). Ohne die Spalte wuerde der Abgleich scheitern.
if hat_migration 20261116100000; then
  kopieren external-sync/index.ts
elif ssh "$SERVER" "grep -q 'nur_flug' $R/trisar/fahrer/$FN/external-sync/index.ts"; then
  echo "   external-sync: nur_flug ist schon da (Stand ohne route_fest bleibt)"
else
  echo "FEHLER: external-sync auf dem Server kennt nur_flug nicht, und die Migration route_fest fehlt." >&2
  echo "Erst bash werkzeuge/routenpunkte-ausrollen.sh, dann dieses Skript noch einmal." >&2
  exit 1
fi
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/3 Migrationen"
migration 20261116150000 flug_herkunft_mit_ort
migration 20261116151000 flug_abgleich

echo "3/3 Probe"
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Flughaefen: ' || count(*) from public.flughafen_orte\" -c \"select 'Trigger: ' || string_agg(tgname, ', ') from pg_trigger where tgname in ('trg_flug_herkunft_mit_ort','trg_flug_abgleich')\""
echo "Fertig."
