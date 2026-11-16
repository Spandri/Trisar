# KI-Testsatz 2026-11-15-11-00

Modell: qwen2.5:14b

Gesamt 8/8 richtig. Datum: 8/8

| | Gruppe | Fall | Frage | Problem | Antwort | Sekunden |
|---|---|---|---|---|---|---|
| OK | Datum | Aendern von X auf Y nimmt Y | Änder den Dienststart von Stefano heute von 8:00 auf 6:30 |  | Dienststart 06:30 heute für Stefano Spandri. Geändert wird bei Stefano Spandri Dienststart 08:00 → 06:30. Soll ich das senden? | 6.7 |
| OK | Datum | Dienstende verschieben ist kein Loeschen | Verschieb Stefanos Dienstende heute auf 17 Uhr |  | Dienstende 17:00 heute für Stefano Spandri. Soll ich das senden? | 6.6 |
| OK | Datum | Heutiger Wochentag meint naechste Woche | Tim Dienststart Sonntag 9 Uhr |  | Dienststart 09:00 So 22.11. für Tim Schedler. Soll ich das senden? | 6.0 |
| OK | Datum | Wochentag nie in der Vergangenheit | Tim Dienststart Samstag 9 Uhr |  | Dienststart 09:00 Sa 21.11. für Tim Schedler. Soll ich das senden? | 6.0 |
| OK | Datum | Start nach altem Ende: Ende faellt weg | Anna Dienststart morgen 16 Uhr |  | Dienststart 16:00 morgen für Anna Berger. Geändert wird bei Anna Berger Dienststart 07:00 → 16:00. Das alte Dienstende 15:00 liegt davor und | 6.0 |
| OK | Datum | Fuer alle ohne erfundene Ausnahmen | Dienststart für alle Fahrer morgen um 10:30 |  | Dienststart 10:30 morgen für alle 4 Fahrer. Geändert wird bei Anna Berger Dienststart 07:00 → 10:30. Soll ich das senden? | 6.1 |
| OK | Datum | Dienststart von gestern loeschen | Lösche den Dienststart von Stefano von gestern |  | Bei Stefano Spandri, gestern (22:00–23:30, angenommen) den Dienststart entfernen? Mit „ja“ ändere ich es, mit „nein“ breche ich ab. | 5.9 |
| OK | Datum | Fahrt mit allen ausser einem | Neue Fahrt morgen um 14:30 mit allen Fahrern außer Marvin, vom Hauptbahnhof zum Flughafen |  | Vorschlag: morgen, Mo 16.11. um 14:30, Hauptbahnhof München → Flughafen, 3 Fahrer (ohne Marvin Keller). Soll ich die Fahrt so buchen? | 3.3 |