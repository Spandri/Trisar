#!/bin/bash
# Dispo-Fahrzeugseite, "gemeldet von", Geparkt, Strich statt Reichweite, Modellvariante (18.11.2026) auf den 2018.
# Aufruf: bash werkzeuge/dispo-fahrzeug-ausrollen.sh <bau-ordner>
#   <bau-ordner> enthaelt admin/ und fahrer/ = Server-Stand + nur unsere Dateien (vorher mit vite gebaut),
#   dazu liste_admin.txt / liste_fahrer.txt (Pfade relativ zu admin/ bzw. fahrer/) und srv_admin.txt /
#   srv_fahrer.txt (shasum-Liste des Server-Stands beim Abholen). Weicht der Server inzwischen ab: Abbruch.
# Andere Sessions haben lokal unfertige Web-Aenderungen, darum nicht einfach admin/src kopieren.
set -euo pipefail
SERVER=100.94.169.59
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
# Eine geteilte SSH-Verbindung, sonst schliesst der Server bei vielen schnellen Verbindungen ("Connection closed").
MUX="-o ControlMaster=auto -o ControlPath=/tmp/trisar-ausrollen-%C -o ControlPersist=120"
ssh() { command ssh $MUX "$@"; }
scp() { command scp $MUX "$@"; }
BAU="$1"

echo "1/3 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261118210000_schaden_gemeldet_von

pruefen() { # app
  local app=$1
  for f in $(cat "$BAU/liste_$app.txt"); do
    local vorher; vorher=$(awk -v f="$f" '$2==f {print $1}' "$BAU/srv_$app.txt")
    for z in "$R/fahrer-app-lokal/.docker-sync/$app/$f" "$R/trisar/$app/$f"; do
      local jetzt; jetzt=$(ssh "$SERVER" "shasum \"$z\" 2>/dev/null || true" | awk '{print $1}')
      local neu; neu=$(shasum "$BAU/$app/$f" | awk '{print $1}')
      if [[ "$jetzt" != "$neu" && "$jetzt" != "$vorher" ]]; then
        echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch."; exit 1
      fi
    done
  done
}
pruefen admin
pruefen fahrer

echo "2/3 Web-Dateien"
for app in admin fahrer; do
  for f in $(cat "$BAU/liste_$app.txt"); do
    for z in "$R/fahrer-app-lokal/.docker-sync/$app/$f" "$R/trisar/$app/$f"; do
      ssh "$SERVER" "mkdir -p \"$(dirname "$z")\""
      scp -q "$BAU/$app/$f" "$SERVER:$z"
    done
  done
done

echo "3/3 Formen und Beispielfotos fuer die Dispo"
for d in fahrzeug-dreh schaden; do
  for z in "$R/fahrer-app-lokal/.docker-sync/admin/public/$d" "$R/trisar/admin/public/$d"; do
    ssh "$SERVER" "mkdir -p \"$z\""
    for f in "$HIER"/admin/public/$d/*-form.bin "$HIER"/admin/public/$d/felge-0*.jpg; do
      [ -e "$f" ] || continue
      case "$f" in *" "[0-9]*) continue ;; esac
      scp -q "$f" "$SERVER:$z/"
    done
  done
done
echo "Fertig."
