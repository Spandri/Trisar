# Messung nachher-Ausnahme 2026-11-15-17-12

Argumente: --modell=qwen2.5:14b --verstehen=qwen2.5:14b --ollama=http://100.121.170.114:11434 --nur=Ausnahme --etikett=nachher-Ausnahme

Schritte 6, richtig 4, Gesamtdauer 0.5 min

## Dauer je Schritt (ms)

| Auswahl | n | p50 | p90 | max | Mittel |
|---|---|---|---|---|---|
| alle Schritte | 6 | 5930 | 7768 | 7768 | 5439 |
| Schritte mit Modell | 6 | 5930 | 7768 | 7768 | 5439 |
| Schritte ohne Modell | 0 | 0 | 0 | 0 | 0 |
| davon Modellzeit (mit Modell) | 6 | 5902 | 7360 | 7360 | 5347 |
| davon Rest (mit Modell) | 6 | 34 | 408 | 408 | 92 |

Modellaufrufe je Schritt: 2 Aufrufe: 2x, 3 Aufrufe: 4x

## Aufrufe nach Art

| Art | n | p50 ms | p90 ms | max ms | Ladezeit Mittel ms | Neu geladen (>1 s) | Prompt-Tokens Mittel | Antwort-Tokens Mittel | Prompt-Zeichen Mittel | num_ctx |
|---|---|---|---|---|---|---|---|---|---|---|
| v_absicht | 6 | 1502 | 1730 | 1730 | 4 | 0 | 1070 | 12 | 3468 | 4096 |
| v_ausser | 5 | 1153 | 1336 | 1336 | 3 | 0 | 233 | 9 | 821 | 4096 |
| v_dienst | 3 | 4886 | 4972 | 4972 | 1 | 0 | 922 | 38 | 2194 | 4096 |
| v_dienst_loeschen | 1 | 4298 | 4298 | 4298 | 1 | 0 | 642 | 45 | 1466 | 4096 |
| v_nachricht | 1 | 2366 | 2366 | 2366 | 1 | 0 | 282 | 24 | 1031 | 4096 |

## Langsamste Schritte

- 7.8 s, Modell 7.4 s (v_absicht 1.2s, v_ausser 1.2s, v_dienst 5.0s): FEHL Ausnahme  Dienst an alle bis auf einen  7.7 s
- 7.1 s, Modell 7.1 s (v_absicht 1.2s, v_ausser 1.0s, v_dienst 4.9s): OK   Ausnahme  Dienst an alle, einer ausgenommen, anders gesagt  7.1 s
- 5.9 s, Modell 5.9 s (v_absicht 1.6s, v_dienst_loeschen 4.3s): OK   Ausnahme  Kein falsches Ausnehmen beim Loeschen  5.9 s
- 4.9 s, Modell 4.9 s (v_absicht 1.5s, v_ausser 1.0s, v_nachricht 2.4s): OK   Ausnahme  Nachricht an alle ausser einem  4.9 s
- 4.5 s, Modell 4.5 s (v_absicht 1.7s, v_ausser 1.3s, v_dienst 1.4s): FEHL Ausnahme  Feierabend fuer alle ausser zwei  4.5 s
- 2.4 s, Modell 2.3 s (v_absicht 1.2s, v_ausser 1.2s): OK   Ausnahme  Stundenlohn fuer alle ausser einem  2.4 s