#!/bin/bash
# Wächter für den KI-Assistenten (15.11.). Läuft auf dem MacBook 2018 alle 2 Minuten (launchd, de.trisar.ki-waechter).
# Prüft den Modell-Rechner (Mac mini) und meldet der Dispo per Push, wenn der Assistent ausfällt und wenn er wieder da ist.
#
# - Rechner erreichbar? (Ollama /api/version)
# - Modell geladen? Wenn nicht, lädt er es ohne Frage wieder (kein Text, damit der Zwischenspeicher bleibt).
# - Abbrüche? Zwei oder mehr Fehler im ki_protokoll in den letzten 10 Minuten.
# Gemeldet wird erst nach zwei schlechten Prüfungen in Folge, also nach etwa 4 Minuten.
# Protokoll: ~/Library/Logs/trisar-ki-waechter.log
set -u
DOCKER=/usr/local/bin/docker
DB=supabase_db_fahrer-app-lokal
STAND="$HOME/.trisar-ki-waechter"
LOG="$HOME/Library/Logs/trisar-ki-waechter.log"
sql() { "$DOCKER" exec "$DB" psql -U postgres -tA -c "$1" 2>/dev/null; }
melde() { echo "$(date '+%d.%m. %H:%M') $1" >> "$LOG"; }

URL=$(sql "select trim(both '\"' from split_part(value::text, ',', 1)) from integration_settings where key='ollama_url'")
MODELL=$(sql "select trim(both '\"' from value::text) from integration_settings where key='ollama_model_verstehen'")
[ -z "$URL" ] && { melde "keine ollama_url, Datenbank nicht erreichbar?"; exit 0; }

GRUND=""
if ! curl -s -m 5 "$URL/api/version" >/dev/null; then
  GRUND="Der Rechner mit dem Sprachmodell ist nicht erreichbar."
else
  if [ -n "$MODELL" ] && ! curl -s -m 5 "$URL/api/ps" | grep -q "\"$MODELL\""; then
    # Nicht geladen (Neustart oder Speicher voll): laden, ohne etwas zu fragen. Gleiche Kontextgröße wie der Assistent.
    curl -s -m 60 "$URL/api/generate" -d "{\"model\":\"$MODELL\",\"keep_alive\":-1,\"options\":{\"num_ctx\":4096}}" >/dev/null
    if curl -s -m 5 "$URL/api/ps" | grep -q "\"$MODELL\""; then melde "Modell $MODELL neu geladen"; else GRUND="Das Sprachmodell lässt sich nicht laden."; fi
  fi
  if [ -z "$GRUND" ]; then
    FEHLER=$(sql "select count(*) from ki_protokoll where art='fehler' and erstellt > now() - interval '10 minutes'")
    [ "${FEHLER:-0}" -ge 2 ] && GRUND="Der Assistent hat in 10 Minuten $FEHLER Anfragen abgebrochen."
  fi
fi

VORHER=$(cat "$STAND" 2>/dev/null || echo "ok 0")
ZUSTAND=${VORHER%% *}
ZAEHLER=${VORHER##* }
push() {
  sql "select count(public.push_melden(k, 'dispo', 'ki_ausfall', 'KI-Assistent', '$1', '{}'::jsonb)) from public.push_dispo_konten() k where not exists (select 1 from public.profiles p where p.id = k and lower(coalesce(p.role, '')) = 'pruefung')" >/dev/null
}
if [ -n "$GRUND" ]; then
  ZAEHLER=$((ZAEHLER + 1))
  if [ "$ZUSTAND" = "ok" ] && [ "$ZAEHLER" -ge 2 ]; then
    push "$GRUND Dienste, Fahrten und Standort-Fragen gehen weiter, freie Fragen gerade nicht."
    melde "AUSFALL gemeldet: $GRUND"
    echo "aus $ZAEHLER" > "$STAND"
  else
    echo "$ZUSTAND $ZAEHLER" > "$STAND"
  fi
else
  if [ "$ZUSTAND" = "aus" ]; then
    push "Der Assistent antwortet wieder normal."
    melde "wieder da"
  fi
  echo "ok 0" > "$STAND"
fi
