#!/bin/bash
# Apple-Wallet fuer Dienstreisen einrichten (MacBook 2018). Vom eigenen Mac starten:
#   bash ~/Documents/Projekte/Trisar/__TRI-26-001_flottenmanagement_webapp_ss/Programm/trisar/werkzeuge/wallet-einrichten.sh [zertifikat.p12]
# Legt Zertifikat (.p12 der Pass Type ID pass.de.trisar.ticket) und Passwort in die Tabelle trisar_geheimnis,
# die nur der Server lesen kann. Das Passwort wird abgefragt und nicht angezeigt.
# Vorher muss die Migration 20261114020000_trisar_geheimnis eingespielt sein (dienstreise3-ausrollen.sh).
set -euo pipefail
SERVER=100.94.169.59
DOCKER=/usr/local/bin/docker
P12="${1:-$HOME/trisar-geheim/Zertifikate.p12}"
[ -f "$P12" ] || { echo "Nicht gefunden: $P12"; exit 1; }
read -r -s -p "Passwort der .p12: " PW; echo
MARKE='$geheim$'
case "$PW" in *"$MARKE"*) echo "Passwort darf $MARKE nicht enthalten."; exit 1;; esac
B64=$(base64 -i "$P12" | tr -d '\n')
# SQL ueber stdin, damit Passwort und Zertifikat in keiner Prozessliste auftauchen.
SQL="insert into public.trisar_geheimnis (name, wert) values ('wallet_p12', ${MARKE}${B64}${MARKE}), ('wallet_p12_passwort', ${MARKE}${PW}${MARKE}) on conflict (name) do update set wert = excluded.wert, aktualisiert = now();"
printf '%s\n' "$SQL" | ssh "$SERVER" "$DOCKER exec -i supabase_db_fahrer-app-lokal psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q"
unset PW B64 SQL
echo "Fertig. Wallet-Zertifikat liegt auf dem Server."
