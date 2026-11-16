#!/bin/bash
# Wallet-Pass: Download-Link mit oeffentlicher Adresse statt http://kong:8000 (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/wallet-link-ausrollen.sh
# Nur dispo-admin/wallet.ts, Neustart Edge Functions (ca. 10 s). Kein App-Build noetig.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
d=supabase/functions/dispo-admin/wallet.ts
for ziel in "$R/fahrer-app-lokal/$d" "$R/trisar/fahrer/$d"; do
  scp -q "$HIER/fahrer/$d" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
echo "Fertig. In der App nochmal 'Add to Apple Wallet' tippen."
