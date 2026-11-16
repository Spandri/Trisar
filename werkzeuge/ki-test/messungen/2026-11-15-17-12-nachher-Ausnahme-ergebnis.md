# KI-Testsatz 2026-11-15-11-00

Modell: qwen2.5:14b

Gesamt 4/6 richtig. Ausnahme: 4/6

| | Gruppe | Fall | Frage | Problem | Antwort | Sekunden |
|---|---|---|---|---|---|---|
| FEHL | Ausnahme | Dienst an alle bis auf einen | Schick allen bis auf Stefano bitte ein dienstbeginn für heute 13:30 Uhr | datum "2026-11-16", erwartet "2026-11-15" | Dienststart 13:30 morgen für Tim Schedler, Marvin Keller, Anna Berger (ohne Stefano Spandri). Geändert wird bei Anna Berger Dienststart 07:0 | 7.7 |
| OK | Ausnahme | Dienst an alle, einer ausgenommen, anders gesagt | Morgen fangen alle um 8 an, nur Tim nicht |  | Dienststart 08:00 morgen für Stefano Spandri, Marvin Keller, Anna Berger (ohne Tim Schedler). Geändert wird bei Anna Berger Dienststart 07:0 | 7.1 |
| FEHL | Ausnahme | Feierabend fuer alle ausser zwei | Schick alle Fahrer in den Feierabend außer Tim und Marvin | Art antwort, erwartet dienst_vorschlag; Antwort ohne "ohne Tim"; Antwort ohne "Marvin" | Bei „alle außer …“ rate ich nicht, weil das Modell gerade nicht geantwortet hat. Sag es bitte gleich noch einmal oder nenne die Fahrer einze | 4.5 |
| OK | Ausnahme | Nachricht an alle ausser einem | Sag allen außer Tim, dass sie heute tanken sollen |  | Push an Stefano Spandri, Marvin Keller, Anna Berger (ohne Tim Schedler): „Tanken heute, außer du bist Tim.“ Mit „ja“ sende ich sie. | 4.9 |
| OK | Ausnahme | Stundenlohn fuer alle ausser einem | Stundenlohn 25 Euro für alle Fahrer, ausgenommen Marvin |  | Ich setze den Stundenlohn auf 25,00 € für Stefano Spandri, Tim Schedler, Anna Berger (ohne Marvin Keller). Bisher ist bei niemandem ein Stun | 2.4 |
| OK | Ausnahme | Kein falsches Ausnehmen beim Loeschen | Stefano hat heute frei, lösch seinen Dienst |  | Bei Stefano Spandri, heute (ab 08:00, angenommen) den ganzen Dienst löschen? Mit „ja“ ändere ich es, mit „nein“ breche ich ab. | 5.9 |