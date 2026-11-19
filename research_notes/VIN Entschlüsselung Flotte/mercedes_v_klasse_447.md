# Mercedes-Benz V-Klasse Baureihe 447: VIN entschlüsseln (EU-Markt)

Kennzeichnung: **belegt** = mit Quelle, **unsicher** = Schluss aus Beispielen oder nicht bestätigt.

Wichtigster Befund vorab: Es gibt **zwei verschiedene VIN-Formate** für die 447.
1. **Altes EU-Format** (WDF ab 2014, dann W1V bis ca. Modelljahr 2022): Stellen 4–9 = Baumuster `447.8xx`, keine Prüfziffer, kein Modelljahr.
2. **Neues Format ab ca. Modelljahr 2023** (`W1VV...`): Stellen 4–8 Buchstabencode, Stelle 9 = gültige ISO-3779-Prüfziffer, Stelle 10 = Modelljahr-Buchstabe (P=2023, R=2024, S=2025, T=2026), Stelle 11 = Werk. Das Baumuster steht dann **nicht** mehr in der VIN.

## Welcher WMI (Stellen 1–3) gilt wann? W1V, WDF, VSA

### Takeaway
447er aus Vitoria tragen zuerst `WDF`, später `W1V`. Der Wechsel lag zwischen Ende 2019 und 2020 (Beispiele: WDF bei Modell 2019, W1V bei Modell 2020/2021). `VSA` gehört zur ersten Vito/V-Klasse W638, nicht zur 447.

