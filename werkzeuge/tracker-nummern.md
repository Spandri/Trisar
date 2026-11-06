# Tracker-Nummern (Aufkleber auf dem Gerät)

| Nr. | Modell | IMEI | 1NCE-SIM (ICCID-Ende) |
|---|---|---|---|
| 1 | FMB010 (2G) | 357544371355146 | …825295 |
| 2 | FMC003 | 860848088205357 | …825298 (MSISDN 882285106290470) |
| 3 | FMC003 | 860848088432159 | …825299 (MSISDN 882285106290471) |

Einrichtung FMC003 im Configurator: GPRS (APN iot.1nce.net, obd.trisar.de:5027 TCP),
Codec 8 Extended, System → Records ohne GPS-Fix auf "Always" (sonst sendet er drinnen nie).
SMS über das 1NCE-Portal greifen nicht, solange SMS-Login/-Passwort oder autorisierte Nummern gesetzt sind.

## Standardwerte per Gateway (Zündung = Strom an der USB-C-Platine), getestet an Nr. 2 am 06.11.

    setparam 138:1;50000:2;101:4;105:11000;1000:300
    setparam 10000:0;10005:0;10100:0;10105:0;10200:0;10205:0
    setparam 10050:60;10055:120;10052:30;10150:60;10155:120;10152:30;10250:60;10255:120;10252:30

Senden: POST http://127.0.0.1:8788/command {"imei","command"} auf dem MacBook 2018.
Ergebnis: Strom weg = ein Datensatz, Verbindung nach 5 min zu, dann Ruhe. Strom da = sofort Datensatz, dann alle 60 s.

## Notfall-Steuerung per SMS (1NCE-Portal → SIM → SMS senden, Absender leer)

    setparam 4000:          (autorisierte Nummer leeren, sonst verwirft er Portal-SMS mit Absender "Unknown")

SMS-Format: `admin <SMS-Passwort> <befehl>`, z. B. `getver`, `cpureset`, `setparam …`.
Login/Passwort im Configurator unter SMS \ Call Settings (Passwort nicht hier ablegen).
Antwort kommt als MO-Zeile im Portal. An Nr. 2 getestet am 06.11.
