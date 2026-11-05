#!/bin/bash
# Push-Mitteilungen auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/push-ausrollen.sh
#
# 1. Migration 20261106010000_push.sql einspielen (Tabellen, Ausloeser, Erinnerungen)
# 2. Schluessel aus push-schluessel/ in integration_settings ablegen (nur service_role liest dort)
# 3. push-dienst.js auf den 2018er kopieren und den Dienst in docker-compose.yml eintragen
# 4. Container push-dienst starten und die ersten Zeilen seines Logs zeigen
#
# Mehrfach ausfuehren schadet nicht. Schluessel werden nie angezeigt.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
S="$HIER/push-schluessel"
APNS_KEY_ID=6X546YC82X
APNS_TEAM_ID=LB3DZM6U3A

P8=$(ls "$S"/AuthKey_*.p8 2>/dev/null | head -1 || true)
[ -f "$P8" ] || { echo "Fehlt: $S/AuthKey_….p8"; exit 1; }
[ -f "$S/firebase-dienstkonto.json" ] || { echo "Fehlt: $S/firebase-dienstkonto.json"; exit 1; }

echo "1/4 Migration einspielen"
{
  echo "begin;"
  cat "$HIER/fahrer/supabase/migrations/20261106010000_push.sql"
  echo "insert into supabase_migrations.schema_migrations (version, name) values ('20261106010000', 'push') on conflict do nothing;"
  echo "commit;"
} | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true

echo "2/4 Schluessel ablegen"
python3 - "$P8" "$S/firebase-dienstkonto.json" "$APNS_KEY_ID" "$APNS_TEAM_ID" <<'PY' | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q"
import sys, json
p8, konto, kid, team = sys.argv[1:5]
def wert(text):
    marke = '$wert$'
    assert marke not in text
    return f"to_jsonb({marke}{text}{marke}::text)"
eintraege = {
    'apns_key_p8': open(p8).read(),
    'apns_key_id': kid,
    'apns_team_id': team,
    'fcm_service_account': json.dumps(json.load(open(konto))),
}
print('begin;')
for k, v in eintraege.items():
    print(f"insert into public.integration_settings (key, value, description) values ('{k}', {wert(v)}, 'Push-Mitteilungen') "
          f"on conflict (key) do update set value = excluded.value, updated_at = now();")
print('commit;')
PY

echo "3/4 Dienst kopieren und eintragen"
for ziel in "$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts" "$R/trisar/koordinaten/scripts"; do
  scp -q "$HIER/koordinaten/scripts/push-dienst.js" "$SERVER:$ziel/push-dienst.js"
done
ssh "$SERVER" "cd $R/fahrer-app-lokal && grep -q '^  push-dienst:' docker-compose.yml || python3 - <<'PY'
p = 'docker-compose.yml'
s = open(p).read()
block = '''  # Push-Mitteilungen (APNs/FCM) aus push_ausgang, plus Erinnerungen jede Minute.
  # Ohne Zusatzpakete, darum kein npm install und kein node_modules-Volume.
  push-dienst:
    image: node:22
    restart: unless-stopped
    working_dir: /app
    command: [\"node\", \"scripts/push-dienst.js\"]
    volumes:
      - ./.docker-sync/koordinaten:/app:ro
    env_file:
      - ../koordinaten-app-lokal/.env.local

'''
i = s.index('  osm-osrm:')
open(p, 'w').write(s[:i] + block + s[i:])
print('push-dienst in docker-compose.yml eingetragen')
PY"

echo "4/4 Dienst starten"
ssh "$SERVER" "cd $R/fahrer-app-lokal && $DOCKER compose up -d push-dienst && sleep 6 && $DOCKER logs --tail 15 fahrer-app-lokal-push-dienst-1"
echo "Fertig."
