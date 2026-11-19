# BMW X7 G07: Modell/Variante aus der VIN (Typschlüssel Stelle 4–7)

Stand der Recherche 18.11.2026. Kennzeichnung je Aussage: **belegt** (mit Quelle) oder **unsicher**.
Hauptquelle für die Typschlüssel ist bimmer.work (Seiten `https://bimmer.work/model/g07/<code>/`, einzeln abgerufen), ergänzt um Teile-Kompatibilitätslisten von Leebmann24 (nur über Suchmaschinen-Snippets lesbar, Seiten selbst liefern 403 an Bots).

## Beispiel-VIN WBA21EN0309582583: welche Variante ist '21EN'?

### Takeaway
'21EN' ist der Typschlüssel des **X7 xDrive40d LCI (G07 „MUE“, ab 08/2022), Europa, Linkslenker**, Motor B57D30T3 (3,0 l Diesel, 259 kW, 720 Nm). Die Prüfziffer (Stelle 9 = '3') der Beispiel-VIN ist rechnerisch korrekt.

### Cited Findings
- belegt: 21EN = X7 xDrive40d, Development Code G07 (MUE), Market Europe (left Steering), Motor 3.00 l / 259 kW / 720 Nm (B57D30T3) — [bimmer.work 21EN](https://bimmer.work/model/g07/21en/)
- belegt: 22EN = gleiche Variante, Europa Rechtslenker — [bimmer.work 22EN](https://bimmer.work/model/g07/22en/)
- belegt: Eine reale VIN WBA21EN0XS9Z95538 dekodiert als X7 xDrive40d, G07 (MUE)/21EN, Produktionsstart 18.03.2025, Werk Spartanburg (USA), Markt Europa (Linkslenker) — [bimmer.work VIN-Beispiel](https://bimmer.work/vin/94658dd06a9ada0541086ff7e251c8da0)
- belegt (Snippet): Teilekatalog-Zeile „X7 | G07 | xDrive40d | 21EN | B57Y | Automatic | All wheel drive | 8/1/2022 – 7/31/2027“ — [Leebmann24 (Suchsnippet)](https://www.leebmann24.com/ch/en/product/bmw-cover-10381495)
- belegt: Prüfziffer nach dem nordamerikanischen Verfahren (Gewichte 8-7-6-5-4-3-2-10-0-9-…) für WBA21EN0309582583 ergibt 3 = Stelle 9. Eigene Rechnung, Verfahren siehe [Wikipedia VIN](https://en.wikipedia.org/wiki/Vehicle_identification_number)

### Inferences
- Die Beispiel-VIN gehört mit hoher Sicherheit zu einem X7 xDrive40d LCI (Bauzeit ab 08/2022), EU-Linkslenker. Stelle 10 = '0' (kein Modelljahr) und Stelle 11 = '9' passen zu einem in Spartanburg gebauten EU-Fahrzeug (siehe VIN-Struktur unten).
- Für ein Muster genügt das Präfix `WBA21EN` (bzw. `WBA22EN` für RHD).

### Gaps
- Die Beispiel-VIN selbst wurde bewusst nicht bei einem externen Dekoder eingegeben (Flottendaten des Users). Bestätigung nur über Typschlüssel und Prüfziffer, nicht über Einzel-VIN-Abfrage.

## Vollständige Tabelle Typschlüssel → Variante

### Takeaway
Pre-LCI (12/2018–07/2022) nutzt zweibuchstabige Codes `CW..`/`CX..`/`TB..`, LCI (ab 08/2022) Codes `xxEM`/`xxEN`. Die letzte Ziffer der ersten Zweiergruppe codiert den Markt: **…1 = Europa LHD, …2 = Europa RHD, …3 = USA LHD** (Muster aus allen Einträgen abgeleitet, Einzelcodes belegt).

### Cited Findings
Pre-LCI G07 (Produktion 12/2018 – 07/2022):

| Typschlüssel | Variante | Motor (Code) | Kraftstoff | Markt | Status |
|---|---|---|---|---|---|
| CW81 | xDrive30d | B57D30O0, 195 kW / 620 Nm | Diesel | EU LHD | belegt — [bimmer.work CW81](https://bimmer.work/model/g07/cw81/) |
| CW82 | xDrive30d | B57D30O0 | Diesel | EU RHD | belegt — [bimmer.work CW82](https://bimmer.work/model/g07/cw82/) |
| TB41 | xDrive40d (48V, ab 08/2020) | B57D30T2, 250 kW / 700 Nm | Diesel | EU LHD | belegt — [bimmer.work TB41](https://bimmer.work/model/g07/tb41/); Bauzeit 1.8.2020–31.7.2022 laut [Leebmann24 (Snippet)](https://www.leebmann24.com/de/de/product/bmw-betriebsanleitung-g07-10043847) |
| TB42 | xDrive40d | B57D30T2 | Diesel | EU RHD | belegt — [bimmer.work TB42](https://bimmer.work/model/g07/tb42/) |
| CW01 | M50d | B57D30S0, 294 kW / 760 Nm | Diesel | EU LHD | belegt — [bimmer.work CW01](https://bimmer.work/model/g07/cw01/); Bauzeit 1.12.2018–31.7.2022 laut [Leebmann24 (Snippet)](https://www.leebmann24.com/de/de/product/bmw-betriebsanleitung-g07-10043847) |
| CW02 | M50d | B57D30S0 | Diesel | EU RHD | belegt — [bimmer.work CW02](https://bimmer.work/model/g07/cw02/) |
| CW21 | xDrive40i | B58B30M1, 250 kW / 450 Nm | Benzin | EU LHD | belegt — [bimmer.work CW21](https://bimmer.work/model/g07/cw21/); Bauzeit 12/2018–07/2022 laut Leebmann24-Snippet |
| CW22 | xDrive40i | B58B30M1 | Benzin | EU RHD | belegt — [bimmer.work CW22](https://bimmer.work/model/g07/cw22/) |
| CW23 | xDrive40i | B58B30M1 | Benzin | USA | belegt — [bimmer.work CW23](https://bimmer.work/model/g07/cw23/) |
| CX41 | xDrive50i | N63B44M3, 340 kW / 650 Nm | Benzin | EU LHD (v. a. Nicht-EU-Exportmärkte, unsicher) | belegt — [bimmer.work CX41](https://bimmer.work/model/g07/cx41/) |
| CX43 | xDrive50i | N63B44M3 | Benzin | USA | belegt — [bimmer.work CX43](https://bimmer.work/model/g07/cx43/) |
| CX61 | M50i | N63B44T3, 390 kW / 750 Nm | Benzin | EU LHD | belegt — [bimmer.work CX61](https://bimmer.work/model/g07/cx61/) |
| CX63 | M50i | N63B44T3 | Benzin | USA | belegt — [bimmer.work CX63](https://bimmer.work/model/g07/cx63/) |
| CX21 | „xDrive30i“, 2,0 l, 195 kW | ? | Benzin | laut Seite „Europe LHD“ | unsicher — [bimmer.work CX21](https://bimmer.work/model/g07/cx21/) listet es, Motorcode leer; kein solches Modell im EU-Programm bekannt, vermutlich Sondermarkt |

LCI G07 „MUE“ (Produktion ab 08/2022):

| Typschlüssel | Variante | Motor (Code) | Kraftstoff | Markt | Status |
|---|---|---|---|---|---|
| 21EM | xDrive40i | B58B30M2, 280 kW / 540 Nm | Benzin (48V) | EU LHD | belegt — [bimmer.work 21EM](https://bimmer.work/model/g07/21em/); ab 08/2022 laut [Leebmann24 (Snippet)](https://www.leebmann24.com/is/en/product/bmw-single-key-locking-system-10707073) |
| 22EM | xDrive40i | B58B30M2 | Benzin | EU RHD | belegt — [bimmer.work 22EM](https://bimmer.work/model/g07/22em/) |
| 23EM | xDrive40i | B58B30M2 | Benzin | USA | belegt — [bimmer.work 23EM](https://bimmer.work/model/g07/23em/) |
| 21EN | xDrive40d | B57D30T3, 259 kW / 720 Nm | Diesel (48V) | EU LHD | belegt — [bimmer.work 21EN](https://bimmer.work/model/g07/21en/) |
| 22EN | xDrive40d | B57D30T3 | Diesel | EU RHD | belegt — [bimmer.work 22EN](https://bimmer.work/model/g07/22en/) |
| 31EM | M60i xDrive | S68B44T0, 390 kW / 750 Nm | Benzin (48V) | EU LHD | belegt — [bimmer.work 31EM](https://bimmer.work/model/g07/31em/); ab 08/2022 laut Leebmann24-Snippet |
| 32EM | M60i xDrive | S68B44T0 | Benzin | EU RHD | belegt — [bimmer.work 32EM](https://bimmer.work/model/g07/32em/) |
| 33EM | M60i xDrive | S68B44T0 | Benzin | USA | belegt — [bimmer.work 33EM](https://bimmer.work/model/g07/33em/) |
| 41EM | ALPINA XB7 | S68B44T0, 457 kW / 800 Nm | Benzin | EU LHD | belegt — [bimmer.work 41EM](https://bimmer.work/model/g07/41em/) |
| 42EM | ALPINA XB7 | S68B44T0, 457 kW | Benzin | EU RHD | belegt — [bimmer.work 42EM](https://bimmer.work/model/g07/42em/) |
| 43EM | ALPINA XB7 | S68B44T0, 470 kW | Benzin | USA | belegt — [bimmer.work 43EM](https://bimmer.work/model/g07/43em/) |

Geprüft und **nicht** als G07 vorhanden (bimmer.work leitet um / kein Eintrag): CW41, CW42, CW61, CX42, CX53, CX81, CX01, 11EM, 31EN, 41EN, 23EN, TB43 — [bimmer.work](https://bimmer.work/). Achtung: bimmer.work zeigt unter `/model/g07/` auch fremde Baureihen an (z. B. 21EP = X5 xDrive40Li G18 China, CY81 = X6 M50i G06), d. h. die URL beweist nicht die Baureihe, nur der „Development Code“ auf der Seite.

Widersprüche:
- Leebmann24-Snippets nennen für CX41 Motor „N63M“ und für ein „M50i“ den Code CX53 — [Suchergebnis Leebmann24](https://www.leebmann24.com/ch/en/product/bmw-cover-10381495); bimmer.work kennt CX53 nicht und führt M50i als CX61/CX63. CX53 daher **unsicher**.
- Leebmann24 nennt für 21EN den Motor „B57Y“ (Teilekatalog-Kürzel), bimmer.work „B57D30T3“. Vermutlich nur unterschiedliche Bezeichnungssysteme, **unsicher**.
- Leistung xDrive40d pre-LCI: 250 kW laut [bimmer.work TB41](https://bimmer.work/model/g07/tb41/) und [Wikipedia BMW X7](https://en.wikipedia.org/wiki/BMW_X7) (Suchsnippet), Typgenehmigung CH 250 kW — [swisscarinfo](https://swisscarinfo.ch/en/vehicle/aba320-bmw-x7-xdrive40d).

### Inferences
- Für Präfix-Muster in der Flotten-App: `WBA` + Typschlüssel (4 Zeichen) deckt alle EU-Fahrzeuge ab, egal ob in Spartanburg gebaut.
- xDrive30d gibt es nur pre-LCI (CW81/82). Nach LCI wurde in der EU nur xDrive40i, xDrive40d, M60i und ALPINA XB7 angeboten (passt zur Liste, nicht separat belegt).
- Markt-Ziffer 1/2/3 (EU LHD / EU RHD / USA) ist ein konsistentes Muster über alle 24 gefundenen Codes, aber keine offizielle BMW-Regel.

### Gaps
- **ALPINA XB7 pre-LCI (2020–2022)**: Typschlüssel nicht gefunden.
- **xDrive40i pre-LCI mit 48V (ab ca. 2020)**: ob ein eigener Code existiert (analog TB41 beim 40d) oder CW21 weiterläuft, nicht geklärt. Leebmann24 nennt für CW21 durchgehend 12/2018–07/2022.
- **M50d/M50i/xDrive30d Ende**: M50d in EU vermutlich ~2020 ausgelaufen, genaues Datum für CW01 nur „bis 31.7.2022“ (Katalog-Rahmen), **unsicher**.
- Eine systematische Abfrage aller Code-Kombinationen bei bimmer.work wurde nicht durchgeführt (Massenabfrage wurde vom Berechtigungssystem gestoppt). Liste daher evtl. unvollständig (z. B. weitere Märkte wie China, Japan, Golfstaaten).
- realoem.com lieferte 403, konnte nicht gegengeprüft werden.

## Aufbau einer BMW-VIN (EU vs. US)

### Takeaway
Stelle 1–3 WMI (`WBA` = BMW AG, `5UX` = BMW US-SUV), 4–7 Typschlüssel, 8 meist '0', 9 Prüfziffer, 10 Modelljahr (USA Pflicht, EU oft '0'), 11 Werk ('9' = Spartanburg), 12–17 Seriennummer. Bei LCI-US-VINs stehen in 4–7 die vollen Typschlüssel (23EM), bei pre-LCI-US-VINs nur die ersten drei Zeichen plus 'C' (CW2C statt CW23).

### Cited Findings
- belegt: EU-X7 aus Spartanburg tragen trotzdem WMI `WBA` (Beispiel WBA21EN0XS9Z95538, Werk Spartanburg, Markt Europa) — [bimmer.work VIN](https://bimmer.work/vin/94658dd06a9ada0541086ff7e251c8da0)
- belegt: US-X7 nutzen `5UX`, z. B. 5UXCW2C01N9M28518 = 2022 X7 xDrive40i — [fleetchaser](https://fleetchaser.com/vin/2022/bmw/x7/5UXCW2C01N9M28518/); `5UX23EM0…` = X7 xDrive40i (LCI) — [decodethis](https://decodethis.com/web/vin/5UX23EM00V9493638), [stat.vin](https://stat.vin/vin-decoding/bmw/x7/5UX23EM06P9P21340)
- belegt: Prüfziffer (Stelle 9) ist in Nordamerika und China Pflicht, in Europa nicht; außerhalb Nordamerikas ist Stelle 10 „usually 0“; Stelle 11 = Werk (Pflicht NA/China) — [Wikipedia VIN](https://en.wikipedia.org/wiki/Vehicle_identification_number)
- belegt (Sekundärquelle): manche EU-BMW haben '0' an Stelle 10 wegen anderer Regelung in Europa — [BMWBlog](https://www.bmwblog.com/?p=516016)
- belegt (eigene Rechnung): alle vier Beispiel-VINs (2× WBA, 2× 5UX) haben eine gültige Prüfziffer nach NA-Verfahren, d. h. BMW berechnet sie auch bei EU-VINs.
- belegt: EU-VIN WBA21EN0XS9Z95538 hat an Stelle 10 'S' (= 2025), Beispiel-VIN WBA21EN0309582583 hat '0'. Beide Formen kommen bei EU-X7 vor — [bimmer.work VIN](https://bimmer.work/vin/94658dd06a9ada0541086ff7e251c8da0) und Beispiel-VIN des Users.

### Inferences
- Stelle 11 = '9' bei beiden EU-Beispielen und bei den US-VINs → Spartanburg. **unsicher** als allgemeine BMW-Regel (nur durch ein dekodiertes Beispiel gestützt).
- Stelle 10 darf für EU-Fahrzeuge **nicht** als Modelljahr ausgewertet werden ('0' möglich), bei `5UX` schon.
- Stelle 8: in allen Beispielen '0'. Bedeutung (bei US-VINs traditionell Rückhaltesystem/Zusatzcode) **unsicher**, für Mustererkennung ignorieren.
- US pre-LCI: VIN-Stelle 4–7 = CW2C (xDrive40i), CX4C (xDrive50i), CX6C (M50i), also Typschlüssel-Stelle 1–3 + 'C'. CW2C belegt über fleetchaser, CX6C nur über ein unklares bumper.com-Snippet → **unsicher**. Für US-LCI ist 4–7 = 23EM/33EM/43EM, belegt für 23EM.
- Für EU-Muster: `^WBA(CW81|CW82|TB41|TB42|CW01|CW02|CW21|CW22|CX41|CX61|21EM|22EM|21EN|22EN|31EM|32EM|41EM|42EM)`.

### Gaps
- Kein offizielles BMW-Dokument zur VIN-Struktur gefunden (Werkscodes, Stelle 8).
- NHTSA vPIC wurde nicht abgefragt (würde für 5UX-VINs Herstellerangaben liefern, aber keine EU-WBA-Varianten).

## Öffentliche Quellen und Nutzungsbedingungen

### Takeaway
bimmer.work ist die ergiebigste frei abrufbare Quelle (eine Seite je Typschlüssel), nennt aber keine Nutzungsbedingungen. realoem.com und Leebmann24 blocken automatisierte Abrufe (403).

### Cited Findings
- bimmer.work: je Typschlüssel eine Seite mit Modell, Markt, Lenkung, Motorcode, keine Terms-of-Use-Angabe auf der Seite gefunden — [bimmer.work 21EM](https://bimmer.work/model/g07/21em/)
- Leebmann24 (BMW-Händler-Teileshop): Kompatibilitätstabellen mit Typschlüssel, Motor, Bauzeitraum, blockt Abruf (HTTP 403) — [Leebmann24](https://www.leebmann24.com/de/de/product/bmw-betriebsanleitung-g07-10043847)
- realoem.com: Abruf der G07-Modellliste mit HTTP 403 abgelehnt — [realoem](https://www.realoem.com/)
- Wikipedia BMW X7 führt Varianten/Motoren, aber keine Typschlüssel — [Wikipedia BMW X7](https://en.wikipedia.org/wiki/BMW_X7)
- BMW-Preisliste DE (G07, 2022) als Quelle für Modellprogramm — [BMW Preisliste G07](https://www.bmw.de/content/dam/bmw/marketDE/bmw_de/new-vehicles/pdf/Desktop/Preisliste_G07_II_28_05.pdf.asset.1654696928448.pdf) (nicht ausgewertet)

### Inferences
- Für die App eine eigene, kleine statische Tabelle (wie oben) pflegen statt Daten von bimmer.work/realoem zu scrapen. Fakten (Code → Modell) sind nicht urheberrechtlich geschützt, die Datenbank als Ganzes ggf. schon (Datenbankherstellerrecht in der EU), daher **nicht** massenhaft übernehmen.

### Gaps
- Nutzungsbedingungen von realoem, bimmer.work, mdecoder nicht einsehbar/nicht gefunden.
- BMW-Typschlüssel stehen nicht in der Zulassungsbescheinigung (dort HSN/TSN, z. B. HSN 0005), Zuordnung HSN/TSN ↔ Typschlüssel nicht recherchiert.
