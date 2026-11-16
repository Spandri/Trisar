#!/bin/bash
# Wallet-Pass lokal testen (nichts geht an den Server). Fragt das Passwort der .p12 ab, baut aus dem Ticket
# einen Pass auf den Schreibtisch und oeffnet ihn. Zeigt der Mac den Pass an, ist die Signatur in Ordnung.
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/wallet-test.sh [ticket.pdf] [zertifikat.p12]
set -euo pipefail
HIER="$(cd "$(dirname "$0")/.." && pwd)"
TICKET="${1:-$HOME/Downloads/Ticket_186386614308_14.11.2026__H.pdf}"
P12="${2:-$HOME/trisar-geheim/Zertifikate.p12}"
ZIEL="$HOME/Desktop/TRISAR-Test.pkpass"
read -r -s -p "Passwort der .p12: " WALLET_PASSWORT; echo
export WALLET_PASSWORT
deno run --allow-read --allow-write="$ZIEL" --allow-env=WALLET_PASSWORT --allow-net --allow-import "$HIER/werkzeuge/wallet-test.ts" "$TICKET" "$P12" "$ZIEL"
open "$ZIEL"
