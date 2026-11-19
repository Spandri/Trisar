# Nur BMW verrät seine Variante vollständig

Von den drei Flottenmodellen liefert nur der **BMW X7 G07** aus der europäischen VIN die genaue Variante samt Motor und Kraftstoff: Die Stellen 4–7 sind BMWs Typschlüssel, und die Beispiel-VIN `WBA21EN0309582583` ist damit ein **X7 xDrive40d LCI (ab 08/2022), Europa, Linkslenker, 3,0-l-Diesel B57D30T3 mit 259 kW** ([bimmer.work 21EN](https://bimmer.work/model/g07/21en/)). Bei der **Mercedes V-Klasse 447** zeigt die VIN im alten Format (WDF/W1V bis etwa Modelljahr 2022) das Baumuster und damit V-Klasse vs. Vito und die Länge, aber keinen Motor und keinen Kraftstoff. Im neuen Format `W1VV…` (ab etwa MJ 2023) gibt es Hinweise auf Länge und Motor, die bisher nur aus wenigen Händleranzeigen erschlossen sind. Beim **Audi A6 C8** sagt die EU-FIN nur „C8-Familie (A6/A7, Code F2), Modelljahr, Werk, RS ja/nein“, denn die Stellen 4–6 sind `ZZZ` ([Audi VIN Breakdown MY2024 bei NHTSA](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23)). **Sitzplätze stehen bei keinem der drei Hersteller in der VIN.** Für Kraftstoff, Leistung und Sitzplätze ist die Zulassungsbescheinigung Teil I (Felder P.1–P.3, S.1, HSN/TSN) die verlässliche und kostenlose Quelle. Für die Regeltabelle heißt das: BMW per Typschlüssel fest belegen, Mercedes und Audi nur bis zur Modellfamilie automatisch erkennen und den Rest einmal je Fahrzeug aus den Papieren nachtragen.

## Drei Hersteller nutzen die Stellen 4–9 völlig unterschiedlich

Alle drei VINs folgen formal ISO 3779 (WMI in Stellen 1–3, Beschreibungsteil 4–9, Kennteil 10–17), aber was in den Stellen steht, legt jeder Hersteller selbst fest. In Europa ist weder die Prüfziffer an Stelle 9 noch das Modelljahr an Stelle 10 Pflicht, anders als in Nordamerika und China ([Wikipedia VIN](https://en.wikipedia.org/wiki/Vehicle_identification_number)). Ein Parser darf diese beiden Stellen deshalb nur herstellerabhängig auswerten.

| Stelle | Mercedes 447 alt (WDF/W1V) | Mercedes 447 neu (W1VV) | Audi A6 C8 (EU) | BMW X7 G07 (EU) |
|---|---|---|---|---|
| 1–3 | `WDF` bis ca. MJ 2019, danach `W1V` | `W1V` | `WAU` (Audi AG), `WUA` (Audi Sport, RS) | `WBA` (auch bei Bau in Spartanburg) |
| 4–9 | Baumuster `447.8x y` ohne Punkt | Buchstabencode 4–8, Stelle 9 Prüfziffer | `ZZZ` + Modellcode `F2` + Prüfziffer | Typschlüssel 4–7, Stelle 8 meist `0`, Stelle 9 Prüfziffer |
| 10 | Lenkung (1 links, 2 rechts), kein Modelljahr | Modelljahr (P=2023 … T=2026) | Modelljahr (K=2019 … T=2026) | `0` oder Modelljahr, nicht verlässlich |
| 11 | Werk (`3` = Vitoria) | Werk (`4` = Vitoria) | Werk (`N` = Neckarsulm) | Werk (`9` = Spartanburg, unsicher) |

Die Prüfziffer wurde für diesen Bericht an Beispielen nachgerechnet (Gewichte 8-7-6-5-4-3-2-10-0-9-8-7-6-5-4-3-2, mod 11, 10 = X). Sie stimmt bei der BMW-Beispiel-VIN (`3`), bei allen geprüften Audi-FINs und bei allen elf geprüften Mercedes-VINs im neuen Format. Im **alten Mercedes-Format stimmt sie nicht**, etwa bei `W1V44781313882665` (rechnerisch 4, tatsächlich 3), weil Stelle 9 dort Teil des Baumusters ist. Ein Plausibilitätscheck „Prüfziffer falsch = VIN falsch“ würde ältere V-Klassen also fälschlich verwerfen.

## Mercedes V-Klasse 447 zeigt Aufbau und Länge, aber keinen Motor

### Altes Format: Baumuster direkt in der VIN

Im alten Format stehen in den Stellen 4–9 die sechs Ziffern des Baumusters, `W1V447813…` ist also Baumuster 447.813. Die vierte Baumuster-Ziffer (VIN-Stelle 7) trennt **6 = Vito Kastenwagen, 7 = Vito Tourer/Mixto oder Marco Polo ACTIVITY, 8 = V-Klasse, Marco Polo, Marco Polo HORIZON**. Die sechste Ziffer (VIN-Stelle 9) gibt die Länge an: **1 = kompakt (4.895 mm), 3 = lang (5.140 mm), 5 = extralang (5.370 mm)**. Die fünfte Ziffer bedeutet 0 = gewerblich, 1 = privat ([mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/)). Echte VINs bestätigen das Schema, zum Beispiel `W1V44781313882665` als V 300 d lang von 2021 ([carsbat](https://carsbat.com/de/detail/w1v44781313882665-aahahw/)) und `WDF44781123514006` als V-Klasse kompakt von 2019 mit Rechtslenkung (Stelle 10 = `2`) ([carsbat](https://carsbat.com/en/detail/wdf44781123514006-gmzlo5/)). Alle gefundenen Beispiele haben an Stelle 8 eine `1`. Die Variante mit `0` ist deshalb nur aus der Baumuster-Systematik abgeleitet.

Die Grenzen sind hart. **Der Motor steht nicht im Baumuster**, ein V 220 d, V 250 d und V 300 d teilen sich 447.811/813/815 ([meyermotoren.de](https://www.meyermotoren.de/fahrzeuge/2000011889/mercedes-benz/v-klasse_w447_)). Auch der elektrische **EQV läuft unter 447.813 bzw. 447.815**, zum Beispiel `W1V44781313886087` als EQV 2021 ([carsbat](https://carsbat.com/de/detail/w1v44781313886087-omaxln/)). Aus einer alten 447-VIN lässt sich damit nicht einmal Diesel von Elektro trennen. Marco Polo und normale V-Klasse lang teilen sich ebenfalls 447.813.

Der Wechsel des WMI von `WDF` (Daimler Nutzfahrzeuge) auf `W1V` (Mercedes-Benz Van) fällt in die Zeit zwischen Modell 2019 und 2020 ([Wikibooks Mercedes VIN Codes](https://en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/Mercedes-Benz/VIN_Codes)). Ein offizielles Datum gibt es nicht. Für die Erkennung reicht es, beide WMIs zuzulassen. `VSA` gehört zur ersten V-Klasse W638 und taucht bei der 447 nicht auf.

### Neues Format W1VV: Hinweise, keine Tabelle

Ab etwa Modelljahr 2023 nutzt Mercedes für die Vans ein neues Format. Das Baumuster steht nicht mehr in der VIN, dafür gibt es eine echte Prüfziffer und an Stelle 10 das Modelljahr. Eine öffentliche Tabelle für die Stellen 4–8 existiert nicht. Aus Händleranzeigen mit Modellangabe lassen sich aber Muster ablesen. `W1VVNLFZ1S4510246` ist ein V 300 d extralang ([Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-300-d-avantgarde-extralang-429575/)), `W1VVMKEZ2S4439668` ein V 250 d lang mit Hinterradantrieb und `W1VVMKSZ6T4587036` ein V 250 d lang mit Allrad ([Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-250-d-style-lang-427601/)). Daraus folgt die Arbeitshypothese **Stelle 5: M = lang, N = extralang, Stelle 6: K = V 250 d (140 kW), L = V 300 d (174 kW), Stelle 7: S = 4MATIC**. Vito-Fahrzeuge zeigen an Stelle 6 andere Buchstaben (B, C, F) ([carsbat](https://carsbat.com/de/detail/w1vvlcez4r4383784-jpbqdv/)), Vito Tourer aber auch `M` an Stelle 5 ([carsbat](https://carsbat.com/fr/detail/w1vvmfsz2p4324300-y5e0fx/)). Die Trennung V-Klasse vs. Vito läuft im neuen Format also vermutlich über Stelle 6. Ein EQV im neuen Format wurde nicht gefunden. Alle Regeln für `W1VV` sind deshalb als **unsicher** zu führen, bis eigene Flottenfahrzeuge mit Zulassungsbescheinigung sie bestätigen.

## Audi A6 C8 lässt sich nur als Familie erkennen

Audi veröffentlicht seine VIN-Aufschlüsselung nur für US-Modelle, aber offiziell und frei bei der NHTSA. Dort steht der Modellcode an **Stelle 7–8 = `F2` für A6/S6 Limousine, A6 allroad, RS 6 Avant, A7/S7/RS 7 Sportback** ([Audi VIN Breakdown MY2024](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23), [MY2019](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad)). Europäische FINs tragen denselben Code, zum Beispiel `WAUZZZF2XMN082433` (A6 Avant 2021) ([carsbat](https://carsbat.com/en/detail/wauzzzf2xmn082433-7mcive/)) und `WAUZZZF26KN005829` (A7 Sportback 50 TDI) ([carsbat](https://carsbat.com/en/detail/wauzzzf26kn005829-oo5syu/)). Die Familie `^W(AU|UA)ZZZF2` ist damit gut gestützt, eine offizielle EU-Bestätigung fehlt aber.

Mehr gibt die EU-FIN nicht her. **Limousine, Avant, allroad und A7 sind nicht unterscheidbar**, und in den Stellen 4–6, wo die US-FIN den Motor kodiert, steht `ZZZ`. Ein A7 50 TDI (`WAUZZZF26KN005829`) und ein A6 Plug-in-Hybrid (`WAUZZZF21MN006552`) ([carsbat](https://carsbat.com/en/detail/loggain-noyukn/)) haben identische Stellen 1–8. Verwertbar sind drei weitere Merkmale. Der WMI `WUA` (Audi Sport GmbH) markiert RS 6 bzw. RS 7, Stelle 10 ist das Modelljahr (K=2019, L=2020, M=2021, N=2022, P=2023, R=2024, S=2025, T=2026) und Stelle 11 das Werk, bei der C8-Familie `N` für Neckarsulm ([MY2020](https://vpic.nhtsa.dot.gov/mid/home/displayfile/4f44d651-e115-4c3a-9002-e63e775ec51d)). Die Codes P, S und T sind über das Standardschema und Einzelbeispiele gestützt, nicht über ein Audi-Dokument für EU-Fahrzeuge. Vorsicht bei neuen Fahrzeugen ab MJ 2025: Der A6 e-tron und der Verbrenner-A6 C9 dürften einen anderen Modellcode haben, das wurde nicht geprüft. Eine A6 Limousine, die in einer Quelle eindeutig als Limousine ausgewiesen ist, fand sich unter den Beispielen nicht.

## BMW X7 G07 kodiert Variante, Motor und Markt im Typschlüssel

Die Stellen 4–7 einer BMW-VIN sind der Typschlüssel, und dieser steht für genau eine Kombination aus Modell, Motor und Markt. Die Codes stammen von bimmer.work (eine Seite je Typschlüssel), teils bestätigt durch Teilekatalog-Zeilen bei Leebmann24, etwa „X7 | G07 | xDrive40d | 21EN | … | 8/1/2022 – 7/31/2027“ ([Leebmann24](https://www.leebmann24.com/ch/en/product/bmw-cover-10381495)). Eine reale EU-VIN `WBA21EN0XS9Z95538` wird dort als xDrive40d, Markt Europa, Werk Spartanburg dekodiert ([bimmer.work VIN](https://bimmer.work/vin/94658dd06a9ada0541086ff7e251c8da0)). EU-Fahrzeuge aus dem US-Werk tragen also trotzdem `WBA`, US-Fahrzeuge dagegen `5UX` ([fleetchaser](https://fleetchaser.com/vin/2022/bmw/x7/5UXCW2C01N9M28518/)).

Die Codes folgen einem klaren Schema. Vor dem Facelift (12/2018–07/2022) gibt es Buchstabencodes wie `CW81`, `TB41`, `CW21`, nach dem Facelift „MUE“ (ab 08/2022) Codes wie `21EN`, `21EM`, `31EM`. Die letzte Ziffer der Zweiergruppe bedeutet in allen 24 gefundenen Codes **1 = Europa Linkslenker, 2 = Europa Rechtslenker, 3 = USA**. Das ist ein beobachtetes Muster, keine veröffentlichte BMW-Regel. Stelle 10 darf bei EU-X7 nicht als Modelljahr gelesen werden, denn die Beispiel-VIN hat dort `0`, die andere EU-VIN aber `S` (2025). Lücken bleiben beim ALPINA XB7 vor dem Facelift (kein Code gefunden), bei einem möglichen eigenen Code für den xDrive40i mit 48-V-Technik ab 2020 und beim Code `CX21` („xDrive30i“, vermutlich Sondermarkt). Der Code `CX53`, den Leebmann24 für einen M50i nennt, widerspricht bimmer.work (`CX61`) und bleibt unsicher.

## Was die VIN nie liefert und woher es stattdessen kommt

**Sitzplätze sind bei keinem der drei Hersteller in der VIN kodiert**, auch nicht bei der V-Klasse, wo sie je nach Bestuhlung zwischen sechs und acht schwanken. Bei Audi fehlen zusätzlich Karosserie und Antrieb, bei Mercedes im alten Format Motor und Kraftstoff (inklusive EQV). Auch HSN/TSN lassen sich nicht aus der VIN ableiten, und das KBA bietet keine solche Zuordnung an ([KBA Fahrzeugtypdaten](https://www.kba.de/EN/Themen_en/Typgenehmigung_en/CoC_Daten_Fahrzeugtypdaten_en/CoC_Daten_Fahrzeugtypdaten_node_en.html)).

Die beste Ersatzquelle ist die **Zulassungsbescheinigung Teil I** jedes Fahrzeugs: Feld P.3 Kraftstoff, P.2 Leistung, P.1 Hubraum, S.1 Sitzplätze, 2.1/2.2 HSN/TSN und D.2 Typ/Variante/Version. Diese Werte einmal je Fahrzeug zu erfassen kostet nichts und ist rechtlich unproblematisch. Die KBA-Listen der Hersteller- und Typschlüssel stehen als PDF bereit und dürfen laut KBA mit Quellenangabe vervielfältigt und weitergegeben werden ([KBA Urheberrechtshinweise](https://www.kba.de/EN/Service/Hinweise_en/urheberrechtliche_inhalt_en.html)). Damit lassen sich HSN/TSN im Klartext anzeigen. Der OBD-Tracker hilft nur begrenzt. Teltonika-FMB-Geräte übertragen die VIN als AVL-ID 256 ([Teltonika Wiki OEM Parameters](https://wiki.teltonika-gps.com/view/OEM_Parameters)), die in OBD Service 09 genormten Calibration IDs ([Wikipedia OBD-II PIDs](https://en.wikipedia.org/wiki/OBD-II_PIDs)) tauchen in der Teltonika-Parameterliste aber nicht auf. Für eine grobe Plausibilisierung (Diesel vs. Benzin vs. Elektro, etwa wenn ein EQV keine Kraftstoffwerte liefert) reichen die Live-Daten, für die Variante nicht.

Als bezahlter Rückfall für einzelne Fahrzeuge eignet sich **Vincario (früher vindecoder.eu) ab 0,49 €/VIN bei 100 Abrufen, mit 20 kostenlosen Test-Abrufen** ([Vincario Blog](https://vincario.com/blog/?p=698)). Ob Vincario 447, A6 C8 und X7 G07 bis zur Motorvariante auflöst und ob man die Ergebnisse dauerhaft speichern darf, ist nicht belegt und muss mit den Test-Abrufen und den AGB geprüft werden. DAT liefert Herstellerdaten mit Ausstattung, aber nur mit SilverDAT-Vertrag und **ausschließlich für Reparaturkalkulation und Fahrzeugbewertung** ([DAT Produktbeschreibung](https://www.dat.de/fileadmin/de/download/rechtliches/produktbeschreibung-silverdat-vin-abfrage.pdf)), für Flottenverwaltung also ungeeignet. Die Reparaturportale der Hersteller nach VO (EU) 2018/858 Anhang X sind kostenpflichtig und an den Reparaturzweck gebunden ([Annex X Appendix 2](https://legislation.gov.uk/eur/2018/858/annex/X/appendix/2)).

## Legal nutzbar sind wenige Quellen, und kaum eine deckt EU-Varianten ab

| Quelle | Inhalt für unsere Flotte | Nutzung |
|---|---|---|
| NHTSA vPIC inkl. Audi-„VIN Breakdown“-PDFs | WMI → Hersteller, Audi-Modellcodes (F2) | Frei, US-Open-Data, ohne Registrierung und Tageslimit ([vPIC FAQ](https://vpic.nhtsa.dot.gov/api/home/index/faq)). EU-VINs werden meist nur bis zum Hersteller aufgelöst ([vPIC About](https://vpic.nhtsa.dot.gov/About)) |
| KBA HSN/TSN-Listen (PDF) | Klartext zu HSN/TSN aus dem Fahrzeugschein | Frei mit Quellenangabe |
| Wikibooks Mercedes VIN Codes | WMI und VDS-Aufbau Mercedes | CC BY-SA 4.0, abgeleitete Tabellen müssen ebenso lizenziert und mit Namensnennung versehen werden ([Wikibooks](https://en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/Mercedes-Benz/VIN_Codes)) |
| bimmer.work, mdecoder, realoem, mbpassion.de | Typschlüssel BMW, Baumuster Mercedes | Keine Nutzungsbedingungen gefunden, realoem sperrt automatisierte Abrufe ([realoem](https://www.realoem.com/bmw/enUS/terms)). Nur als manuelle Referenz zum Gegenprüfen nutzen |
| Eigene Fahrzeuge (VIN + Fahrzeugschein) | Alles, was die Flotte braucht | Unproblematisch, beste Datenbasis |

Einzelne Fakten wie „21EN = xDrive40d“ sind nicht urheberrechtlich geschützt. Eine systematische Übernahme ganzer Decoder-Datenbanken kann aber das Datenbankherstellerrecht (§§ 87a ff. UrhG) und die AGB der Seiten verletzen. Die Seite ClassicDecoder etwa verbietet Scraping ausdrücklich ([ClassicDecoder Terms](https://classicdecoder.com/terms-and-conditions)). Die rechtliche Bewertung wurde nicht juristisch geprüft. Für eine kleine, handgepflegte Tabelle mit den Codes der eigenen drei Modelle ist das Risiko gering. Die Lizenzen der gefundenen MIT-lizenzierten GitHub-Decoder (`dnnr1/chassi`, `Wal33D/nhtsa-vin-decoder`) wurden nicht direkt geprüft, ebenso wenig, ob sie diese Modelle abdecken.

## Regeltabelle zum Einbauen

Die Regeln werden in der Reihenfolge der Tabelle geprüft, die erste Übereinstimmung gewinnt. Vorher die VIN normalisieren (Großbuchstaben, ohne Leerzeichen, 17 Zeichen, keine I/O/Q). Die Prüfziffer nur bei BMW, Audi und Mercedes `W1VV` als Plausibilitätscheck nutzen, nie beim alten Mercedes-Format. Felder mit „offen“ aus der Zulassungsbescheinigung füllen. **Sitzplätze sind in allen Regeln offen.**

**Sicherheit:** *belegt* = Code einzeln durch Quelle bestätigt. *gestützt* = Schema durch offizielle oder mehrere Quellen gedeckt, Einzelwert aus Systematik abgeleitet. *unsicher* = aus wenigen Beispielen erschlossen, vor produktivem Einsatz an eigenen Fahrzeugen bestätigen.

### BMW X7 G07 (Präfix `WBA` + Typschlüssel, Stellen 1–7)

| Muster (Regex) | brand_model | trim | fuel | Sicherheit | Quelle |
|---|---|---|---|---|---|
| `^WBA21EN` | BMW X7 (G07 LCI) | xDrive40d | diesel | belegt | [bimmer.work 21EN](https://bimmer.work/model/g07/21en/) |
| `^WBA22EN` | BMW X7 (G07 LCI) | xDrive40d (RHD) | diesel | belegt | [bimmer.work 22EN](https://bimmer.work/model/g07/22en/) |
| `^WBA21EM` | BMW X7 (G07 LCI) | xDrive40i | petrol | belegt | [bimmer.work 21EM](https://bimmer.work/model/g07/21em/) |
| `^WBA22EM` | BMW X7 (G07 LCI) | xDrive40i (RHD) | petrol | belegt | [bimmer.work 22EM](https://bimmer.work/model/g07/22em/) |
| `^WBA31EM` | BMW X7 (G07 LCI) | M60i xDrive | petrol | belegt | [bimmer.work 31EM](https://bimmer.work/model/g07/31em/) |
| `^WBA32EM` | BMW X7 (G07 LCI) | M60i xDrive (RHD) | petrol | belegt | [bimmer.work 32EM](https://bimmer.work/model/g07/32em/) |
| `^WBA4[12]EM` | BMW ALPINA XB7 (G07 LCI) | XB7 | petrol | belegt | [bimmer.work 41EM](https://bimmer.work/model/g07/41em/) |
| `^WBACW8[12]` | BMW X7 (G07) | xDrive30d | diesel | belegt | [bimmer.work CW81](https://bimmer.work/model/g07/cw81/) |
| `^WBATB4[12]` | BMW X7 (G07) | xDrive40d | diesel | belegt | [bimmer.work TB41](https://bimmer.work/model/g07/tb41/) |
| `^WBACW0[12]` | BMW X7 (G07) | M50d | diesel | belegt | [bimmer.work CW01](https://bimmer.work/model/g07/cw01/) |
| `^WBACW2[12]` | BMW X7 (G07) | xDrive40i | petrol | belegt | [bimmer.work CW21](https://bimmer.work/model/g07/cw21/) |
| `^WBACX41` | BMW X7 (G07) | xDrive50i | petrol | belegt | [bimmer.work CX41](https://bimmer.work/model/g07/cx41/) |
| `^WBACX61` | BMW X7 (G07) | M50i | petrol | belegt | [bimmer.work CX61](https://bimmer.work/model/g07/cx61/) |
| `^WBACX21` | BMW X7 (G07) | xDrive30i (Sondermarkt?) | petrol | unsicher | [bimmer.work CX21](https://bimmer.work/model/g07/cx21/) |
| `^5UX(23EM\|CW2C)` | BMW X7 (G07, US) | xDrive40i | petrol | belegt | [decodethis](https://decodethis.com/web/vin/5UX23EM00V9493638), [fleetchaser](https://fleetchaser.com/vin/2022/bmw/x7/5UXCW2C01N9M28518/) |

### Mercedes-Benz V-Klasse 447, altes Format (Stellen 1–9)

| Muster (Regex) | brand_model | trim | fuel | Sicherheit | Quelle |
|---|---|---|---|---|---|
| `^(WDF\|W1V)4478[01]1` | Mercedes-Benz V-Klasse (447) | kompakt | offen (Diesel/Benzin) | gestützt (`…81…` belegt, `…80…` aus Systematik) | [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/), [carsbat](https://carsbat.com/en/detail/wdf44781123514006-gmzlo5/) |
| `^(WDF\|W1V)4478[01]3` | Mercedes-Benz V-Klasse / EQV / Marco Polo (447) | lang | offen (Diesel, Benzin oder Elektro) | gestützt | [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/), [carsbat EQV](https://carsbat.com/de/detail/w1v44781313886087-omaxln/) |
| `^(WDF\|W1V)4478[01]5` | Mercedes-Benz V-Klasse / EQV (447) | extralang | offen (Diesel, Benzin oder Elektro) | gestützt | [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/) |
| `^(WDF\|W1V)4477` | Mercedes-Benz Vito Tourer/Mixto (447) | Länge aus Stelle 9 | offen | gestützt (Fremdmodell, zur Abgrenzung) | [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/), [carsbat Vito](https://carsbat.com/de/detail/w1v44770313900786-uderd7/) |
| `^(WDF\|W1V)4476` | Mercedes-Benz Vito Kastenwagen (447) | Länge aus Stelle 9 | offen | gestützt (Fremdmodell, zur Abgrenzung) | [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/) |

### Mercedes-Benz V-Klasse 447, neues Format W1VV (ab ca. MJ 2023)

| Muster (Regex) | brand_model | trim | fuel | Sicherheit | Quelle |
|---|---|---|---|---|---|
| `^W1VVNL` | Mercedes-Benz V-Klasse (447) | V 300 d extralang | diesel | unsicher | [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-300-d-avantgarde-extralang-429575/), [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-300-d-exclusive-extralang-214575/) |
| `^W1VVML` | Mercedes-Benz V-Klasse (447) | V 300 d lang | diesel | unsicher | [carsbat](https://carsbat.com/de/detail/w1vvmlfz3s4472005-wumgtb/) (nur „V“, Rest aus Systematik) |
| `^W1VVMK` | Mercedes-Benz V-Klasse (447) | V 250 d lang | diesel | unsicher | [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-250-d-style-lang-427601/), [carsbat](https://carsbat.com/en/detail/w1vvmkfz0s4500174-ott9bq/) |
| `^W1VVNK` | Mercedes-Benz V-Klasse (447) | V 250 d extralang | diesel | unsicher | [carsbat](https://carsbat.com/de/detail/w1vvmlfz3s4472005-wumgtb/) (nur „V“, Rest aus Systematik) |
| `^W1VV[MN]J` | Mercedes-Benz V-Klasse (447) | V 220 d (vermutet) | diesel | unsicher | [carsbat](https://carsbat.com/de/detail/w1vvmlfz3s4472005-wumgtb/) (Suchergebnisse) |
| `^W1VV[A-Z]{2}S` | Zusatzmerkmal | 4MATIC | – | unsicher | [Rosier](https://www.rosier.de/fahrzeug/mercedes-benz/v-250-d-style-lang-427601/) |
| `^W1VV` (Rest) | Mercedes-Benz Van (447, V-Klasse oder Vito) | offen | offen | gestützt (nur Familie) | [carsbat](https://carsbat.com/de/detail/w1vvlcez4r4383784-jpbqdv/) |

### Audi A6/A7 C8 (Stellen 1–8)

| Muster (Regex) | brand_model | trim | fuel | Sicherheit | Quelle |
|---|---|---|---|---|---|
| `^WUAZZZF2` | Audi RS 6 Avant / RS 7 Sportback (C8) | RS | petrol | gestützt | [Audi VIN Breakdown MY2024](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23), [classic.com](https://www.classic.com/veh/2022-audi-rs6-avant-vorsprung-wuazzzf29nn901973-4AwKzqW) |
| `^WAUZZZF2` | Audi A6/A7 (C8), Karosserie offen (Limousine, Avant, allroad, A7) | offen | offen (TDI, TFSI, TFSI e) | gestützt (Familie), Karosserie und Motor nicht ableitbar | [Audi VIN Breakdown MY2019](https://vpic.nhtsa.dot.gov/mid/home/displayfile/1edced14-b749-49d3-a5d7-5500367663ad), [carsbat](https://carsbat.com/en/detail/wauzzzf2xmn082433-7mcive/) |
| `^W(AU\|UA)[A-Z0-9]{3}F2` | Audi A6/A7 (C8, US-Ausführung) | aus US-Breakdown | aus US-Breakdown | belegt | [Audi VIN Breakdown MY2024](https://vpic.nhtsa.dot.gov/mid/home/displayfile/fe3d103e-734d-4e10-9153-ca9ec4e88a23) |

Zusatzauswertung für Audi: Stelle 10 als Modelljahr nach `{K:2019, L:2020, M:2021, N:2022, P:2023, R:2024, S:2025, T:2026}` (gestützt) und Stelle 11 = `N` (Neckarsulm) als Plausibilitätsprüfung (belegt über Beispiele). Für Mercedes `W1VV` dieselbe Modelljahr-Tabelle ab P (belegt durch Rechnung an elf VINs). Für Mercedes alt Stelle 10 als Lenkung `{1: links, 2: rechts}` (gestützt) und für BMW EU Stelle 10 gar nicht auswerten.

## Fazit

Die eigentliche Erkenntnis für die Flottensoftware ist, dass die VIN bei europäischen Fahrzeugen kein Datenblatt ist, sondern ein Schlüssel, dessen Informationsgehalt der Hersteller bestimmt. BMW packt die Variante hinein, Mercedes nur den Aufbau, Audi fast nichts. Eine VIN-Regeltabelle sollte deshalb nicht alle Felder füllen wollen, sondern ehrlich zwischen „aus VIN“, „aus Fahrzeugschein“ und „offen“ unterscheiden. Die Felder `fuel` und `seats` gehören bei Mercedes und Audi grundsätzlich in die Stammdaten aus der Zulassungsbescheinigung, nicht in die VIN-Erkennung.

Am meisten Wert schafft jetzt ein kleiner Rückkopplungskreis. Jedes neue Fahrzeug der eigenen Flotte liefert ein Paar aus VIN und Fahrzeugschein, und damit lassen sich die unsicheren `W1VV`-Regeln nach und nach auf „belegt“ heben, ohne eine einzige fremde Datenbank zu übernehmen. Bezahlte Abfragen wie Vincario lohnen sich erst, wenn Modelle hinzukommen, für die weder Papiere noch belastbare Muster vorliegen, und auch dann nur nach Prüfung der AGB zur Speicherung.