### Cited Findings
- WDF = Daimler AG Nutzfahrzeuge (Citan, Vito/V-Klasse, X-Klasse). W1V = Daimler AG / Mercedes-Benz Group AG, Mercedes-Benz Van. VSA = Mercedes-Benz España SA (erste Vito/V-Klasse W638) — **belegt** [Wikibooks Mercedes VIN Codes](https://en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/Mercedes-Benz/VIN_Codes)
- "Seit 2018 vergibt Mercedes die neuen WMI W1K (Pkw), W1N (SUV- und EQ-Modelle) und W1V (Transporter)" — **belegt (Sekundärquelle, Händler-Blog)** [Carlytics](https://www.carlytics.eu/de/blog/mercedes-benz-vin-decoder)
- Umfirmierung Daimler AG zu Mercedes-Benz AG am 01.11.2019 (wahrscheinlicher Anlass für den WMI-Wechsel) — **belegt** laut NHTSA-Recall-Unterlage, zitiert in Suchergebnis [NHTSA RCLRPT 21V237](https://static.nhtsa.gov/odi/rcl/2021/RCLRPT-21V237-1498.PDF)
- Beispiel-VINs im alten Format mit WDF, Modell 2019: `WDF44781123514006` (V-Klasse 2019, 2.1 Diesel, verkauft UK) und `WDF44781113591149` (V-Klasse 2019, 1.9) — **belegt** [carsbat 1](https://carsbat.com/en/detail/wdf44781123514006-gmzlo5/), [carsbat 2](https://carsbat.com/en/detail/wdf44781113591149-rfpj3t/)
- Beispiel-VINs mit W1V im alten Format: `W1V44781113733208` (V 2020), `W1V44781313882665` (V 2021, 300d), `W1V44781313852658` (V 2021), `W1V44781313887596` (V 2021) — **belegt** [carsbat](https://carsbat.com/de/detail/w1v44781113733208-3ak98o/), [carsbat](https://carsbat.com/de/detail/w1v44781313882665-aahahw/), [carsbat](https://carsbat.com/de/detail/w1v44781313852658-lselus/)
- Produktion in Vitoria-Gasteiz (Spanien). Der US-Metris kommt aus Ladson (USA) — **belegt** [Wikipedia DE Baureihe 447](https://de.wikipedia.org/wiki/Mercedes-Benz_Baureihe_447)

### Inferences
- Genaues Umstellungsdatum WDF zu W1V ist **unsicher**. Aus den Beispielen liegt es zwischen Modell 2019 und 2020, passend zum Firmenwechsel 11/2019.
- Für die Erkennung reicht `^(WDF|W1V)447` (altes Format) bzw. `^W1VV` (neues Format, Abgrenzung siehe unten). `VSA` für 447 nicht erwarten — **unsicher**, aber kein einziges 447-Beispiel mit VSA gefunden.

### Gaps
- Keine offizielle Mercedes-Quelle mit Datum des WMI-Wechsels für Vans gefunden.

## Baumuster in Stellen 4–9 (altes Format): V-Klasse vs. Vito vs. Marco Polo vs. EQV, Länge, Motor

### Takeaway
Im alten Format sind Stellen 4–9 das Baumuster ohne Punkt: `447811` = 447.811. Die 4. Ziffer des Baumusters (VIN-Stelle 7) trennt Kastenwagen (6), Vito Tourer/Mixto/Marco Polo Activity (7) und V-Klasse/Marco Polo/Horizon (8). Die 6. Ziffer (VIN-Stelle 9) gibt die Länge an. Motor, Kraftstoff und EQV vs. Diesel lassen sich daraus **nicht** ablesen.

### Cited Findings
- Aufbau 447.abc: 447 = Baureihe; 4. Ziffer 6 = Kastenwagen, 7 = Kombi/Mixto oder Marco Polo ACTIVITY, 8 = V-Klasse/Marco Polo bzw. HORIZON; 5. Ziffer 0 = gewerblich, 1 = privat (nur intern); 6. Ziffer 1 = kompakt (4.895 mm), 3 = lang (5.140 mm), 5 = extralang (5.370 mm) — **belegt** [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/)
- Tabelle laut mbpassion.de — **belegt** [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/):

| Baumuster | Modell | Länge |
|---|---|---|
| 447.601 / .603 / .605 | Vito Kastenwagen | kompakt / lang / extralang |
| 447.701 / .703 / .705 | Vito Mixto, Vito Tourer | kompakt / lang / extralang |
| 447.703 | Marco Polo ACTIVITY | lang |
| 447.811 / .813 / .815 | V-Klasse | kompakt / lang / extralang |
| 447.813 | Marco Polo, Marco Polo HORIZON | lang |

- Laut Kommentar unter dem mbpassion-Artikel ist der Motor aus dem Baumuster bei VS20 nicht erkennbar ("nur der Aufbau etc. ersichtlich") — **belegt** [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/)
- EQV 300 und EQV 250 laufen ebenfalls unter 447.813 / 447.815 (Teile-/Fahrwerkskataloge) — **belegt (Sekundärquelle, Suchergebnis-Zusammenfassung)**, Beispiel-VIN `W1V44781313886087` als EQV 2021 (204 PS) — [carsbat EQV](https://carsbat.com/de/detail/w1v44781313886087-omaxln/), ebenso `W1V44781313839576` als EQV 2021 [carsbat](https://carsbat.com/en/detail/w1v44781313839576-e26u9v/)
- Ersatzteilhändler ordnen Motoren mehreren Baumustern gleichzeitig zu (z. B. V 300 d auf 447.811/813/815) — **belegt** [meyermotoren.de](https://www.meyermotoren.de/fahrzeuge/2000011889/mercedes-benz/v-klasse_w447_)
- Vito-Beispiele im W1V-Altformat: `W1V44760313929782` (Vito 2021, 447.603) und `W1V44770313900786` (Vito 2021, 447.703) — **belegt** [carsbat Vito](https://carsbat.com/de/detail/w1v44760313929782-mo9gpl/), [carsbat Vito](https://carsbat.com/de/detail/w1v44770313900786-uderd7/)
- Motoren: bis 2019 V 200 CDI, V 220 CDI, V 250 BlueTEC (OM 651, OM 622, M 274). Ab 2019 V 220 d, V 250 d, V 300 d (OM 654), V 300 Benziner (M 254). Elektro EQV 300 (150 kW, ab 2020) und EQV 250 (ab Ende 2021). eVito ab 2018. Facelifts 03/2019 und 07/2023 — **belegt** [Wikipedia DE](https://de.wikipedia.org/wiki/Mercedes-Benz_Baureihe_447)
- Marco Polo und Horizon auf V-Klasse-Basis, Activity auf Vito-Basis — **belegt** [Wikipedia DE](https://de.wikipedia.org/wiki/Mercedes-Benz_Baureihe_447)

### Inferences
- Regex altes Format, V-Klasse-Familie (inkl. Marco Polo, Horizon, EQV): `^(WDF|W1V)4478[01][135]` — **unsicher** für die 5. Ziffer 0 (gewerblich). In allen Beispielen steht `4478 1`.
- Länge aus VIN-Stelle 9: `1` kompakt, `3` lang, `5` extralang — belegt über Baumuster-Tabelle.
- Vito-Abgrenzung: Stelle 7 = `6` (Kastenwagen) oder `7` (Tourer/Mixto/Marco Polo Activity). eVito liegt vermutlich ebenfalls auf 447.6xx/7xx — **unsicher**, keine Quelle gefunden.
- **Nicht** aus der VIN (altes Format): Motor (V 220 d/250 d/300 d), Diesel vs. Benzin vs. Elektro (EQV teilt 447.813/815 mit Diesel), Marco Polo vs. normale V-Klasse lang (beide 447.813), Sitzanzahl. Dafür braucht es Zulassungsbescheinigung (HSN/TSN, Feld P.3 Kraftstoff, Feld S.1 Sitzplätze) oder einen EPC/Datenkarten-Abruf.

### Gaps
- Keine Herstellerquelle (EPC/WIS) öffentlich mit vollständiger 447-Baumusterliste inkl. eVito/EQV gefunden. Die Suffixe `.13` usw. (7.–8. Stelle des vollen Baumusters) erscheinen nicht in der VIN.

## Beispiel-VINs: wie das Baumuster in der VIN steht

### Takeaway
`W1V 447813 1 3 882665` = WMI, Baumuster 447.813, Stelle 10 Lenkung (1 = links), Stelle 11 Werk (3 = Vitoria), Stellen 12–17 laufende Nummer.

### Cited Findings
- `W1V44781313882665` V-Klasse 2021, 300d (447.813 = lang) — **belegt** [carsbat](https://carsbat.com/de/detail/w1v44781313882665-aahahw/)
- `WDF44781123514006` V-Klasse 2019 (447.811 = kompakt), in UK verkauft, Stelle 10 = 2 — **belegt** [carsbat](https://carsbat.com/en/detail/wdf44781123514006-gmzlo5/)
- Teil-VIN `W1V447815139...` V-Klasse 2021 (447.815 = extralang) — **belegt** laut Suchergebnis [eBay](https://www.ebay.de/itm/166953019087)
- Eigene Prüfung: Im alten Format stimmt die ISO-3779-Prüfziffer an Stelle 9 nicht (getestet an 3 VINs). Stelle 9 ist also Baumuster-Ziffer, keine Prüfziffer — **belegt durch Rechnung** an den obigen Beispiel-VINs.

### Inferences
- Die UK-VIN mit Stelle 10 = `2` passt zur Angabe "1 für Linkslenker und 2 für Rechtslenker" (siehe nächster Abschnitt).

### Gaps
- Keine Recall- oder KBA-Dokumente mit vollständigen EU-447-VINs gefunden.

## Stellen 9, 10, 11: Prüfziffer und Modelljahr?

### Takeaway
Altes Format: keine Prüfziffer, kein Modelljahr. Stelle 10 = Lenkung (1 links, 2 rechts), Stelle 11 = Werk. Neues Format (`W1VV...`, ab ca. MJ 2023): Stelle 9 echte Prüfziffer, Stelle 10 Modelljahr-Buchstabe, Stelle 11 = `4` (Vitoria).

### Cited Findings
- "Position 10 gibt dann die Lenkposition an, 1 für Linkslenker und 2 für Rechtslenker", bei EU-Fahrzeugen "KEIN Baujahr-Code" — **belegt (Händlerseite)** [mrvin.com](https://www.mrvin.com/de/vin-decoder/mercedes-benz/)
- "Stelle 10 ist bei europäischen Mercedes kein Modelljahr-Code. Dort steht meist eine 1" — **belegt (Händler-Blog)** [Carlytics](https://www.carlytics.eu/de/blog/mercedes-benz-vin-decoder)
- Werkscode Stelle 11: "3: Vitoria, Spain" und "4: Vitoria, Spain (When Position 1-3 is W1V)" — **belegt** [Wikibooks](https://en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/Mercedes-Benz/VIN_Codes). Die Beispiele zeigen `3` im alten Format (auch bei W1V) und `4` im neuen Format.
- Eigene Prüfung: 11 von 11 VINs im neuen Format (`W1VVMKFZ0S4500174`, `W1VVNLFZ9S4409357`, `W1VVLCEZ4R4383784` usw.) haben eine korrekte ISO-3779-Prüfziffer an Stelle 9. Stelle 10 passt zum Modelljahr der Anzeige: P = 2023, R = 2024, S = 2025, T = 2026 — **belegt durch Rechnung** an VINs aus [carsbat-Suchergebnissen](https://carsbat.com/en/detail/w1vvmkfz0s4500174-ott9bq/) und [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-300-d-exclusive-extralang-214575/)

### Inferences
- Parser-Regel: Wenn VIN `^(WDF|W1V)447` → altes Format (Baumuster lesen, kein Baujahr). Wenn `^W1VV` → neues Format (Prüfziffer prüfen, Modelljahr aus Stelle 10).
- Der genaue Start des neuen Formats ist **unsicher**. Frühestes Beispiel hat Modelljahr P (2023), passend zum Facelift 07/2023.

### Gaps
- Keine offizielle Mercedes-Bekanntmachung zum neuen Van-VIN-Format gefunden.

## Neues Format W1VV (ab ca. MJ 2023, Facelift 2024): Stellen 4–8

### Takeaway
Die Stellen 4–8 sind ein Buchstabencode. Aus Händleranzeigen lässt sich ablesen: Stelle 5 trennt Vito (L) und V-Klasse-Längen (M, N), Stelle 6 trennt Motoren (K = V 250 d, L = V 300 d), Stelle 7 trennt Antrieb (S = 4MATIC). Alles davon ist aus wenigen Beispielen geschlossen und **unsicher**.

### Cited Findings (Beispiele mit Modellangabe)
- `W1VVNLFZ1S4510246` V 300 d AVANTGARDE extralang, EZ 4/2025 — **belegt** [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-300-d-avantgarde-extralang-429575/)
- `W1VVNLFZXT4626045` V 300 d EXCLUSIVE extralang, EZ 3/2026 — **belegt** [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-300-d-exclusive-extralang-214575/)
- `W1VVMKSZ6T4587036` V 250 d Style lang, 140 kW, Allrad — **belegt** [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-250-d-style-lang-427601/)
- `W1VVMKEZ2S4439668` V 250 d STYLE lang, 140 kW, Hinterrad, Automatik — **belegt** [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-250-d-style-lang-425903/)
- `W1VVMKFZ0S4500174` V 2025, 1.9 Diesel 190 PS — **belegt** [carsbat](https://carsbat.com/en/detail/w1vvmkfz0s4500174-ott9bq/)
- Weitere V-Klasse: `W1VVMLFZ3S4472005`, `W1VVMLEZ7P4289859`, `W1VVMJEZ5P4323916` (Minibus), `W1VVNLTZ5P4301815`, `W1VVNKSZ7P4280932` — **belegt** (nur "Mercedes-Benz V", ohne Motor/Länge) [carsbat-Suchergebnisse](https://carsbat.com/de/detail/w1vvmlfz3s4472005-wumgtb/)
- Vito Tourer: `W1VVMFSZ2P4324300`, `W1VVMFFZ8S4434769`. Vito: `W1VVLCEZ4R4383784`, `W1VVLBEZ6S4416770`, `W1VVLFFZ1R4378090` — **belegt** [carsbat](https://carsbat.com/fr/detail/w1vvmfsz2p4324300-y5e0fx/), [carsbat](https://carsbat.com/de/detail/w1vvlcez4r4383784-jpbqdv/)

### Inferences (alle unsicher)
- Stelle 4 = `V` bei allen 447-Vans.
- Stelle 5: `M` = lang, `N` = extralang (V-Klasse-Beispiele). `L` nur bei Vito gesehen (kompakt oder Kastenwagen?). Vito Tourer auch mit `M`, also trennt Stelle 5 nicht V-Klasse von Vito.
- Stelle 6: `K` = 140 kW (V 250 d), `L` = 174 kW (V 300 d), `J` vermutlich V 220 d. Vito-Werte `B`, `C`, `F` gehören wohl zu Vito-Motoren (z. B. 116 CDI, 119 CDI). Die Abgrenzung V-Klasse vs. Vito Tourer läuft dann vermutlich über Stelle 6 (V-Klasse J/K/L, Vito Tourer F).
- Stelle 7: `S` = 4MATIC (Allrad), `E`/`F`/`T` = Hinterrad bzw. Varianten (Getriebe/Ausstattung?), unklar.
- Stelle 8: immer `Z`.
- EQV im neuen Format: kein Beispiel gefunden.

### Gaps
- Keine öffentliche Tabelle für das neue VDS (Stellen 4–8). Für belastbare Zuordnung mehr Paare VIN + Modell sammeln (eigene Flotte, Zulassungsbescheinigung) oder kostenpflichtigen Decoder/EPC nutzen.

## Öffentliche Baumuster-Listen

### Takeaway
Eine vollständige offizielle Liste ist öffentlich nicht verfügbar. Brauchbar: mbpassion.de (Aufbau + Längen), Wikipedia DE (Motoren/Zeiträume), Mercedes "Baumuster finden" (Abruf je FIN), ADAC-Autokatalog (Varianten je Zeitraum).

### Cited Findings
- Mercedes-Originalteile-Seite: Baumuster ist in der FIN enthalten bzw. dort abrufbar — **belegt** laut Suchergebnis [Mercedes Baumuster finden](https://originalteile.mercedes-benz.de/originalteile/baumuster-finden/)
- ADAC führt Varianten mit Bauzeiträumen, z. B. V 300 d extralang Edition 2023 (06/22–01/24), 174 kW, Radstand 3.430 mm — **belegt** [ADAC](https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift/325020/)
- EQV HSN 2222, TSN hängt von Motor/Getriebe/Aufbau ab — **belegt (Sekundärquelle)** [carwiki](https://carwiki.de/mercedes-eqv-hsn-tsn-schluesselnummer/)

### Inferences
- Für Motor, Kraftstoff und Sitzplätze ist HSN/TSN aus der Zulassungsbescheinigung verlässlicher als die VIN.

### Gaps
- KBA-Typgenehmigungsdaten mit Baumuster-Zuordnung nicht frei gefunden. Sitzanzahl ist in keinem VIN-Format codiert (keine Quelle dafür gefunden).
