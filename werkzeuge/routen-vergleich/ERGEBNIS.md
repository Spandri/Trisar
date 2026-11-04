# Routenvergleich Engine-Annahmen gegen TomTom (typischer Verkehr)

30 Teststrecken x 3 Zeitpunkte = 90 Fälle. Abweichung in Minuten gegenüber TomTom.

| Variante | mittlere Abw. | Median | größte | > 5 min daneben | davon zu kurz geplant |
|---|---|---|---|---|---|
| 1 Engine heute (Zonen) | 15.6 | 15.7 | 34 | 80 von 90 | 50 |
| 2 OSRM x Stundenfaktor | 4.6 | 3.9 | 16 | 35 von 90 | 32 |
| 3 OSRM x Faktor je Raum/Zeit | 2.7 | 2.2 | 11 | 16 von 90 | 9 |

Je Raumtyp (mittlere Abweichung in min):

| Raum | Fälle | Zonen | OSRM x Std | OSRM x Raum |
|---|---|---|---|---|
| flughafen | 21 | 16.2 | 2.5 | 1.2 |
| innenstadt | 9 | 13.7 | 4.8 | 1.3 |
| stadt | 42 | 18.6 | 5.5 | 3.4 |
| umland | 18 | 8.7 | 5.0 | 3.8 |

Gelernte Faktoren (TomTom / OSRM, Median):

| Raum | Zeit | Faktor |
|---|---|---|
| flughafen | Fr 17:00 | 1.03 |
| flughafen | Mo 08:00 | 1.02 |
| flughafen | So 11:00 | 0.95 |
| innenstadt | Fr 17:00 | 1.59 |
| innenstadt | Mo 08:00 | 1.63 |
| innenstadt | So 11:00 | 1.44 |
| stadt | Fr 17:00 | 1.63 |
| stadt | Mo 08:00 | 1.65 |
| stadt | So 11:00 | 1.29 |
| umland | Fr 17:00 | 1.31 |
| umland | Mo 08:00 | 1.37 |
| umland | So 11:00 | 1.05 |
