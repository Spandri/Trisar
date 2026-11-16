#!/bin/bash
# Dienstreise-Feedback 15.11. auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/reise-feedback-ausrollen.sh
#
# 1. Migration 20261115120000: Reise endet, sobald der Fahrer eine Fahrt beginnt (nach der letzten Abfahrt)
# 2. Migration 20261115121000: dienstreise_live + Push bei Verspaetung/Gleisaenderung
# 3. push-dienst.js (beobachtet laufende Zuege alle 2 min) kopieren und neu starten
# 4. Web: Dispo-Karte (normaler Pin 15 min nach Ankunft), Fahrer-App (ReiseLage, Gleisaenderung Orange)
# iOS/Android brauchen einen neuen Build (Vorrang Live-Aktivitaet, Gleisanzeige, Push-Schalter).
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

migration() { # version name
  local v=$1 n=$2
  if ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from supabase_migrations.schema_migrations where version='$v'\"" | grep -q 1; then
    echo "   $v schon eingespielt"
    return
  fi
  {
    echo "begin;"
    cat "$HIER/fahrer/supabase/migrations/${v}_${n}.sql"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n') on conflict do nothing;"
    echo "commit;"
  } | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true
  echo "   $v eingespielt"
}

kopieren() { # app container dateien...
  local app=$1 container=$2; shift 2
  for datei in "$@"; do
    for ziel in "$R/fahrer-app-lokal/.docker-sync/$app/$datei" "$R/trisar/$app/$datei"; do
      ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
      scp -q "$HIER/$app/$datei" "$SERVER:$ziel"
    done
    ssh "$SERVER" "$DOCKER exec $container touch /app/$datei" 2>/dev/null || true
  done
}

echo "1/4 Migration Reise-Ende bei Fahrt"
migration 20261115120000 dienstreise_auto_ende
echo "2/4 Migration Live-Stand und Push"
migration 20261115121000 dienstreise_live_push

echo "3/4 Push-Dienst"
for ziel in "$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts" "$R/trisar/koordinaten/scripts"; do
  scp -q "$HIER/koordinaten/scripts/push-dienst.js" "$SERVER:$ziel/push-dienst.js"
done
ssh "$SERVER" "$DOCKER restart fahrer-app-lokal-push-dienst-1 >/dev/null && sleep 6 && $DOCKER logs --tail 5 fahrer-app-lokal-push-dienst-1"

echo "4/4 Web"
kopieren admin fahrer-app-lokal-admin-1 src/shared/reiseLage.js src/shared/dienstreise.js \
  src/components/ui/DienstreiseKartenSchicht.jsx src/components/views/KartenView.jsx
kopieren fahrer fahrer-app-lokal-fahrer-1 src/shared/reiseLage.js src/shared/dienstreise.js \
  src/features/fahrer/views/DienstreiseDetail.jsx
echo "Fertig. Dispo und Fahrer-App neu laden."
