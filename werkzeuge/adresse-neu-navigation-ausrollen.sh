#!/bin/bash
# Navigation nach Adressaenderung (20.11.2026) auf den MacBook 2018 bringen. Vom eigenen Mac:
#   bash werkzeuge/adresse-neu-navigation-ausrollen.sh
#
# Anlass: Fahrt 43bd2168 am 19.11., Abholung im Auto geaendert, CarPlay navigierte (Google und Apple)
# weiter zum Woellinger Wirtshaus, und die Fahrt sprang ohne Gast auf unterwegs.
#
# 1. Migration 20261120090000_adresse_neu_koordinaten: neue Abholung/Ziel verwirft alte Koordinaten und
#    Linie, "beim Gast" geht bei neuer Abholung zurueck auf zugewiesen.
# 2. Fahrer-Web: Fahrten neu laden nach Realtime-Wiederverbindung und beim Zurueckkehren in die App.
#    Nur diese eine Datei (live war vorher gleich dem Stand ceb2cd6, keine fremden Aenderungen dabei).
# iOS (CarPlay-Routencache, Neuladen vor Navigation und nach Wiederverbindung) und Android (Android Auto
# laedt vor Navigation, Neuladen nach Wiederverbindung) kommen mit dem naechsten Build.
# Mehrfach ausfuehren schadet nicht.
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
R=Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm
HIER="$(cd "$(dirname "$0")/.." && pwd)"

echo "1/2 Migration"
bash "$HIER/werkzeuge/migration-ausrollen.sh" 20261120090000_adresse_neu_koordinaten
ssh "$SERVER" "$DOCKER exec supabase_db_fahrer-app-lokal psql -U postgres -At -c \"select 'Trigger: ' || count(*) from pg_trigger where tgname = 'trg_jobs_b_adresse_neu'\""

echo "2/2 Fahrer-Web"
datei=src/features/fahrer/FahrerApp.jsx
for ziel in "$R/fahrer-app-lokal/.docker-sync/fahrer/$datei" "$R/trisar/fahrer/$datei"; do
  scp -q "$HIER/fahrer/$datei" "$SERVER:$ziel"
done
ssh "$SERVER" "$DOCKER exec fahrer-app-lokal-fahrer-1 touch /app/$datei" 2>/dev/null || true
echo "   $datei"
echo "Fertig. fahrer.trisar.de neu laden. Erwartet: 'Trigger: 1'."
