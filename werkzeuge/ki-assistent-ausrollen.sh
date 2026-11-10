#!/bin/bash
# KI-Assistent live schalten (MacBook 2018). Vom eigenen Mac starten:
#   bash werkzeuge/ki-assistent-ausrollen.sh
# 1. Funktion dispo-admin mit Aktion ki_frage, danach Neustart der Edge Functions (ca. 10 s)
# 2. Web-Dispo
# Das Modell laeuft auf dem Mac aus integration_settings.ollama_url und muss dafuer an sein.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

echo "1/2 Funktion dispo-admin"
for d in kiKern.js ki.ts import.ts index.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo"
DATEI=src/services/kiAssistant.js
for ziel in "$R/fahrer-app-lokal/.docker-sync/admin/$DATEI" "$R/trisar/admin/$DATEI"; do
  scp -q "$HIER/admin/$DATEI" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 touch /app/$DATEI" 2>/dev/null || true

if ssh "$SERVER" "curl -s -m 5 -o /dev/null http://100.91.160.11:11434/api/version"; then
  echo "Fertig. Dispo neu laden, Modell ist erreichbar."
else
  echo "Fertig, aber das Modell ist vom Server aus nicht erreichbar. Mac und Ollama pruefen."
fi
