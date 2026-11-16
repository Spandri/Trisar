# Messung nachher-Dienst 2026-11-15-17-10

Argumente: --modell=qwen2.5:14b --verstehen=qwen2.5:14b --ollama=http://100.121.170.114:11434 --nur=Dienst --etikett=nachher-Dienst

Schritte 13, richtig 12, Gesamtdauer 1.3 min

## Dauer je Schritt (ms)

| Auswahl | n | p50 | p90 | max | Mittel |
|---|---|---|---|---|---|
| alle Schritte | 13 | 4665 | 13161 | 13605 | 6091 |
| Schritte mit Modell | 13 | 4665 | 13161 | 13605 | 6091 |
| Schritte ohne Modell | 0 | 0 | 0 | 0 | 0 |
| davon Modellzeit (mit Modell) | 13 | 4629 | 12916 | 13558 | 6044 |
| davon Rest (mit Modell) | 13 | 30 | 47 | 245 | 47 |

Modellaufrufe je Schritt: 2 Aufrufe: 13x

## Aufrufe nach Art

| Art | n | p50 ms | p90 ms | max ms | Ladezeit Mittel ms | Neu geladen (>1 s) | Prompt-Tokens Mittel | Antwort-Tokens Mittel | Prompt-Zeichen Mittel | num_ctx |
|---|---|---|---|---|---|---|---|---|---|---|
| v_absicht | 13 | 1302 | 1401 | 1456 | 2 | 0 | 1065 | 12 | 3444 | 4096 |
| v_dienst | 13 | 3360 | 11460 | 12271 | 2 | 0 | 916 | 45 | 2167 | 4096 |

## Langsamste Schritte

- 13.6 s, Modell 13.6 s (v_absicht 1.3s, v_dienst 12.3s): OK   Dienst    Markierte Fahrer in Feierabend  13.6 s
- 13.2 s, Modell 12.9 s (v_absicht 1.5s, v_dienst 11.5s): OK   Dienst    Dienst Start und Ende morgen  13.0 s
- 5.5 s, Modell 5.5 s (v_absicht 1.4s, v_dienst 4.1s): OK   Dienst    Pause im vorhandenen Dienst  5.5 s
- 5.5 s, Modell 5.5 s (v_absicht 1.3s, v_dienst 4.2s): OK   Dienst    Zwei Fahrer gleicher Dienst  5.5 s
- 5.1 s, Modell 5.1 s (v_absicht 1.3s, v_dienst 3.8s): OK   Dienst    Pause mit Bindestrich  5.1 s
- 4.8 s, Modell 4.8 s (v_absicht 1.3s, v_dienst 3.4s): OK   Dienst    Fahrer per Nummer  4.8 s
- 4.7 s, Modell 4.6 s (v_absicht 1.3s, v_dienst 3.3s): OK   Dienst    Umgangssprache: fängt an  4.7 s
- 4.6 s, Modell 4.6 s (v_absicht 1.3s, v_dienst 3.4s): OK   Dienst    Vorhandener Dienst, Uhrzeit nachts  4.6 s
- 4.6 s, Modell 4.6 s (v_absicht 1.4s, v_dienst 3.2s): OK   Dienst    Feierabend mit Uhrzeit  4.6 s
- 4.5 s, Modell 4.5 s (v_absicht 1.3s, v_dienst 3.2s): OK   Dienst    Gleicher Start schon eingetragen  4.5 s
- 4.4 s, Modell 4.4 s (v_absicht 1.3s, v_dienst 3.1s): OK   Dienst    Umgangssprache: morgen früh  4.4 s
- 4.4 s, Modell 4.4 s (v_absicht 1.3s, v_dienst 3.1s): OK   Dienst    Umgangssprache: Schluss machen  4.4 s
- 4.2 s, Modell 4.2 s (v_absicht 1.1s, v_dienst 3.1s): FEHL Dienst    Dienst ab Uhrzeit heute  4.2 s