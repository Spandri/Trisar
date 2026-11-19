#!/bin/bash
# Dacia Duster ausrollen (19.11.2026). Vom eigenen Mac starten:
#   bash werkzeuge/dacia-duster-ausrollen.sh
#
# 1. Fahrzeugbilder: Duster drehbar in 7 Lacken + Schadensform, Katalog neu (werkzeugbilder-ausrollen.sh).
#    Die Apps (Web, iOS, Android) laden den Katalog vom Server, kein App-Build noetig.
# 2. Migration 20261119160000_dacia_duster_varianten: Tank/Verbrauch fuer Duster III.
#    HSN 8212 / TSN AFR steht schon in kba_typen ("Dacia DUSTER").
# 3. Teltonika-Gateway: WMI UU1 = Dacia. Nur diese eine Zeile wird auf dem Server eingesetzt,
#    die lokale Gateway-Datei hat noch fremde, nicht ausgerollte Aenderungen.
# Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1. Fahrzeugbilder"
bash "$HIER/werkzeuge/fahrzeugbilder-ausrollen.sh"

echo "2. Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261119160000_dacia_duster_varianten

echo "3. Gateway WMI UU1 = Dacia"
neu=0
for z in "$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts/teltonika-gateway.js" \
         "$R/trisar/admin/scripts/teltonika-gateway.js" "$R/trisar/koordinaten/scripts/teltonika-gateway.js"; do
  if ssh "$SERVER" "grep -q \"UU1: 'Dacia'\" '$z'"; then
    echo "   $z schon drin"
  elif ssh "$SERVER" "grep -q \"VF1: 'Renault', VF3:\" '$z'"; then
    ssh "$SERVER" "sed -i '' \"s/VF1: 'Renault', VF3:/VF1: 'Renault', UU1: 'Dacia', VF3:/\" '$z'"
    echo "   $z eingesetzt"
    neu=1
  else
    echo "   $z: Stelle nicht gefunden, bitte abgleichen"
  fi
done
if [[ $neu == 1 ]]; then
  ssh "$SERVER" "$DOCKER restart fahrer-app-lokal-teltonika-gateway-1 >/dev/null"
  echo "   Gateway neu gestartet"
fi

ssh "$SERVER" "$DOCKER exec supabase_db_fahrer-app-lokal psql -U postgres -At -c \"select count(*) from public.fahrzeug_varianten where modell = 'Dacia Duster'\"" | sed 's/^/   Duster-Varianten: /'
curl -s https://fahrer.trisar.de/fahrzeug-dreh/fahrzeug-dreh.json | grep -q '"Dacia Duster"' && echo "   Katalog: Duster drin"
