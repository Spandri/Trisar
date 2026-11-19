# Audi A6 C8 (und A7 C8) aus der FIN erkennen, EU-Markt

Kennzeichnung: **belegt** = mit Quelle, **unsicher** = Schluss oder nicht sauber belegt.
Hauptquelle ist Audis eigenes "VIN Breakdown"-Dokument für US-Modelle, das bei der NHTSA (vPIC, Manufacturer Information) hinterlegt ist. Für EU-FINs gibt es keine öffentliche Audi-Tabelle. Die EU-Muster sind deshalb an echten FINs aus Gebrauchtwagen- und Auktionslisten geprüft (Prüfziffer jeweils nachgerechnet).

## Stellen 1–8: WMI, ZZZ, Modellcode (F2)

### Takeaway
EU-FINs für A6/A7 C8 haben das Muster `W(AU|UA)ZZZF2…`. Stelle 7–8 = **F2** gilt für die ganze C8-Familie, also A6 Limousine, Avant, allroad, S6, RS 6, A7, S7 und RS 7. **Die FIN unterscheidet Limousine, Avant, allroad und A7 nicht.** Nur die WMI `WUA` (Audi Sport GmbH) trennt RS 6/RS 7 (und laut Audi auch andere RS-Modelle) vom Rest.

### Cited Findings
- WMI laut Audi: `TRU` = Audi Hungaria Zrt. (Ungarn), `WAU` = Audi AG (Deutschland), `WUA` = Audi Sport GmbH (Deutschland). RS 6 Avant, RS 7 Sportback, RS 5 und RS 3 bekommen die WMI `WUA`. **belegt** — [Audi VIN Breakdown MY2019 (NHTSA)](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad); [Audi VIN Breakdown MY2024, Rev. 16 vom 27.06.2025 (NHTSA)](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23)
- Stelle 7–8 im Audi-Dokument MY2019: `F2` = A6 Sedan **und** A7 Sportback, `F4` = A4/S4 Sedan und A4 allroad. **belegt** — [MY2019](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad)
- Stelle 7–8 im Audi-Dokument MY2024: `F2` = "A6/S6 Sedan/A6 allroad/RS6 Avant performance/A7/S7/RS7 performance Sportback". Weitere Codes in derselben Tabelle: `GY` A3/S3/RS3 Sedan, `F4` A4/S4 und A4 allroad, `F5` A5/S5/RS5, `F8` A8 L/S8, `FW` e-tron GT, `F3` Q3, `FZ` Q4 e-tron, `FY` Q5/SQ5, `F7` Q7/SQ7, `F1` Q8/SQ8/RS Q8, `GE` Q8 e-tron. **belegt** — [MY2024](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23)
- In US-FINs tragen die Stellen 4–6 Serie/Ausstattung, Motor und Rückhaltesystem, z. B. A6-Sedan-Serie `K/L/M` (MY2019) oder `D/E/F` (MY2020). In EU-FINs stehen dort `ZZZ`. **belegt** für US — [MY2019](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad), [MY2020](https://vpic.nhtsa.dot.gov/mid/home/displayfile/4f44d651-e115-4c3a-9002-e63e775ec51d). Für EU nur durch Beispiel-FINs gestützt (alle unten haben `ZZZ`). Laut einem Lexikon füllen VW/Audi unbenutzte Stellen mit `ZZZ` (Sekundärquelle, **unsicher**) — [biketrailspfannenstiel.ch](https://biketrailspfannenstiel.ch/auskunft/fin-nummer-motorrad/)
- EU-Beispiel-FINs mit `F2`:
  - `WAUZZZF26KN005829`: A7 Sportback 50 TDI, Auktion Belgien — [carsbat](https://carsbat.com/en/detail/wauzzzf26kn005829-oo5syu/)
  - `WAUZZZF29MN002779`: A7 Sportback 50 — [autoua](https://autoua.com.ua/vin/WAUZZZF29MN002779?lang=en)
  - `WAUZZZF2XMN082433`: A6 2021, Kombi (Avant) — [carsbat](https://carsbat.com/en/detail/wauzzzf2xmn082433-7mcive/)
  - `WAUZZZF21MN006552`: A6 2021, 2.0 Hybrid (also 50/55 TFSI e), Schweden — [carsbat](https://carsbat.com/en/detail/loggain-noyukn/)
  - `WAUZZZF22MN012893`: A6 2021, 2.0 Hybrid — [carsbat](https://carsbat.com/en/detail/loggain-of5iqd/)
  - `WAUZZZF24NN060428`: A6 2022, 2.0, Polen — [carsbat](https://carsbat.com/en/detail/wauzzzf24nn060428-4enqj2/)
  - `WAUZZZF20NN008309`: A6 2022 — [carsbat](https://carsbat.com/en/detail/wauzzzf20nn008309-4genb2/)
  - `WAUZZZF24MN039044`: A6 2021, Belgien — [carsbat](https://carsbat.com/de/detail/wauzzzf24mn039044-jfun6e/)
  - `WUAZZZF29NN901973`: RS 6 Avant 2022 — [classic.com](https://www.classic.com/veh/2022-audi-rs6-avant-vorsprung-wuazzzf29nn901973-4AwKzqW)
  - `WUAZZZF2XMN904749`: als "A6 2021" gelistet, wegen `WUA` aber wahrscheinlich RS 6 oder RS 7 (**unsicher**) — [carsbat](https://carsbat.com/en/detail/wuazzzf2xmn904749-3a6btw/)
  - 17vin.com listet rund 20 FINs mit `WAUZZZF2` für den A7 Sportback 40 TFSI 2023 (China-Markt). — [17vin](https://www.17vin.com/model/h7blf.html)
- US-Gegenstücke haben ebenfalls F2 an Stelle 7–8, z. B. A6 allroad `WAU72BF2…`/`WAU92BF2…`, A7 `WAUU2AF2…`, RS 6 `WUA1DBF22TN901832`. **belegt** — [bumper A6 allroad](https://www.bumper.com/vin-decoder/audi/a6-allroad/), [forcar RS 6 Avant](https://forcar.org/vin-decoder/audi/rs-6-avant/), [fleetchaser A7](https://fleetchaser.com/vin/2020/audi/a7/WAUV2AF20KN073791/)

### Inferences
- Regex für die C8-Familie (A6/A7, alle Varianten), EU: `^W(AU|UA)ZZZF2[0-9X][A-HJ-NPR-TV-Y][A-Z0-9][0-9]{6}$`. US-Form: `^W(AU|UA)[A-Z0-9]{3}F2…`. Allgemeiner: Stelle 7–8 = `F2` und WMI `WAU`/`WUA`. **unsicher**, Schluss aus den Belegen oben.
- `WUA` + `F2` → RS 6 Avant oder RS 7 Sportback. `WAU` + `F2` → A6 Limousine/Avant/allroad, S6/S7 oder A7. Eine feinere Trennung geht aus der EU-FIN nicht. **unsicher** (Schluss). Im US-Dokument laufen S6/S7 unter WAU, nur RS unter WUA.
- RS-FINs aus dem Neckarsulmer Audi-Sport-Bereich scheinen in der Seriennummer bei 90xxxx zu liegen (901973, 904749, 901832), normale A6 bei 0xxxxx. Das sind nur drei Stichproben, also **unsicher**.
- Vorgänger C7 nutzte vermutlich den Typcode `4G` an Stelle 7–8 (z. B. `WAUZZZ4G…`). **unsicher**, keine Quelle abgerufen. Damit trennt `F2` sauber zwischen C8 (ab MJ 2019) und C7.
- Die neue A6-Generation (A6 e-tron auf PPE, 2024/25, und der Verbrenner-A6 C9 ab 2025) dürfte einen anderen Code tragen. Nicht geprüft, **unsicher**. Bei Fahrzeugen ab MJ 2025 deshalb nicht blind `F2` = "alter A6" annehmen.

### Gaps
- Keine EU-FIN eines A6 allroad und keine einer A6 Limousine, bei der die Karosserie eindeutig als Limousine ausgewiesen ist. Die Listen geben oft nur "A6" an. Dass auch das allroad in der EU `F2` trägt, ist nur über das US-Dokument und den gemeinsamen Code belegt.
- Keine offizielle Audi-Tabelle für EU-FINs gefunden. Audi veröffentlicht nur die US-Breakdowns über NHTSA.

## Stelle 9 (Prüfziffer), 10 (Modelljahr), 11 (Werk)

### Takeaway
Stelle 9 ist bei EU-Audis eine **echte Prüfziffer** nach dem NHTSA-Verfahren, kein `Z`. Stelle 10 ist das Modelljahr: K=2019, L=2020, M=2021, N=2022, P=2023, R=2024, S=2025, T=2026. Stelle 11 ist das Werk. Für A6/A7 C8 ist das `N` = Neckarsulm.

### Cited Findings
- Laut Audi wird Stelle 9 "per NHTSA" berechnet. **belegt** — [MY2024](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23)
- Die Prüfziffer wurde für alle 8 EU-Beispiel-FINs oben nachgerechnet (Gewichte 8-7-6-5-4-3-2-10-0-9-8-7-6-5-4-3-2, mod 11, 10 → `X`). Alle 8 stimmen, darunter `WAUZZZF2XMN082433` (X) und `WUAZZZF29NN901973` (9). **belegt** durch eigene Rechnung auf Basis der FINs aus den Quellen oben.
- Modelljahr-Codes K=2019, L=2020, M=2021 stehen in Audis MY2020-Dokument, J=2018 in MY2019, R=2024 in MY2024. **belegt** — [MY2020](https://vpic.nhtsa.dot.gov/mid/home/displayfile/4f44d651-e115-4c3a-9002-e63e775ec51d), [MY2024](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23). P=2023 und N=2022 nennt ein Drittanbieter. — [Suchergebnis vincheck/clearvin, Sekundärquelle](https://vincheck.info/report/audi/a6-allroad/2020). S=2025 und T=2026 folgen dem Standardschema. Der US-RS-6 `WUA1DBF22TN901832` passt zu T. — [forcar](https://forcar.org/vin-decoder/audi/rs-6-avant/)
- EU-Beispiel `WAUZZZF26KN005829` (K = MJ 2019) wird als "2018 year" gelistet. Das passt zu einem Modelljahr, das vor dem Kalenderjahr beginnt, also Erstzulassung 2018 mit MJ 2019. — [carsbat](https://carsbat.com/en/detail/wauzzzf26kn005829-oo5syu/). Dass Stelle 10 auch bei EU-Audis das Modelljahr ist, folgt aus der Konsistenz der Beispiele (K/M/N passend zu den Listen) und ist **teilweise unsicher**. Eine offizielle EU-Aussage fehlt.
- Werkcodes laut Audi: `A` Ingolstadt, `N` Neckarsulm, `7` Heilbronn (Böllinger Höfe, MY2024), `1` Győr (Ungarn), `B` Brüssel, `P` Zwickau (Update 27.06.2025). **belegt** — [MY2019](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad), [MY2024](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23)
- Alle A6/A7/RS-6-Beispiele oben haben `N` an Stelle 11, also Neckarsulm. **belegt** über die Beispiel-FINs.
- Stelle 12–17 ist die laufende Produktionsnummer. **belegt** — [MY2019](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad)

### Inferences
- Für eine Plausibilitätsprüfung im Programm Prüfziffer, `F2` und `N` zusammen prüfen. Ein A6/A7 C8 aus einem anderen Werk als `N` wäre auffällig. Für China-FINs aus Lokalfertigung (FAW-Audi, WMI `LFV`) gilt das nicht. **unsicher**

### Gaps
- Keine Primärquelle dafür, dass Audi die Prüfziffer in EU-FINs offiziell immer setzt. Belegt ist es nur durch die Stichprobe (8/8 gültig).

## Motor/Kraftstoff (TDI, TFSI, TFSI e) aus der FIN?

### Takeaway
**Bei EU-FINs nein.** Die Stellen 4–6, in denen die US-FIN den Motor kodiert, sind in der EU `ZZZ`. Motor und Kraftstoff kommen aus anderen Quellen: Zulassungsbescheinigung Teil I (Kraftstoff P.3, Leistung P.2, Hubraum P.1), Fahrzeugdatenträger bzw. PR-Codes und Motorkennbuchstaben (Serviceheft, Aufkleber im Kofferraum), OBD-Daten oder eine kostenpflichtige Herstellerabfrage.

### Cited Findings
- Bei US-FINs kodiert Stelle 5 den Motortyp, z. B. A6/A7 quattro 3.0L = `2` (MY2019) und A6 Sedan 2.0L = `8` (MY2020). **belegt** — [MY2019](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad), [MY2020](https://vpic.nhtsa.dot.gov/mid/home/displayfile/4f44d651-e115-4c3a-9002-e63e775ec51d)
- Alle EU-Beispiel-FINs haben an Stelle 4–6 `ZZZ`, obwohl darunter TDI, 2.0 TFSI, Hybrid und RS sind. Die FIN unterscheidet den Antrieb also nicht. **belegt** über die Beispiele oben (z. B. A7 50 TDI `WAUZZZF26KN005829` gegenüber A6 Hybrid `WAUZZZF21MN006552`).
- Ein deutscher Ratgeber (mobile.de) sagt, die FIN allein verrate die Ausstattung nicht. Dafür brauche man Herstellerdaten. Der Artikel wurde nur über das Suchergebnis gesehen, nicht im Volltext gelesen. — [mobile.de Magazin](https://www.mobile.de/magazin/artikel/was-die-fahrgestellnummer-ueber-die-ausstattung-verraet-8008), **unsicher**
- Ein US-Decoder hinweist, dass die FIN Karosserie (Sedan/Sportback) nicht als eigenen Code ausweist. — [vindecoderplus](https://vindecoderplus.com/audi-a7-vin-decoder/)

### Inferences
- Für die Flotte bedeutet das: Die FIN liefert "Audi A6/A7 C8 (F2), Modelljahr, Werk, RS ja/nein (WUA)". Karosserie (Avant/Limousine/allroad/A7) und Antrieb (TDI/TFSI/TFSI e) müssen aus den Fahrzeugpapieren oder vom Tracker kommen, z. B. aus OBD-Kraftstofftyp (PID 0x51) oder aus dem Ladezustand, wenn ein Hybrid erkannt wird. **unsicher** (Vorschlag)
- Das Feld D.2 (Typ/Variante/Version) der Zulassungsbescheinigung enthält Audis EU-Typschlüssel, aus dem die Karosserie ablesbar sein könnte. Nicht recherchiert, **unsicher**.
- Das NHTSA-vPIC-API kann EU-FINs mit `ZZZ` nicht sinnvoll dekodieren. Die Tabellen dort gelten nur für US-Fahrzeuge. **unsicher** (nicht getestet)

### Gaps
- Keine freie Quelle, die EU-FIN → Motor/Karosserie auflöst. Das bieten nur kostenpflichtige Dienste (Audi/ETKA-basierte Abfragen, carVertical u. ä.).

## Frei nutzbare Listen der Modellcodes (Stelle 7–8)

### Takeaway
Die beste freie Liste sind Audis eigene "VIN Breakdown"-PDFs pro Modelljahr bei NHTSA vPIC (Manufacturer Information Documents). Sie sind öffentlich, offiziell und enthalten die vollständige Code-Tabelle für Stelle 7–8 (US-Modelle). Da Stelle 7–8 in den Beispielen in EU und US identisch ist (F2), lassen sie sich auf EU-FINs übertragen.

### Cited Findings
- MY2019 Pkw: [vpic 1edced14…](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad); MY2019 weitere Fassung: [vpic d4b263c2…](https://vpic.nhtsa.dot.gov/mid/home/displayfile/d4b263c2-a8d5-4767-bd9b-64099497cf73); MY2020: [vpic 4f44d651…](https://vpic.nhtsa.dot.gov/mid/home/displayfile/4f44d651-e115-4c3a-9002-e63e775ec51d); MY2024 (Rev. 16, Juni 2025): [vpic fe3d103e…](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23). **belegt**
- Drittanbieter-Decoder wie carVertical beschreiben Stelle 7–8 als "Aufbauvariante und Motortyp". Das widerspricht Audis Tabelle (dort: Modell). Solche Seiten sind nicht als Quelle geeignet. — [carVertical](https://www.carvertical.com/de/audi-vin-decoder)

### Inferences
- Rechtlich sind NHTSA-Dokumente als US-Behördendaten frei zugänglich. Ob sie als Tabelle in eigene Software übernommen werden dürfen, wurde nicht geprüft. Es handelt sich aber um reine Fakten-Codes. **unsicher**

### Gaps
- Keine entsprechende öffentliche EU-Liste (z. B. KBA) gefunden, die Stelle 7–8 der FIN auf Modelle abbildet.
