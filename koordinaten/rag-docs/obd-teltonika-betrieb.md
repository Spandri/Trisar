# OBD / Teltonika Betrieb

## Verbindungsziel
- Tracker sendet an `obd.trisar.de`
- Port `5027`
- Protokoll `TCP`
- TLS `None`

## Netzwerk
- DNS Record fuer `obd.trisar.de` muss `DNS only` sein.
- Portforwarding `TCP 5027` auf den Host mit `teltonika-gateway`.
- DDNS darf die wechselnde WAN-IP automatisch aktualisieren.

## Erwartete Gateway-Logs
- `tcp_connect`
- `imei_ok`
- `locations_written`

Wenn diese Logs fehlen, kommen keine Trackerdaten im Gateway an.

## SMS als Fallback
- Nur fuer Notfaelle aktivieren.
- Authorized Numbers strikt begrenzen.
- Login/Passwort in SMS-Commands setzen.

## GNSS Mindeststatus
- `Fix Status: Fix`
- `Satellites in use > 0`

Ohne Fix keine verlaessliche Live-Position.

## Alte Records
- Gateway verwirft Records aelter als `TELTONIKA_MAX_RECORD_AGE_SEC` (Standard 600 s). Log-Event `old_records_dropped`.
- Tracker-Puffer sofort leeren: Command `deleterecords` ueber die Command-API.
