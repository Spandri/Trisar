# Eigene Orte mit Radien (Stand 07.11.2026)

Gilt fuer Web (admin = Dispo, fahrer = Fahrer-App), iOS (ios-dispo, ios-fahrer) und Android (android/dispo, android/fahrer).
Alles im bestehenden TRISAR-Design, vorhandene Bausteine wiederverwenden, nichts Neues erfinden.

## Datenbank (Migration `fahrer/supabase/migrations/20261107090000_orte_radien.sql`)

- `public.orte`: `id uuid`, `name text`, `adresse text`, `lat`, `lng`, `radius_rein_m int`, `radius_raus_m int`,
  `icon text` in (`pin`, `haus`, `flughafen_abflug`, `flughafen_landung`, `fahrzeug`, `stern`), `erstellt`, `geaendert`.
  DB-Regel: `radius_raus_m > radius_rein_m` (10..5000 / 11..10000). Name eindeutig (ohne Gross/klein).
  Lesen: alle angemeldeten. Schreiben: nur Dispo (`ist_dispo()`). Realtime an.
- `public.orte_standard`: genau eine Zeile (`id = true`), `radius_rein_m`, `radius_raus_m`. Dispo darf `update`.
- `public.jobs`: neu `pickup_ort_id uuid`, `dropoff_ort_id uuid` (FK auf orte, on delete set null).
- Statusregel in der DB (nichts in den Apps rechnen):
  offen -> beim Gast im Reinfahr-Radius des Abholorts, beim Gast -> unterwegs ausserhalb Rausfahr-Radius,
  unterwegs -> beendet im Reinfahr-Radius des Ziels. Radien aus dem Ort, sonst `orte_standard`.

## Icons (Schluessel -> Datei, Web unter `/icon/...`, native Apps haben dieselben Grafiken)

| icon | grau (Listen, Fahrt) | lime (aktiv/ausgewaehlt) |
|---|---|---|
| pin | `_Icon_Grau/Pin_Nav_Trisar_Icons_01_grau.svg` | `_Icon_Lime/Pin_Nav_Trisar_Icons_01_Lime.svg` |
| haus | `_Icon_Grau/House_Nav_Trisar_01_grau.svg` | `_Icon_Lime/House_Nav_Trisar_01_Lime.svg` |
| flughafen_abflug | `_Icon_Grau/Plain_Abflug_Trisar_Icons_01_grau.svg` | `_Icon_Lime/Plain_Abflug_Trisar_Icons_01_Lime.svg` |
| flughafen_landung | `_Icon_Grau/Plain_Landen_Trisar_Icons_01_grau.svg` | `_Icon_Lime/Plain_Landen_Trisar_Icons_01_Lime.svg` |
| fahrzeug | `_Icon_Grau/Vehicle_Nav_Trisar_01_grau.svg` | `_Icon_Lime/Vehicle_Nav_Trisar_01_Lime.svg` |
| stern | `_Icon_Grau/Stern_Trisar_Icon_01_grau.svg` | `_Icon_Lime/Stern_Trisar_Icon_01_Lime.svg` |

Heute waehlen die Apps das Start/Ziel-Icon per Textmuster (Flughafen/Hotel/Adresse, z. B. `ortsArt`/`ortsIcon`
in `admin/src/components/views/KartenView.jsx`, `fahrer/src/shared/ui/icons.js` + Views). Neu: Hat die Fahrt
`pickup_ort_id`/`dropoff_ort_id`, gewinnt das Icon des Orts. Sonst bleibt das Textmuster.

## Dispo (Web, iOS, Android)

1. **Karten Filter** (dort, wo schon "Punkte bei Fahrt"/Stufe der Tracker eingestellt wird) bekommt einen Bereich **Orte**:
   - **Standard** (fuer alle anderen Adressen): Reinfahr-Radius und Rausfahr-Radius in Metern, speichert `orte_standard`.
   - **Liste der eigenen Orte**: Icon, Name, "rein 50 m / raus 120 m". Antippen = bearbeiten. "Ort hinzufuegen".
   - **Bearbeiten**: Name, Adresse suchen (dieselbe Adresssuche wie beim Fahrt erstellen), danach Pin auf der
     Karte verschiebbar (Feinjustieren auf die Einfahrt, lat/lng vom Pin, Adresse bleibt die gesuchte),
     Reinfahr-Radius, Rausfahr-Radius, Icon-Auswahl (die 6 Icons oben). Loeschen mit Rueckfrage.
     Pruefung vor dem Speichern: Rausfahr > Reinfahr, sonst Hinweis und nicht speichern. Name doppelt -> Hinweis.
2. **Karte**: Alle Orte als Icon-Marker. Klick auf einen Ort zeigt zwei Kreise um den Pin: innen Reinfahr-Radius
   (gefuellt, transparent), aussen Rausfahr-Radius (nur Rand, gestrichelt wenn moeglich), dazu Name und Radien.
   Erneuter Klick oder Klick auf die Karte blendet sie aus. Beim Bearbeiten eines Orts die Kreise live mitzeigen.
3. **Fahrt erstellen / bearbeiten**, Felder Start und Ziel: Eigene Orte erscheinen in den Vorschlaegen **ganz oben**,
   sobald der Name mit dem Getippten beginnt (danach auch Wort-Anfang im Namen), ohne Gross/klein, schon ab 1 Buchstabe,
   mit ihrem Icon. Auswahl setzt `pickup_name`/`dropoff_name` = Ortsname, `pickup_address`/`dropoff_address` = Ortsadresse,
   Koordinaten wie bei einer normalen Adressauswahl (Pin des Orts), und `pickup_ort_id`/`dropoff_ort_id`.
   Wird danach frei weitergetippt, die `*_ort_id` wieder leeren.

## Fahrer-App (Web, iOS, Android)

- Bei Start/Ziel steht der **Name** (wie heute schon `pickup_name`) mit dem **Icon des Orts**, wenn `*_ort_id` gesetzt.
  Orte einmal laden (Tabelle `orte`, nur lesen) und per id nachschlagen.
- Navigation/Google Maps bekommt immer die **Adresse** (`pickup_address`/`dropoff_address`, bzw. Koordinaten),
  nie nur den Namen, sonst findet Maps "Mercedes Event Location" nicht.
- Keine Statuslogik in der App, die macht die DB.

## Texte

Deutsch, kurz, wie die bestehenden Texte (i18n-Dateien im Web mit pflegen, mindestens `de` und `en`).
