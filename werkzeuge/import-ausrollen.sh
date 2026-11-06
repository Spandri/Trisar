#!/bin/bash
# Neuen Excel-/CSV-Import ausrollen (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/import-ausrollen.sh
#
# 1. Migration 20261106040000_import_stapel (Import-Stapel, Vorlagen, Rueckgaengig)
# 2. Funktion dispo-admin mit den Import-Aktionen (index.ts, import.ts, importKern.js)
# 3. Web-Dispo: neue Import-Ansicht
# 4. Llama: Ollama auf diesem Mac nur im Tailnet freigeben (tailscale serve, nicht im WLAN)
#    und die Adresse in integration_settings eintragen. Ist der Mac aus, laeuft der Import
#    ohne Llama weiter (nur Regeln).
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATION=20261106040000_import_stapel
FN="fahrer/supabase/functions/dispo-admin"

# Die Kern-Datei gibt es zweimal (Server und Web-Demo). Beide muessen gleich sein.
if ! cmp -s "$HIER/$FN/importKern.js" "$HIER/admin/src/services/importKern.js"; then
  echo "importKern.js weicht ab: $FN/importKern.js nach admin/src/services/ kopieren und neu starten."
  exit 1
fi

echo "1/4 Migration"
v=${MIGRATION%%_*}; n=${MIGRATION#*_}
if ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from supabase_migrations.schema_migrations where version='$v'\"" | grep -q 1; then
  echo "   schon eingespielt"
else
  {
    echo "begin;"
    cat "$HIER/fahrer/supabase/migrations/$MIGRATION.sql"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n') on conflict do nothing;"
    echo "commit;"
  } | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true
  echo "   eingespielt"
fi

echo "2/4 Funktion dispo-admin"
for datei in index.ts import.ts importKern.js; do
  for ziel in "$R/fahrer-app-lokal/supabase/functions/dispo-admin" "$R/trisar/$FN"; do
    scp -q "$HIER/$FN/$datei" "$SERVER:$ziel/$datei"
  done
done
# Die Funktion laedt beim naechsten Aufruf neu. Den Edge-Container nicht neu starten
# (die Funktionsliste aendert sich nicht, nur der Inhalt von dispo-admin).

echo "3/4 Web-Dispo"
kopieren() { # datei relativ zu admin/
  local datei="$1"
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$datei"
}
for d in src/services/importKern.js src/services/importDienst.js src/i18n/de.js src/i18n/en.js src/components/views/ImportView.jsx; do
  kopieren "$d"
done

echo "4/4 Llama (Ollama auf diesem Mac)"
if ! curl -s -m 3 http://localhost:11434/api/version >/dev/null; then
  echo "   Ollama laeuft hier nicht. Import geht trotzdem, nur ohne Llama."
else
  TS=$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)
  IP=$("$TS" ip -4 | head -1)
  # Nur im Tailnet (100.x), nicht im lokalen Netz.
  "$TS" serve --bg --tcp 11434 tcp://localhost:11434 >/dev/null
  ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" <<SQL
insert into public.integration_settings (key, value, description) values
  ('ollama_url', to_jsonb('http://$IP:11434'::text), 'Import: Llama im Tailnet (Mac von Stefano)'),
  ('ollama_model', to_jsonb('llama3.1:8b'::text), 'Import: Llama-Modell')
on conflict (key) do update set value = excluded.value, updated_at = now();
SQL
  if ssh "$SERVER" "curl -s -m 5 http://$IP:11434/api/version" | grep -q version; then
    echo "   2018 erreicht Llama unter http://$IP:11434"
  else
    echo "   2018 erreicht Llama NICHT. Import geht trotzdem, nur ohne Llama."
  fi
fi

ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'Tabellen: ' || count(*) from information_schema.tables where table_schema='public' and table_name in ('imports','import_vorlagen')\""
echo "Fertig."
