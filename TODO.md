# TODO

## KI-Assistent: Fahrten im Zusammenhang sehen

- [x] **Prüfung vor jeder Karte** (11.11., Warnung bei Überschneidung in Buchung und Änderung; noch ohne OSRM, Dauer aus Route oder Luftlinie). Tagesplan des Fahrers ansehen, Überschneidungen und Anfahrt vom vorigen Ziel mit dem eigenen OSRM rechnen. Die Karte warnt zum Beispiel „Stefano ist bis 10:15 am Flughafen, schafft es nicht rechtzeitig“. Bestätigen bleibt beim Menschen.
- [x] **Fahrervorschlag bei „Fahrer fehlt“** (11.11., per Regel). Wer ist zu der Zeit frei und steht am nächsten, mit kurzer Begründung. Nach festen Regeln, unabhängig vom Sprachmodell.
- [x] **Tagesfragen** (11.11.: wer hat heute Luft, wer im Dienst, Fahrten ohne Fahrer). „Wer hat heute Luft?“ oder „Wo wird es eng?“ rechnet der Server aus dem ganzen Tag, das Modell formuliert nur die Antwort.

- [ ] **Anfahrt mit OSRM statt Luftlinie** für Konfliktprüfung und Fahrervorschlag.
- [ ] **Adresse statt Koordinaten** bei „Wo ist …“, wenn kein eigener Ort in der Nähe ist.

## NFC-Tags am Tracker

- [x] **Fahrtenbuch.** (21.11., je Fahrzeug über Fahrgestellnummer, km je Fahrt und Leerfahrten, Export Excel/PDF/CSV, siehe Abschnitt Fahrtenbuch.) Autos laufen nur dienstlich, ein steuerliches Fahrtenbuch ist damit keine Pflicht.
- [ ] **Nähe prüfen.** Beim Antippen vergleichen, ob das Handy wirklich beim Tracker ist.
- [ ] **Datenschutzinformation** für die Fahrer um das Antippen ergänzen.

## Fahrtenbuch

- [ ] **Fahrer-Dashboard bei Konto.** Fahrer sieht km nicht je Fahrt, sondern die gesamten km je Einsatz. Dafür müssen erst die Einsätze gebaut werden. Im selben Dashboard sind Liter, Fahrten und Stunden heute Platzhalter und noch nicht mit echten Daten verbunden, das wird dabei mit angeschlossen (km aus `fahrtenbuch`, Stunden aus `stundenzettel`, Liter aus dem Tankstand vom Tracker).
- [ ] **Rohpositionen löschen.** Regel vom 21.11.: nach 90 Tagen. Am 21.11. zurückgestellt, vorerst wird nichts gelöscht. Erst auf Ansage bauen.
- [ ] **Konvoi.** Bei mehreren Fahrern bekommt nur das Auto des Hauptfahrers eine Zeile.

## Apple Watch

- [ ] **Uhr ohne iPhone (Mobilfunk-Uhren).** Heute holt die Uhr alles über das iPhone (WatchConnectivity). Ohne iPhone in der Nähe zeigt sie nur den letzten Stand. Eigenes Nachladen ginge so: das iPhone gibt der Uhr das Supabase-Sitzungstoken (Access + Refresh) mit, die Uhr nutzt supabase-swift (läuft auf watchOS) und lädt selbst über Mobilfunk/WLAN, Aktionen gehen dann direkt an den Server. Aufwand: Anmeldung/Token-Erneuerung auf der Uhr, eigener Datenzugang für Fahrer- und Dispo-Uhr, Akkuverbrauch. Erst sinnvoll, wenn Fahrer wirklich ohne Handy unterwegs sind (bisher nicht der Fall).
