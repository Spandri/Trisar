# Tracker-Nummern (Aufkleber auf dem Gerät)

| Nr. | Modell | IMEI | 1NCE-SIM (ICCID-Ende) |
|---|---|---|---|
| 1 | FMB010 (2G) | 357544371355146 | …825295 |
| 2 | FMC003 | 860848088205357 | …825298 (MSISDN 882285106290470) |
| 3 | FMC003 | 860848088432159 | …825299 (MSISDN 882285106290471) |
| 4 | FMC003 | 860848088205365 | …825294 |
| 5 | FMC003 | 860848087764214 | …825296 |
| 6 | FMC003 | 860848087756004 | …825297 |

Einrichtung FMC003 im Configurator: GPRS (APN iot.1nce.net, obd.trisar.de:5027 TCP),
Codec 8 Extended, System → Records ohne GPS-Fix auf "Always" (sonst sendet er drinnen nie).
SMS über das 1NCE-Portal greifen nicht, solange SMS-Login/-Passwort oder autorisierte Nummern gesetzt sind.

## Standardwerte per Gateway (Zündung = Strom an der USB-C-Platine), getestet an Nr. 2 am 06.11.

    setparam 138:1;50000:2;101:4;105:4500;1000:300
    setparam 10000:0;10005:0;10100:0;10105:0;10200:0;10205:0
    setparam 10055:120;10155:120;10255:120
    bash werkzeuge/tracker-befehl.sh <Nr> mittel   (Punkte bei Fahrt 30 s / 15 Grad / 200 m, umstellbar sparsam|mittel|fein)
    setparam 901:24          (Uhr per NTP stellen, sonst ohne GPS ewig 2004 und keine Datensaetze)

Senden: POST http://127.0.0.1:8788/command {"imei","command"} auf dem MacBook 2018.
Ergebnis: Strom weg = ein Datensatz, Verbindung nach 5 min zu, dann Ruhe. Strom da = sofort Datensatz, dann je nach Stufe (mittel: alle 30 s, bei 15 Grad oder 200 m).

## Notfall-Steuerung per SMS (1NCE-Portal → SIM → SMS senden, Absender leer)

    setparam 4000:          (autorisierte Nummer leeren, sonst verwirft er Portal-SMS mit Absender "Unknown")

SMS-Format: `admin <SMS-Passwort> <befehl>`, z. B. `getver`, `cpureset`, `setparam …`.
Login/Passwort im Configurator unter SMS \ Call Settings (Passwort nicht hier ablegen).
Antwort kommt als MO-Zeile im Portal. An Nr. 2 getestet am 06.11.

## Punkte bei Fahrt (sparsam / mittel / fein), seit 07.11.

Dispo: Karten Filter → "Punkte bei Fahrt" setzt die Stufe fuer alle Tracker (Web, iOS, Android).
Darunter je Tracker die Quittung: wartet auf Tracker / gesendet / uebernommen HH:MM / Fehler.
DB: `obd_tracker.stufe` + `stufe_status`, Warteschlange `obd_tracker_befehl` (Migration 20261107060000).
Das Gateway holt offene Befehle beim Verbinden und alle 20 s, quittiert mit der Antwort ("New value ..."),
nach 3 Sendungen ohne Antwort "fehler". Die Warteschlange ueberlebt Neustarts des Gateways.
Ausrollen: `bash werkzeuge/stufe-ausrollen.sh`. Von Hand: `bash werkzeuge/tracker-befehl.sh <Nr> mittel`.
