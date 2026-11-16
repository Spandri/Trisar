#!/bin/bash
# Testfaelle Dienststart automatisch gegen die DB auf dem MacBook 2018. Vom eigenen Mac starten:
#   bash werkzeuge/dienststart-test.sh
# Spielt Migration + Tests in EINER Transaktion ein und rollt sie am Ende zurueck. Es bleibt nichts
# in der Datenbank (auch keine Push-Mitteilungen, push_ausgang wird mit zurueckgerollt).
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
HIER="$(cd "$(dirname "$0")/.." && pwd)"
{
  echo "begin;"
  cat "$HIER/fahrer/supabase/migrations/20261115140000_dienststart_automatisch.sql"
  cat "$HIER/werkzeuge/dienststart-test.sql"
  echo "rollback;"
} | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -E 'ok  |FEHLER|ist:|soll:|ERROR|TESTS|WARNING' || true
