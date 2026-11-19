#!/bin/bash
# KI-Assistent: Ortssuche nach Naehe zur Dispo und Ort im Chat korrigieren (19.11.2026). Vom eigenen Mac:
#   bash werkzeuge/ki-ortsuche-ausrollen.sh
#
# Datenbank:
# - Tabelle dispo_standort (eine Zeile je Dispo-Konto). Die Dispo-Apps schreiben dort ihren Standort, sobald sie ihn
#   ohnehin holen (Karte mit blauem Punkt), hoechstens einmal je Minute oder nach 100 m.
# Server (dispo-admin):
# - ortSuche.ts: auch ein einzelnes Wort ("Frühlingstr") wird gesucht. Bezugspunkt ist dispo_standort, sonst der
#   Ort aus "Ankünfte bei mir", sonst die Mitte der Flotte. Der naechste passende Treffer gilt, die uebrigen merkt
#   sich das Gespraech. Kein Treffer: Rueckfrage statt des getippten Texts.
# - ortKorrektur.ts: "nein, falsches Ziel, ich meinte die in Augsburg" tauscht auf den Treffer in Augsburg.
# - ortWahl.ts, ki.ts: Anschluss. Nimmt die Ortsauswahl vom 18.11. und den KI-Umbau (kiNeu*.ts, aus solange
#   ki_ablauf nicht 'neu') mit, weil ki.ts sie importiert.
# Web-Dispo: eigenerStandort.js schreibt den Standort. iOS- und Android-Dispo brauchen dafuer einen neuen Build.
# Ohne neue Apps sucht der Server um den Ort aus "Ankünfte bei mir" oder die Mitte der Flotte.
# Vorher pruefen: deno test -A --no-check werkzeuge/ki-test/ort-suche-test.ts
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions

echo "1/3 Migration"
for m in 20261119040000_dispo_standort; do
  v=${m%%_*}; n=${m#*_}
  scp -q "$HIER/fahrer/supabase/migrations/$m.sql" "$SERVER:$R/fahrer-app-lokal/supabase/migrations/$m.sql" 2>/dev/null || true
  scp -q "$HIER/fahrer/supabase/migrations/$m.sql" "$SERVER:$R/trisar/fahrer/supabase/migrations/$m.sql" 2>/dev/null || true
  if ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 1 from supabase_migrations.schema_migrations where version='$v'\"" | grep -q 1; then
    echo "   $m schon eingespielt"
    continue
  fi
  {
    echo "begin;"
    cat "$HIER/fahrer/supabase/migrations/$m.sql"
    echo "insert into supabase_migrations.schema_migrations (version, name) values ('$v', '$n') on conflict do nothing;"
    echo "commit;"
  } | ssh "$SERVER" "$DOCKER exec -i $DB psql -U postgres -v ON_ERROR_STOP=1 -q" 2>&1 | grep -v '^NOTICE' || true
  echo "   $m eingespielt"
done
# PostgREST soll die neue Tabelle sofort kennen.
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -q -c \"notify pgrst, 'reload schema';\"" >/dev/null

echo "2/3 Edge Functions"
for d in _shared/flughafen-vorschlaege.ts places-proxy/index.ts \
  dispo-admin/kiNeuPruefen.ts dispo-admin/kiNeuFormular.ts dispo-admin/kiNeuAufloesen.ts dispo-admin/kiNeuAblauf.ts \
  dispo-admin/freiKi.ts dispo-admin/kiKern.js dispo-admin/ortSuche.ts dispo-admin/ortWahl.ts dispo-admin/ortKorrektur.ts dispo-admin/ki.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "3/3 Web-Dispo"
for datei in src/shared/eigenerStandort.js src/components/views/KiAssistentView.jsx src/components/ui/SprachModus.jsx; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$datei" "$R/trisar/admin/$datei"; do
    scp -q "$HIER/admin/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'touch /app/$datei'"
  echo "   $datei"
done
ssh "$SERVER" "$DOCKER exec $DB psql -U postgres -At -c \"select 'dispo_standort: ' || count(*) || ' Zeilen' from public.dispo_standort\""
echo "Fertig. Dispo-Karte einmal öffnen (Standort wird gemerkt), dann im KI-Assistenten z. B. „Fahrt morgen um 9 vom Hauptbahnhof zur Frühlingstr“"
echo "und danach „nein, ich meinte die in Augsburg“."
