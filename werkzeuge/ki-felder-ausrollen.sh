#!/bin/bash
# KI-Assistent: qwen liest auch Tag, Fahrer, Zeiten und welche Fahrt (verstehen.ts befehlAusFeldern) fuer Dienst, Dienst loeschen,
# Standby aendern und Fahrt stornieren/erledigt/kopieren/Notiz. Vom eigenen Mac:
#   bash werkzeuge/ki-felder-ausrollen.sh
#
# dispo-admin: verstehen.ts (neu), ki.ts (Absicht vor den Regeln, Sicherheitsnetz ohne Filter, Modell je Rechner),
# steuernKi.ts (Nachricht mit Feldern vom Modell). Einstellungen: ollama_model und ollama_model_verstehen = qwen2.5:14b,
# ollama_model_ersatz = llama3.1:8b. Zurueck auf vorher: ollama_model auf llama3.1:8b und ollama_model_verstehen loeschen.
# Kein App-Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin
for d in verstehen.ts ki.ts fahrtenKi.ts dienst.ts dienstAendernKi.ts weitereKi.ts steuernKi.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "$DOCKER exec -i supabase_db_fahrer-app-lokal psql -U postgres -q" <<'SQL'
insert into integration_settings (key, value, description) values
  ('ollama_model', '"qwen2.5:14b"', 'Modell auf dem Mac mini fuer Buchungen'),
  ('ollama_model_verstehen', '"qwen2.5:14b"', 'Modell fuer Absicht und Felder (verstehen.ts), leer = nur Regeln'),
  ('ollama_model_ersatz', '"llama3.1:8b"', 'Modell auf dem Ersatz-Rechner (MacBook)')
on conflict (key) do update set value = excluded.value, updated_at = now();
SQL
echo "   Einstellungen: qwen2.5:14b"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. Im KI-Assistenten z. B. „stefano soll sich beeilen, sag ihm das mal“."
