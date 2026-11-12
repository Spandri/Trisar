#!/bin/zsh
# Fahrer- und Dispo-App gleichzeitig bauen und zu TestFlight hochladen (spart 3-4 min gegenueber
# nacheinander). Jede App hat eigene DerivedData und eigene Ablage, die Laeufe stoeren sich nicht.
# Aufruf: zsh werkzeuge/ios-beide-hochladen.sh
# Vorher CURRENT_PROJECT_VERSION in ios-fahrer/project.yml und ios-dispo/project.yml hochzaehlen.
HIER="$(cd "$(dirname "$0")" && pwd)"
LOG="${TMPDIR:-/tmp}/trisar-hochladen"
mkdir -p "$LOG"
zsh "$HIER/ios-hochladen.sh" fahrer > "$LOG/fahrer.log" 2>&1 &
F=$!
zsh "$HIER/ios-hochladen.sh" dispo > "$LOG/dispo.log" 2>&1 &
D=$!
wait $F; FE=$?
wait $D; DE=$?
for a in fahrer dispo; do grep -hE "HOCHGELADEN|error:" "$LOG/$a.log" | tail -3; done
echo "Fahrer exit $FE, Dispo exit $DE (Logs in $LOG)"
[ $FE -eq 0 ] && [ $DE -eq 0 ]
