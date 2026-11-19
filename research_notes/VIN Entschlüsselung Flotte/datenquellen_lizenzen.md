# VIN-Entschlüsselung EU-Flotte: Datenquellen, Lizenzen, Bezahl-APIs

Stand der Recherche: 18.11.2026. Kennzeichnung je Aussage: **belegt** (mit Quelle) oder **unsicher**.
Flotte: Mercedes V-Klasse (Baureihe 447), Audi A6, BMW X7.

## 1. Offene Datensätze (NHTSA vPIC, Wikidata, GitHub, KBA HSN/TSN)

### Takeaway
Es gibt keinen offenen Datensatz, der EU-Modelle von Mercedes/BMW/Audi verlässlich bis zur Variante auflöst. vPIC ist frei (US-Open-Data, ohne Registrierung), deckt aber nur Fahrzeuge ab, die für den US-Markt angemeldet sind. Für EU-Fahrzeuge kommt man damit meist nur bis zum Hersteller (WMI). Die KBA-Listen sind frei als PDF erhältlich, enthalten aber keine Zuordnung VIN → HSN/TSN.

### Cited Findings
- **belegt**: vPIC enthält Fahrzeuge, die für den Verkauf oder Import in die USA bestimmt sind. Andere Fahrzeuge liefern nur eingeschränkte Ergebnisse. Die Daten stammen aus Herstellermeldungen ab Modelljahr 1981. — [vPIC About](https://vpic.nhtsa.dot.gov/About)
- **belegt**: Ausländische Fahrzeuge sind nur enthalten, wenn der Hersteller sie über das 565-Verfahren für die USA gemeldet hat. Nutzung kostenlos, ohne Lizenz und ohne Registrierung („Open Data initiative“), kein Tageslimit, ca. 1.000–2.000 Transaktionen/min Serverkapazität. — [vPIC API FAQ](https://vpic.nhtsa.dot.gov/api/home/index/faq)
- **belegt**: vPIC wird auf data.gov als offener Datensatz (JSON/CSV/XML) geführt. — [catalog.data.gov vPIC](https://catalog.data.gov/dataset/nhtsa-product-information-catalog-and-vehicle-listing-vpic-vehicle-api-json)
- **unsicher** (Anbieterquelle): EU-VINs liefern oft Fehlercode 8 („encoded data unresolvable“), weil europäische VINs in Stelle 4–8 weniger codieren. — [carwhere.com Guide](https://www.carwhere.com/guides/nhtsa-vin-decoder-api)
- **unsicher** (Drittquelle): Die vPIC-Datenbank enthält ca. 12.971 WMI-Zeilen und ist als Datensatz-Spiegel auf Hugging Face verfügbar. — [huggingface joakes90/vpic-database](https://huggingface.co/datasets/joakes90/vpic-database)
- **belegt**: Die Wikibooks-Seite zu Mercedes-VIN-Codes steht unter CC BY-SA 4.0 (Weiterverwendung mit Namensnennung und gleicher Lizenz für abgeleitete Werke). Sie beschreibt für W1K/WDD: Stelle 4 Baureihe, 5 Karosserie, 6–7 Modell innerhalb der Baureihe, 8 Rückhaltesystem. Für Vans W1V/WDF: Stelle 4–6 Modellcode (447 = Vito/V-Klasse), 7–9 Gewicht/Länge. Ein konkretes V-Klasse-Beispiel fehlt. — [Wikibooks Mercedes VIN Codes](https://en.wikibooks.org/wiki/Vehicle_Identification_Numbers_(VIN_codes)/Mercedes-Benz/VIN_Codes)
- **unsicher** (Enthusiasten-Seite): Baumuster der V-Klasse 447.811 (kompakt), 447.813 (lang), 447.815 (extralang). Die vierte Ziffer trennt Kastenwagen (6), Kombi/Mixto (7) und V-Klasse/Marco Polo (8). — [mbpassion.de](https://mbpassion.de/2021/06/die-baumuster-der-vs20-baureihe-im-ueberblick/)
- **unsicher** (Listing, LICENSE-Datei nicht selbst geprüft): GitHub `dnnr1/chassi` ist ein Offline-VIN-Decoder unter MIT, die Modellmuster sind von der Community aus beobachteten VINs gesammelt (nicht offiziell). — [awesome.ecosyste.ms chassi](https://awesome.ecosyste.ms/projects/github.com%2Fdnnr1%2Fchassi)
- **unsicher** (Listing): GitHub `Wal33D/nhtsa-vin-decoder` unter MIT, 2.015+ WMI-Codes, herstellerspezifische Decoder. Ob Mercedes/BMW/Audi-Modelltabellen enthalten sind, ist unklar. — [awesome.ecosyste.ms nhtsa-vin-decoder](https://awesome.ecosyste.ms/projects/github.com%2Fwal33d%2Fnhtsa-vin-decoder)
- **unsicher**: GitHub `mmalyszko/php-local-vin-decoder` hat eine VDS-Datenbank mit den häufigsten Modellen, Lizenz nicht ermittelt. — [awesome.ecosyste.ms php-local-vin-decoder](https://awesome.ecosyste.ms/projects/github.com%2Fmmalyszko%2Fphp-local-vin-decoder)
- **belegt**: Das KBA veröffentlicht die Herstellerliste (HSN, SV 3.1/3.2, Stand 15.01.2026) und das Verzeichnis der Hersteller und Typen (TSN, SV 4.1–4.5 für L/M/N/O/T, Stand 15.08.2026) als PDF zum Download. Andere Datenformate gibt es nur auf Anfrage als kostenpflichtige Auftragsarbeit. Eine VIN-Zuordnung wird auf der Seite nicht erwähnt. — [KBA CoC-Daten und Fahrzeugtypdaten](https://www.kba.de/EN/Themen_en/Typgenehmigung_en/CoC_Daten_Fahrzeugtypdaten_en/CoC_Daten_Fahrzeugtypdaten_node_en.html)
- **belegt**: Laut KBA-Urheberrechtshinweis dürfen KBA-Veröffentlichungen vervielfältigt und weitergegeben werden, auch digital, wenn das KBA als Quelle genannt wird. — [KBA Urheberrechtliche Hinweise](https://www.kba.de/EN/Service/Hinweise_en/urheberrechtliche_inhalt_en.html)

### Inferences
- vPIC ist rechtlich unproblematisch (US-Bundesdaten, frei), bringt für die Flotte aber praktisch nur WMI → Hersteller (W1K/W1V = Mercedes, WBA/WBY = BMW, WAU = Audi). BMW X7 ist ein US-Modell (Werk Spartanburg), deshalb liefert vPIC dafür womöglich mehr. Am echten VIN testen. (**unsicher**)
- HSN/TSN lässt sich aus der VIN nicht ableiten. Die VIN codiert keine KBA-Typschlüssel, und das KBA bietet keine Zuordnung an. Der praktische Weg ist, HSN/TSN einmalig aus Fahrzeugschein (Zulassungsbescheinigung Teil I, Feld 2.1/2.2) je Fahrzeug zu erfassen und die KBA-PDF-Liste (mit Quellenangabe) zur Klartextanzeige zu nutzen. (**Inferenz**)
- Die Wikibooks-Tabellen sind die einzige gefundene Quelle mit klarer, freier Lizenz für VDS-Bedeutungen. CC BY-SA verlangt, dass eine daraus abgeleitete Tabelle ebenfalls unter CC BY-SA steht. Für eine interne Regel-Tabelle ist das handhabbar, sollte aber dokumentiert werden.
- Bei einer Flotte aus drei Modellen ist eine selbst gepflegte Tabelle aus den eigenen VINs (plus Fahrzeugschein und Datenkarte) wahrscheinlich verlässlicher als jede offene Quelle. Eigene Beobachtungen der eigenen Fahrzeuge sind urheberrechtlich unproblematisch.

### Gaps
- Wikidata: Lizenz ist nach allgemeinem Kenntnisstand CC0, in dieser Sitzung aber nicht geprüft. Ob Wikidata WMI-Codes oder VDS-Muster als Eigenschaft führt, wurde nicht ermittelt. (**unsicher**)
- Die LICENSE-Dateien der GitHub-Projekte wurden nicht direkt geöffnet. Ob Mercedes 447, Audi A6 (C8) und BMW X7 (G07) darin abgedeckt sind, ist offen.
- Es gibt keine offizielle Liste, welche europäischen WMIs in vPIC registriert sind.

## 2. Herstellerdaten (Mercedes Baumuster, BMW Typschlüssel, VW/Audi Modellcodes, EU-RMI nach VO 2018/858)

### Takeaway
Hersteller veröffentlichen keine offenen VIN→Modell-Tabellen. Nach VO (EU) 2018/858, Anhang X, müssen Hersteller unabhängigen Marktteilnehmern Zugang zu Reparatur- und Wartungsinformationen (RMI) geben, auch über die VIN, aber gegen eine „angemessene Gebühr“. Dieser Zugang ist an den Reparaturzweck gebunden. Eine Weiterverwendung als Datenbasis für eigene Software ist dadurch nicht abgedeckt.

### Cited Findings
- **belegt**: Anhang X der VO 2018/858 regelt den Zugang zu OBD-Informationen und zu Reparatur- und Wartungsinformationen. — [legislation.gov.uk 2018/858 Annex X](https://legislation.gov.uk/eur/2018/858/annex/X/2018-05-30)
- **belegt**: Anhang X, Anlage 2: Der Zugang „may be subject to the payment of a reasonable fee“. — [legislation.gov.uk Annex X Appendix 2](https://legislation.gov.uk/eur/2018/858/annex/X/appendix/2)
- **belegt** (Fundstelle, Text nicht vollständig gelesen): Die Delegierte Verordnung (EU) 2026/699 ändert Anhang X (Nummern 1, 2, 6, 7) zu sicherem OBD-Zugang und RMI-Zugang. — [EUR-Lex 2026/699](https://eur-lex.europa.eu/eli/reg_del/2026/699/oj/eng/pdf)
- **unsicher** (Branchenbericht, nicht amtlich): Ab 23.06.2027 sollen unabhängige Werkstätten VIN-spezifische Reparaturinformationen über einen Dritten mit Herstellervertrag anfragen. — [Biner Data Intelligence Report KW44/2026](https://a.storyblok.com/f/296019752350852/x/159dcedbe8/biner-data-intelligence-report-week-44-2026.pdf)
- **belegt**: DAT bezieht Modellcode, Optionscodes, Werk und Bauzeitraum je VIN per Online-Abfrage bei den „teilnehmenden Herstellern und Importeuren“, die Daten bleiben Eigentum von DAT bzw. Hersteller. Das zeigt, dass die Herstellerdaten nur lizenziert und einzeln abrufbar sind, nicht als offene Liste. — [DAT Produktbeschreibung SilverDAT VIN-Abfrage, Stand 01.01.2026](https://www.dat.de/fileadmin/de/download/rechtliches/produktbeschreibung-silverdat-vin-abfrage.pdf)

### Inferences
- Die RMI-Portale (z. B. Mercedes B2B Connect, BMW aos, erWin bei VW/Audi) sind für Werkstätten gedacht, nutzungsgebunden und kostenpflichtig. Daraus eine eigene Tabelle zu erzeugen, widerspräche sehr wahrscheinlich den Nutzungsbedingungen. (**unsicher**, Portalbedingungen nicht gelesen)
- Für Einzelfahrzeuge erlaubt und kostenlos: Die Datenkarte bzw. den Fahrzeugschein der eigenen Fahrzeuge auswerten und daraus die eigene Regel-Tabelle füllen. (**Inferenz**)

### Gaps
- Die Preise und Bedingungen der Hersteller-RMI-Portale (Stundenpässe usw.) für Mercedes, BMW und Audi wurden nicht recherchiert.
- Der Wortlaut der Änderung 2026/699 wurde nicht vollständig gelesen.

## 3. Community-Seiten (realoem, mdecoder, bimmer.work, lastvin, vindecoderz)

### Takeaway
Für keine dieser Seiten wurden Nutzungsbedingungen gefunden, die Scraping oder Datenübernahme erlauben. Ohne ausdrückliche Erlaubnis ist eine systematische Übernahme in Deutschland rechtlich riskant (Datenbankherstellerrecht §§ 87a ff. UrhG, dazu AGB). Abrufe einzelner VINs der eigenen Fahrzeuge von Hand sind unkritisch.

### Cited Findings
- **belegt**: mdecoder.com zeigt auf der Startseite keine Nutzungsbedingungen, keine API und keine Preise, nur den Hinweis „not affiliated with BMW AG“ und einen „Support us“-Link. — [mdecoder.com](https://www.mdecoder.com/)
- **belegt**: realoem.com antwortete beim automatisierten Abruf der Terms-Seite mit HTTP 403, der Zugriff für automatisierte Clients ist also technisch gesperrt. — [realoem.com terms (403)](https://www.realoem.com/bmw/enUS/terms)
- **belegt** (Vergleichsbeispiel, andere Seite): ClassicDecoder verbietet in seinen AGB ausdrücklich Scraping, Crawling und „database scraping“-Werkzeuge. Das zeigt, dass VIN-Decoder-Seiten üblicherweise so formulieren. — [ClassicDecoder Terms](https://classicdecoder.com/terms-and-conditions)

### Inferences
- Der Schutz nach §§ 87a ff. UrhG (Datenbankherstellerrecht) greift bei wesentlichen Investitionen, die Übernahme wesentlicher Teile ist dann unzulässig. Das betrifft auch Seiten ohne AGB. (**unsicher**, Rechtslage nicht in dieser Sitzung belegt, ggf. juristisch prüfen)
- Empfehlung: Community-Seiten nur als manuelle Referenz zum Gegenprüfen eigener Einträge nutzen, nicht automatisiert abfragen.

### Gaps
- Die Nutzungsbedingungen von bimmer.work, lastvin.com und vindecoderz.com wurden nicht gefunden.
- Für realoem.com war der Inhalt der Terms nicht abrufbar (403).

## 4. Bezahl-APIs als Rückfall (vindecoder.eu/Vincario, carVertical, DAT, autoDNA, CarMD)

### Takeaway
Die günstigste gefundene EU-Option mit veröffentlichter Preisliste ist Vincario (früher vindecoder.eu): ab 0,49 €/VIN bei 100 Abrufen, 20 kostenlose Test-Abrufe. carVertical nennt keine API-Preise (nur auf Anfrage). DAT bietet herstellerbasierte VIN-Daten mit Ausstattung, aber nur für SilverDAT-Kunden und mit enger Zweckbindung (Reparaturkalkulation/Bewertung), also für Flottenverwaltung eher nicht zulässig.

### Cited Findings
- **belegt** (Anbieter-Blog): Vincario VIN-Decoder-API: 100 Abrufe 0,49 €/VIN, 500 → 0,298 €, 1.000 → 0,249 €, 5.000 → 0,22 €, ab 10.000 individuell. 20 kostenlose Test-Abrufe, 3 kostenlose Web-Berichte/Monat. — [Vincario Blog „VIN Decoder API Pricing in 2026“](https://vincario.com/blog/?p=698)
- **belegt**: vindecoder.eu ist 2026 zu Vincario geworden (Rebranding, B2B-Fokus). Rate-Limit 60 Abrufe/min, ungültige VINs werden nicht berechnet. — [apis.io Vincario Pricing](https://apis.io/plans/vincario/vincario-plans-pricing/)
- **unsicher** (Drittlisting, abweichend): TrustRadius nennt 0,25 $ pro Abruf. — [TrustRadius Vincario](https://www.trustradius.com/compare-products/vincario)
- **unsicher**: Die Abdeckung von Mercedes/BMW/Audi bis Motor/Variante ist bei Vincario nicht ausdrücklich zugesichert. Der Blog zeigt nur ein Mercedes-Beispiel (AMG E 63 S). — [Vincario Blog](https://vincario.com/blog/?p=698)
- **belegt**: Die carVertical-Business-API bietet Echtzeit-VIN-Decoding, Preise nur über ein Anfrageformular. — [carVertical Business API](https://www.carvertical.com/business/api)
- **belegt**: DAT SilverDAT VIN-Abfrage liefert Modellcode, Optionscodes (Serien- und Sonderausstattung), Werk und Bauzeitraum aus Herstellerdaten. Nutzung „ausschließlich zur Bestimmung des Bauzustands … zum Zwecke einer Reparaturkostenkalkulation und/oder Fahrzeugbewertung“, nur auf Einzelfahrzeugebene, Voraussetzung ist ein SilverDAT-Vertrag. DAT sichert keine Erfolgsquote zu. Abrechnung je Abfrage monatlich. — [DAT Produktbeschreibung, Stand 01.01.2026](https://www.dat.de/fileadmin/de/download/rechtliches/produktbeschreibung-silverdat-vin-abfrage.pdf)
- **unsicher** (Alter unklar, widersprüchlich): DAT VIN-Abfrage 1,00 €/Abruf zzgl. MwSt. (Bestellformular 2015) bzw. „ab 1,85 €“ zzgl. MwSt. (Flyer, undatiert). — [DAT Bestellformular 2015](https://www.dat.de/fileadmin/media/download/download-AD/Bestellformulare/2015-11-17_SilverDAT_calculateGlass_edit.pdf); [DAT Flyer VIN-Abfrage](https://www.dat.de/fileadmin/de/download/flyer-dat-vin-abfrage.pdf)
- **belegt**: Liste der von DAT unterstützten Marken. — [DAT vininfo.pdf](https://www.dat.de/sphinx/vininfo/de/vininfo.pdf)

### Inferences
- Bei drei Fahrzeugmodellen und einer kleinen Flotte reicht ein einmaliger Bezahlabruf je neuer VIN, z. B. 100 Vincario-Abrufe ≈ 49 € über Jahre. Das Ergebnis wird als Eintrag in die eigene Tabelle übernommen. Ob Vincario das dauerhafte Speichern erlaubt, muss in den AGB geprüft werden. (**unsicher**)
- DAT ist wegen der Zweckbindung (Kalkulation/Bewertung) und des SilverDAT-Vertrags für die Flottenverwaltung wenig geeignet. (**Inferenz** aus belegter Klausel)

### Gaps
- Für autoDNA, CarMD (US-fokussiert) und vindecoderz wurden keine API-Preise gefunden.
- Die AGB von Vincario zum Speichern und Weiterverwenden der Abrufergebnisse wurden nicht gelesen.
- Die Aussagen zur Abdeckung von 447/A6 C8/X7 G07 bis zur Motorvariante sind bei keinem Anbieter belegt. Das lässt sich nur mit den 20 kostenlosen Test-Abrufen prüfen.

## 5. Teltonika-OBD-Tracker / OBD-II Mode 09: mehr als die VIN?

### Takeaway
Nach Norm (SAE J1979, Service 09) liefert ein Steuergerät neben der VIN auch Calibration IDs (PID 04), Calibration Verification Numbers (PID 06) und den ECU-Namen (PID 0A). Calibration IDs können die Motor-/Softwarevariante eingrenzen, sind aber herstellerspezifisch und nirgends offen dokumentiert. Teltonika FMB-Geräte übertragen nach den gefundenen Quellen nur die VIN (AVL-ID 256), nicht die Calibration IDs.

### Cited Findings
- **belegt**: Service 09: PID 02 VIN, PID 04 Calibration ID (bis 16 ASCII-Zeichen je ID, mehrere möglich), PID 06 CVN (4 Byte je ID), PID 0A ECU-Name (20 Byte ASCII), PID 08/0B In-use performance tracking. — [Wikipedia OBD-II PIDs](https://en.wikipedia.org/wiki/OBD-II_PIDs)
- **belegt**: Teltonika: VIN als AVL-ID 256, erfordert Codec 8 Extended. VIN-Quelle Auto oder Manuell einstellbar, bei manchen Fahrzeugen (v. a. E-Autos) wird die VIN nicht automatisch gelesen. — [Teltonika Wiki OEM Parameters](https://wiki.teltonika-gps.com/view/OEM_Parameters); [Teltonika Wiki FMB001 OBD II settings](https://wiki.teltonika-gps.com/view/FMB001_OBD_II_settings)
- **unsicher** (Drittspiegel): Prüfen per SMS/GPRS-Befehl `obdinfo`, ob die VIN gelesen wurde, sowie die Parameter 40000/40003/40005. — [mirifica Wiki FMB003 and OEM Parameters](https://mirifica.atlassian.net/wiki/spaces/WIKI/pages/2067922945/FMB003+and+OEM+Parameters)
- **belegt**: Die Teltonika-OBD-Parameterliste der FMB-Familie (Template). — [Teltonika FMB OBD Parameter list](https://wiki.teltonika.lt/view/Template:FMB_Device_Family_OBD_Parameter_list)

### Inferences
- In der Teltonika-Parameterliste wurde keine Calibration-ID als AVL-Parameter gefunden. Für Calibration IDs bräuchte man einen eigenen OBD-Leser (z. B. ELM327, Mode 09 PID 04) bei der Erstinbetriebnahme. (**unsicher**)
- Praktisch nützlicher als Calibration IDs sind die OBD-Live-Werte, die ein FMB ohnehin sendet, z. B. Kraftstofftyp oder Hubraum-Hinweise aus Luftmasse und Drehzahl. Sie helfen nur grob (Diesel/Benzin). Die eigentliche Modellzuordnung bleibt Sache der VIN-Tabelle. (**Inferenz**)

### Gaps
- Ob ein FMB010 per Befehl Service-09-Daten außer der VIN abfragen kann, ist nicht belegt.
- Ob Mercedes/BMW/Audi über die generische OBD-Schnittstelle überhaupt Calibration IDs ausgeben (bei Diesel-Euro-6 meist ja, aber nicht geprüft), ist offen.
