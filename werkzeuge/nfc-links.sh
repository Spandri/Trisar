#!/bin/bash
# Zeigt je Tracker den Link, der auf den NFC-Tag geschrieben wird.
#   bash werkzeuge/nfc-links.sh
ssh 100.94.169.59 "/usr/local/bin/docker exec supabase_db_fahrer-app-lokal psql -U postgres -At -F '  ' -c \"select 'Tracker ' || nummer, 'https://fahrer.trisar.de/nfc/' || nfc_code from public.obd_tracker order by nummer\""
