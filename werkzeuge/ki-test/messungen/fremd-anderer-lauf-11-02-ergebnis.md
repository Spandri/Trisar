# KI-Testsatz 2026-11-15-11-02

Modell: qwen2.5:14b

Gesamt 19/19 richtig. Fehlgriff: 19/19

| | Gruppe | Fall | Frage | Problem | Antwort | Sekunden |
|---|---|---|---|---|---|---|
| OK | Fehlgriff | Nachricht mit Uhrzeit ist kein Dienst | Schreib allen Fahrern: Morgen Treffpunkt 7 Uhr Halle B |  | Push an alle 4 Fahrer: „Morgen Treffpunkt 7 Uhr Halle B.“ Mit „ja“ sende ich sie. | 12.9 |
| OK | Fehlgriff | Kunde BMW ist kein Fahrzeug | Leg den Kunden BMW Group an |  | Kunden lege ich im Chat noch nicht an. Die Firma eines Gastes trägst du beim Gast unter Fahrgäste ein. | 9.0 |
| OK | Fehlgriff | Gast anlegen fragt nach | Leg den Gast Uli Hoeneß an, Telefon 0170 1234567 |  | Neuer Gast: Uli Hoeneß, Telefon 0170 1234567. Mit „ja“ lege ich ihn an. | 2.5 |
| OK | Fehlgriff | Telefon eines Gastes | Welche Telefonnummer hat Julia Weber? |  | Die Telefonnummer von Julia Weber ist +49 170 333. | 8.5 |
| OK | Fehlgriff | Firma eines Gastes | Bei welcher Firma ist Julia Weber? |  | Julia Weber gehört zu BMW Group. | 2.1 |
| OK | Fehlgriff | Telefon eines Fahrers bleibt Fahrer | Welche Telefonnummer hat Tim? |  | Die Telefonnummer von Tim Schedler ist +49 151 2. | 8.1 |
| OK | Fehlgriff | Standbys anzeigen | Welche Standbys gibt es morgen? |  | Standby morgen: - morgen 10:00–18:00, Kongress, Tim Schedler, Marvin Keller | 2.3 |
| OK | Fehlgriff | Standby fuer einen Fahrer loeschen, dann ja | Lösch den Standby von Tim morgen |  | Tim Schedler aus dem Standby morgen 10:00–18:00, Kongress, Tim Schedler, Marvin Keller nehmen? Die anderen bleiben. Mit „ja“ ändere ich es. | 13.7 |
| OK | Fehlgriff | Standby fuer einen Fahrer loeschen, dann ja (2) | ja |  | Erledigt, der Fahrer ist aus dem Standby raus. Die anderen bleiben. | 0.0 |
| OK | Fehlgriff | Standby fuer einen Fahrer loeschen, dann ja (3) | Welche Standbys gibt es morgen? |  | Standby morgen: - morgen 10:00–18:00, Kongress, Marvin Keller | 9.4 |
| OK | Fehlgriff | Standby verschieben, dann ja | Verschieb den Standby von Tim morgen auf 12 bis 20 Uhr |  | Standby morgen 10:00–18:00, Kongress, Tim Schedler, Marvin Keller auf 12:00–20:00 ändern? Die Fahrer sehen die neue Zeit in der App. Mit „ja | 15.2 |
| OK | Fehlgriff | Standby verschieben, dann ja (2) | ja |  | Standby jetzt 12:00–20:00. | 0.0 |
| OK | Fehlgriff | Dienste fuer ganze Woche, dann ja | Plan die Dienste für nächste Woche, jeden Tag 7 bis 15 für Tim |  | Ich habe 7 Dienste für Tim Schedler erkannt: 1. Dienststart 07:00, Dienstende 15:00 morgen 2. Dienststart 07:00, Dienstende 15:00 Di 17.11.  | 23.1 |
| OK | Fehlgriff | Dienste fuer ganze Woche, dann ja (2) | ja |  | morgen: gesendet Di 17.11.: gesendet Mi 18.11.: gesendet Do 19.11.: gesendet Fr 20.11.: gesendet Sa 21.11.: gesendet So 22.11.: gesendet Die | 0.0 |
| OK | Fehlgriff | Dienste fuer ganze Woche, dann ja (3) | Lösch alle Dienste von Tim nächste Woche |  | Bei Tim Schedler, morgen (07:00–15:00, noch nicht bestätigt) und Tim Schedler, Di 17.11. (07:00–15:00, noch nicht bestätigt) und Tim Schedle | 14.7 |
| OK | Fehlgriff | Dienste fuer ganze Woche, dann ja (4) | ja |  | Dienst gelöscht: Tim Schedler, morgen: erledigt Tim Schedler, Di 17.11.: erledigt Tim Schedler, Mi 18.11.: erledigt Tim Schedler, Do 19.11.: | 0.0 |
| OK | Fehlgriff | Dienste werktags | Tim nächste Woche werktags 8 bis 16 |  | Ich habe 5 Dienste für Tim Schedler erkannt: 1. Dienststart 08:00, Dienstende 16:00 morgen 2. Dienststart 08:00, Dienstende 16:00 Di 17.11.  | 22.7 |
| OK | Fehlgriff | Notiz an Fahrt ist keine Gaeste-Frage | Gib der Fahrt von Herrn Engel die Notiz Kindersitz |  | Notiz „Kindersitz“ zur Fahrt heute 10:30 Hotel Bayerischer Hof → Flughafen München Terminal 2, Horst Engel, Stefano Spandri? Mit „ja“ speich | 9.8 |
| OK | Fehlgriff | Wer hat morgen Dienst | Wer hat morgen Dienst? |  | Morgen Dienst (1): - Anna Berger: 07:00–15:00, Pause 11:30–12:00 | 2.5 |