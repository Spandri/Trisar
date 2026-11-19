#!/bin/bash
# Nimmt adresse-komplett-ausrollen.sh (20.11.2026) zurueck. Vom eigenen Mac:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/adresse-komplett-zurueck.sh
#
# Adresssuche und KI-Ortssuche wieder ueber Google wie vorher (places-proxy, dispo-admin/ortSuche.ts),
# _shared/tomtom-adresse.ts wird geloescht, Web-Dispo App.jsx: OpenStreetMap-Rueckfall wieder ohne PLZ.
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
FN=supabase/functions

echo "1/2 Edge Functions"
for d in places-proxy/index.ts dispo-admin/ortSuche.ts; do
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/fahrer-app-lokal/$FN/$d"
  scp -q "$HIER/fahrer/$FN/$d" "$SERVER:$R/trisar/fahrer/$FN/$d"
  echo "   $d"
done
ssh "$SERVER" "rm -f $R/fahrer-app-lokal/$FN/_shared/tomtom-adresse.ts $R/trisar/fahrer/$FN/_shared/tomtom-adresse.ts"
echo "   _shared/tomtom-adresse.ts geloescht"
ssh "$SERVER" "$DOCKER restart supabase_edge_runtime_fahrer-app-lokal >/dev/null && sleep 8"

echo "2/2 Web-Dispo (App.jsx)"
for z in "$R/fahrer-app-lokal/.docker-sync/admin/src/App.jsx" "$R/trisar/admin/src/App.jsx"; do
  ssh "$SERVER" "python3 - '$z'" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding='utf-8').read()
neu = "  const plzOrt = [adresse.postcode, ort].filter(Boolean).join(' ');\n  const teile = nameIstAdresse ? [strasseTeil, plzOrt] : [name, strasseTeil, plzOrt];"
alt = "  const teile = nameIstAdresse ? [strasseTeil, ort] : [name, strasseTeil, ort];"
if s.count(neu) == 1:
    s = s.replace(neu, alt).replace(
        '// Nominatim-Treffer als "Straße Hausnummer, PLZ Ort" bzw. "Name, Straße Hausnummer, PLZ Ort".',
        '// Nominatim-Treffer als "Straße Hausnummer, Ort" bzw. "Name, Straße Hausnummer, Ort".')
    open(p, 'w', encoding='utf-8').write(s)
    print("   " + p + " zurueck")
elif s.count(alt) == 1:
    print("   " + p + " schon wie vorher")
else:
    print("   " + p + ": Stelle nicht gefunden, bitte abgleichen")
PY
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-admin-1 sh -c 'touch /app/src/App.jsx'" 2>/dev/null || true
echo "Fertig. Alles wie vor dem 20.11."
