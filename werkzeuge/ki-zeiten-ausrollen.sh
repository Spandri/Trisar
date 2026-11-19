#!/bin/bash
# KI-Assistent mit echten Fahrtzeiten (18.11.2026) auf dem MacBook 2018 ausrollen. Vom eigenen Mac starten:
#   bash werkzeuge/ki-zeiten-ausrollen.sh
#
# freiKi.ts (Modus "Frei") und kiKern.js (Modus "Regeln") bekommen je Fahrt den fertigen Stand: Startfenster
# als Losfahr-Zeit, echte Abfahrt, erwartete bzw. echte Ankunft, und ob der Fahrer trotz "Unterwegs" laut GPS
# noch am Abholort steht. Anlass: Joris 17.11. ("faehrt um 19:45 los" um 20:48, "ist in Bad Wiessee").
# Braucht die Migration 20261118100000_echte_zeiten (werkzeuge/echte-zeiten-ausrollen.sh).
# Vor dem Kopieren wird geprueft, dass auf dem Server der Stand ohne diese Aenderung liegt (git HEAD bzw.
# lokale Datei ohne die neuen Stellen), damit nichts Fremdes ueberschrieben wird.

set -euo pipefail

SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
FN=supabase/functions
HIER="$(cd "$(dirname "$0")/.." && pwd)"

# Server-Stand vor dieser Aenderung (18.11. 00:40). Weicht er ab, hat jemand anderes inzwischen ausgerollt:
# dann nicht ueberschreiben, sondern erst abgleichen.
vorher() {
  case "$1" in
    dispo-admin/freiKi.ts) echo 81ab1ea81ce627e6ee495122f4f96eca4d480007 ;;
    dispo-admin/kiKern.js) echo d314967fd1ccbf6120b7c19fc16941700ed219f4 ;;
  esac
}
for datei in dispo-admin/freiKi.ts dispo-admin/kiKern.js; do
  neu=$(shasum "$HIER/fahrer/$FN/$datei" | awk '{print $1}')
  for z in "$R/fahrer-app-lokal/$FN/$datei" "$R/trisar/fahrer/$FN/$datei"; do
    jetzt=$(ssh "$SERVER" "shasum \"$z\"" | awk '{print $1}')
    if [[ "$jetzt" == "$neu" ]]; then continue; fi
    if [[ "$jetzt" != "$(vorher "$datei")" ]]; then
      echo "Auf dem Server liegt in $z ein anderer Stand als erwartet. Abbruch, erst abgleichen."
      exit 1
    fi
    scp -q "$HIER/fahrer/$FN/$datei" "$SERVER:$z"
  done
  echo "   $datei"
done
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"
ssh "$SERVER" "$DOCKER logs --since 20s supabase_edge_runtime_fahrer-app-lokal 2>&1 | grep -iE 'error|failed' | tail -5 || true"
echo "Fertig. KI-Assistent fragen: \"Wo ist <Fahrer>?\" waehrend einer Fahrt."
