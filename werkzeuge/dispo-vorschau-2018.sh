#!/bin/bash
# Web-Dispo lokal starten, aber mit der echten Datenbank auf dem MacBook 2018 (ueber Tailscale).
# Zum Pruefen von Aenderungen mit Live-Daten, bevor sie ausgerollt werden.
#   bash werkzeuge/dispo-vorschau-2018.sh [Port]   (Standard 5225)
# Den Anon-Schluessel holt das Skript beim Start vom Server, gespeichert wird er nirgends.
set -euo pipefail
SERVER=100.94.169.59
PORT="${1:-5225}"
HIER="$(cd "$(dirname "$0")/.." && pwd)"
SCHLUESSEL=$(ssh "$SERVER" "grep -h '^VITE_SUPABASE_ANON_KEY=' Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/fahrer-app-lokal/.docker-sync/admin/.env.local" | cut -d= -f2-)
cd "$HIER/admin"
export VITE_DATENQUELLE=supabase VITE_SUPABASE_URL="http://$SERVER:54321" VITE_SUPABASE_ANON_KEY="$SCHLUESSEL" VITE_PROXY_HOST="$SERVER"
exec npx vite --port "$PORT"
