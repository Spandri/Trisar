#!/bin/bash
# Fahrzeug automatisch aus der VIN des OBD-Trackers (18.11.2026) auf dem MacBook 2018 ausrollen.
# Vom eigenen Mac starten:
#   bash werkzeuge/fahrzeug-vin-ausrollen.sh
#
# 1. Migration 20261118140000_fahrzeug_aus_vin: vehicles.neu_erkannt, trisar_fahrzeug_aus_vin, Push an die Dispo.
# 2. Teltonika-Gateway: VIN geht an trisar_fahrzeug_aus_vin statt aufs Auto des Fahrers, Marke aus der VIN,
#    Modell von NHTSA vPIC (nur wenn fehlerfrei).
# 3. Web-Dispo: Kachel "Neu" in der Fahrzeugliste, neue Fahrzeuge oben, Marke statt Kennzeichen.
# 4. Web-Fahrer: Marke statt "Kein Fahrzeug" (nur diese Zeile wird ersetzt, der Rest der Datei bleibt).
# Die nativen Apps kommen mit dem naechsten Build. Mehrfach ausfuehren schadet nicht.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

pruefen() { # Datei, vorher-sha, ziele...
  local quelle=$1 vorher=$2; shift 2
  local neu; neu=$(shasum "$quelle" | awk '{print $1}')
  for z in "$@"; do
    local jetzt; jetzt=$(ssh "$SERVER" "shasum \"$z\"" | awk '{print $1}')
    if [[ "$jetzt" != "$neu" && "$jetzt" != "$vorher" ]]; then
      echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch, erst abgleichen."
      exit 1
    fi
  done
}

GW_ZIELE="$R/fahrer-app-lokal/.docker-sync/koordinaten/scripts/teltonika-gateway.js $R/trisar/admin/scripts/teltonika-gateway.js $R/trisar/koordinaten/scripts/teltonika-gateway.js"
FV_ZIELE="$R/fahrer-app-lokal/.docker-sync/admin/src/components/views/FahrzeugeView.jsx $R/trisar/admin/src/components/views/FahrzeugeView.jsx"
VV_ZIELE="$R/fahrer-app-lokal/.docker-sync/fahrer/src/features/fahrer/views/VehicleView.jsx $R/trisar/fahrer/src/features/fahrer/views/VehicleView.jsx"

# Erst alles pruefen, dann ausrollen. Gateway-Stand nach gps-fix-ausrollen.sh.
pruefen "$HIER/admin/scripts/teltonika-gateway.js" b3701167b10be47df7db6cfc757a65c57072a1ad $GW_ZIELE
pruefen "$HIER/admin/src/components/views/FahrzeugeView.jsx" cbd5116fd9d7741b7b5558b5487025f913b5cc00 $FV_ZIELE

echo "1/4 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118140000_fahrzeug_aus_vin

echo "2/4 Gateway"
for z in $GW_ZIELE; do scp -q "$HIER/admin/scripts/teltonika-gateway.js" "$SERVER:$z"; done
ssh "$SERVER" "$DOCKER restart fahrer-app-lokal-teltonika-gateway-1 >/dev/null"

echo "3/4 Web-Dispo"
for z in $FV_ZIELE; do scp -q "$HIER/admin/src/components/views/FahrzeugeView.jsx" "$SERVER:$z"; done

echo "4/4 Web-Fahrer"
for z in $VV_ZIELE; do
  ssh "$SERVER" "python3 - \"$z\"" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
alt = "  const plateNumber = a.kennzeichen || t('app.noVehicle');\n"
neu = "  // Vom Tracker neu erkannt, noch ohne Kennzeichen: Marke statt \"Kein Fahrzeug\".\n  const plateNumber = a.kennzeichen || a.modell || t('app.noVehicle');\n"
if neu in s:
    print("   schon drin: " + p)
elif s.count(alt) == 1:
    open(p, "w").write(s.replace(alt, neu))
    print("   eingebaut: " + p)
else:
    sys.exit("Zeile nicht gefunden in " + p)
PY
done

sleep 40
ssh "$SERVER" "$DOCKER logs --since 45s fahrer-app-lokal-teltonika-gateway-1 2>&1 | grep -E 'vin_fahrzeug|error' | tail -5"
echo "Fertig. vin_fahrzeug oben zeigt, was mit der VIN passiert ist (angelegt, bekannt, vin_eingetragen)."
