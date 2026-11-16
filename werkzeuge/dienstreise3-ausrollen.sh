#!/bin/bash
# Dienstreise: Umstiege, Ticket-Upload, Ticket beim Fahrer, Apple Wallet (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/dienstreise3-ausrollen.sh
#
# 1. Migrationen 20261114010000_dienstreise_abschnitte_ticket (Abschnitte, Ticket-Ablage dienstreise-tickets)
#    und 20261114020000_trisar_geheimnis (Ablage fuer das Wallet-Zertifikat, nur Server).
# 2. Edge Functions: dispo-admin (ticket_lesen, wallet_pass), train-validate (Gleislinie, sobald der
#    Schienen-Router laeuft). Neustart Edge Functions (ca. 10 s).
# 3. Web-Dispo: Dienstreise mit Umstiegen und Ticket-Upload, Uebersicht mit Abschnitten und Ticket.
# 4. Web-Fahrer: Verbindung mit Umstiegen, Ticket (PDF), Apple Wallet, Fahrer-Punkt auf der Karte.
# Danach fuer die Wallet einmal werkzeuge/wallet-einrichten.sh. iOS/Android brauchen einen neuen Build.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/4 Migrationen"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261114010000_dienstreise_abschnitte_ticket
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261114020000_trisar_geheimnis

echo "2/4 Edge Functions"
for d in supabase/functions/dispo-admin/index.ts supabase/functions/dispo-admin/ticket.ts \
         supabase/functions/dispo-admin/wallet.ts supabase/functions/dispo-admin/wallet/bilder.ts \
         supabase/functions/train-validate/index.ts; do
  for ziel in "$R/fahrer-app-lokal/$d" "$R/trisar/fahrer/$d"; do
    ssh "$SERVER" "mkdir -p \"\$(dirname '$ziel')\""
    scp -q "$HIER/fahrer/$d" "$SERVER:$ziel"
  done
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

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

echo "3/4 Web-Dispo"
kopieren admin fahrer-app-lokal-admin-1 \
  src/shared/dienstreise.js src/components/views/DienstreiseAdd.jsx src/components/views/DienstreiseView.jsx

echo "4/4 Web-Fahrer"
kopieren fahrer fahrer-app-lokal-fahrer-1 \
  src/shared/dienstreise.js src/features/fahrer/views/DienstreiseDetail.jsx \
  src/features/fahrer/views/DienstreiseKarte.jsx src/features/fahrer/FahrerApp.jsx
echo "Fertig. Dispo und Fahrer-App neu laden. Fuer die Wallet jetzt: werkzeuge/wallet-einrichten.sh"
