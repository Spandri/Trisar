#!/bin/bash
# App-Ortung nur in der Arbeitszeit ausrollen (MacBook 2018).
#   bash werkzeuge/ortung-im-dienst-ausrollen.sh
#
# Datenbank: ortung_fenster/ortung_erlaubt/ortung_status und Trigger auf driver_live_locations und
# driver_location_history. App-Standorte (nicht teltonika*/obd*) ausserhalb von bestaetigtem Dienst,
# angenommenem Standby oder Fahrt (ab 60 min vor Abfahrt bis erledigt) werden verworfen.
# Gilt sofort auch fuer die alten App-Versionen. Die neuen iOS- und Android-Builds schalten das GPS
# ausserhalb der Arbeitszeit ganz ab. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
HIER="$(cd "$(dirname "$0")/.." && pwd)"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261112120000_ortung_nur_im_dienst
echo "Fertig. OBD-Tracker orten weiter wie bisher."
