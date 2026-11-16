#!/bin/bash
# Wächter für den KI-Assistenten einrichten (15.11.). Vom eigenen Mac:
#   bash werkzeuge/ki-waechter-ausrollen.sh
#
# Legt auf dem MacBook 2018 das Skript ~/trisar-ki-waechter.sh ab und startet es alle 2 Minuten (launchd).
# Es meldet der Dispo per Push, wenn der Modell-Rechner weg ist oder der Assistent Anfragen abbricht, und wenn
# er wieder da ist. Ein nicht geladenes Modell lädt es selbst wieder. Details: werkzeuge/ki-waechter/ki-waechter.sh
# Abschalten: ssh 100.94.169.59 'launchctl unload ~/Library/LaunchAgents/de.trisar.ki-waechter.plist'
# Mehrfach ausführen schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
HIER="$(cd "$(dirname "$0")" && pwd)"
scp -q "$HIER/ki-waechter/ki-waechter.sh" "$SERVER:trisar-ki-waechter.sh"
scp -q "$HIER/ki-waechter/de.trisar.ki-waechter.plist" "$SERVER:Library/LaunchAgents/de.trisar.ki-waechter.plist"
ssh "$SERVER" 'chmod +x ~/trisar-ki-waechter.sh; launchctl unload ~/Library/LaunchAgents/de.trisar.ki-waechter.plist 2>/dev/null; launchctl load ~/Library/LaunchAgents/de.trisar.ki-waechter.plist && sleep 3 && cat ~/.trisar-ki-waechter 2>/dev/null'
echo "Fertig. Stand oben (ok 0 = alles gut). Protokoll: ssh $SERVER 'tail ~/Library/Logs/trisar-ki-waechter.log'"
