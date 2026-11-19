#!/bin/bash
# Fahrer-Web ohne Codeleichen (Commit ceb2cd6, 20.11.2026) auf den MacBook 2018 bringen. Vom eigenen Mac:
#   bash werkzeuge/codeleichen-fahrer-ausrollen.sh
#
# - Geaenderte Dateien nach .docker-sync/fahrer (Live) und trisar/fahrer (Spiegel), danach touch im Container.
# - Geloeschte Dateien werden auf dem 2018er nicht geloescht, sondern nach ~/trisar-codeleichen-20261120/
#   verschoben (Rueckweg: zurueckschieben). Sie werden von nichts mehr eingebunden.
# Nur Fahrer-Web. iOS/Android kommen mit dem naechsten Build. Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"
SICHERUNG=trisar-codeleichen-20261120

GEAENDERT=(
  src/features/fahrer/FahrerApp.jsx
  src/features/fahrer/views/CancelRideSheet.jsx
  src/features/fahrer/views/FahrtBeenden.jsx
  src/features/fahrer/views/FahrtenScreen01View.jsx
  src/features/fahrer/views/KoloneFlughafen.jsx
  src/features/fahrer/views/KoloneNormal.jsx
  src/features/fahrer/views/KolonnenChat.jsx
  src/features/fahrer/views/NotizSend.jsx
  src/features/fahrer/views/SoloFlughafen.jsx
  src/features/fahrer/views/SoloNormal.jsx
  src/features/fahrer/views/Stunden.jsx
  src/services/supabase.js
  src/shared/etaBerechnung.js
  src/shared/gaesteAnzeige.js
  src/shared/ui/icons.js
)
GELOESCHT=(
  src/App.css
  src/AppNew.jsx
  src/assets/react.svg
  src/config/supabase-functions.js
  src/context/AuthContext.jsx
  src/features/auth/PasswortSetzenView.jsx
  src/features/chat/ChatListView.jsx
  src/features/chat/ChatView.jsx
  src/features/chat/useChatThreads.js
  src/features/fahrer/views/DetailsView.jsx
  src/features/fahrer/views/KeineFahrtView.jsx
  src/features/fahrer/views/ListView.jsx
  src/features/jobs/useJobActions.js
  src/features/jobs/useJobs.js
  src/features/vehicle/useVehicle.js
  src/pages/coordinator/CoordinatorApp.jsx
  src/pages/dispatcher/DispatcherApp.jsx
  src/pages/driver/DriverApp.jsx
  src/pages/guest/GuestApp.jsx
  src/shared/karte/routenFortschritt.js
  src/shared/ui/Footer.jsx
  src/shared/ui/Header.jsx
  src/shared/utils/date.js
  src/shared/utils/format.js
  src/shared/utils/guards.js
)

echo "1/2 Geaenderte Dateien"
for datei in "${GEAENDERT[@]}"; do
  for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
    scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
  done
  ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei" 2>/dev/null || true
  echo "   $datei"
done

echo "2/2 Geloeschte Dateien nach ~/$SICHERUNG verschieben"
for datei in "${GELOESCHT[@]}"; do
  for basis in fahrer-app-lokal/.docker-sync/fahrer trisar/fahrer; do
    ssh "$SERVER" "q='$R/$basis/$datei'; z=\"\$HOME/$SICHERUNG/$basis/$datei\"; if [ -f \"\$q\" ]; then mkdir -p \"\$(dirname \"\$z\")\" && mv \"\$q\" \"\$z\"; fi"
  done
  echo "   $datei"
done
echo "Fertig. fahrer.trisar.de neu laden."
