#!/bin/bash
# Fahrer sofort abmelden, wenn die Dispo sein Passwort aendert oder sein Konto loescht (MacBook 2018).
#   bash werkzeuge/konto-abmelden-ausrollen.sh
#
# 1. Datenbank: Tabelle konto_abmelden (Realtime-Signal) und Funktion konto_abmelden_jetzt
#    (beendet alle Sitzungen des Kontos).
# 2. dispo-admin (index.ts): ruft sie beim Passwortaendern und vor dem Loeschen auf.
# 3. Web-Fahrer-App: hoert auf das Signal und prueft beim Zurueckholen die Sitzung, dann Login.
# iOS und Android (Fahrer und Dispo) brauchen einen neuen Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions/dispo-admin

echo "1/3 Datenbank"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112110000_konto_abmelden

echo "2/3 dispo-admin"
scp -q "$HIER/fahrer/$FN/index.ts" "$SERVER:$R/fahrer-app-lokal/$FN/index.ts"
scp -q "$HIER/fahrer/$FN/index.ts" "$SERVER:$R/trisar/fahrer/$FN/index.ts"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "3/3 Fahrer-App"
for datei in src/features/auth/useAuthSession.js; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
    scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei"
  echo "   fahrer/$datei"
done
echo "Fertig. Fahrer-App neu laden. iOS und Android brauchen einen neuen Build."
