#!/bin/bash
# Testfaelle Fahrtenbuch gegen die lokale Testdatenbank (Docker trisar-status-test, Schema-Kopie).
#   bash werkzeuge/fahrtenbuch-test.sh
# Spielt Migration + Tests in EINER Transaktion ein und rollt sie am Ende zurueck. Es bleibt nichts zurueck.
set -euo pipefail
HIER="$(cd "$(dirname "$0")/.." && pwd)"
{
  echo "begin;"
  cat "$HIER/fahrer/supabase/migrations/20261121100000_fahrtenbuch.sql"
  cat "$HIER/fahrer/supabase/migrations/20261121110000_fahrtenbuch_vin.sql"
  cat "$HIER/werkzeuge/fahrtenbuch-test.sql"
  echo "rollback;"
} | docker exec -i trisar-status-test psql -U postgres -v ON_ERROR_STOP=1 -q -At 2>&1 | grep -E 'ok  |FEHLER|ERROR|TESTS|WARNING|LINE|DETAIL' || true
