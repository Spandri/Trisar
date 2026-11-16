# Messung probe 2026-11-15-11-00

Argumente: --modell=qwen2.5:14b --verstehen=qwen2.5:14b --ollama=http://100.121.170.114:11434 --nur=Neu --etikett=probe

Schritte 6, richtig 6, Gesamtdauer 0.3 min

## Dauer je Schritt (ms)

| Auswahl | n | p50 | p90 | max | Mittel |
|---|---|---|---|---|---|
| alle Schritte | 6 | 2340 | 9480 | 9480 | 3231 |
| Schritte mit Modell | 6 | 2340 | 9480 | 9480 | 3231 |
| Schritte ohne Modell | 0 | 0 | 0 | 0 | 0 |
| davon Modellzeit (mit Modell) | 6 | 2139 | 9445 | 9445 | 3167 |
| davon Rest (mit Modell) | 6 | 36 | 201 | 201 | 64 |

Modellaufrufe je Schritt: 1 Aufrufe: 6x

## Aufrufe nach Art

| Art | n | p50 ms | p90 ms | max ms | Ladezeit Mittel ms | Neu geladen (>1 s) | Prompt-Tokens Mittel | Antwort-Tokens Mittel | Prompt-Zeichen Mittel | num_ctx |
|---|---|---|---|---|---|---|---|---|---|---|
| v_absicht | 6 | 2139 | 9445 | 9445 | 1 | 0 | 1068 | 11 | 3455 | 4096 |

## Langsamste Schritte

- 9.5 s, Modell 9.4 s (v_absicht 9.4s): OK   Neu       Konflikt prüfen  9.5 s
- 3.3 s, Modell 3.3 s (v_absicht 3.3s): OK   Neu       Tagesfrage: wer hat Luft  3.3 s
- 2.3 s, Modell 2.1 s (v_absicht 2.1s): OK   Neu       Wer ist frei um  2.3 s
- 1.7 s, Modell 1.7 s (v_absicht 1.7s): OK   Neu       Konflikt: kann X übernehmen  1.7 s
- 1.3 s, Modell 1.2 s (v_absicht 1.2s): OK   Neu       Konflikt: geht nicht  1.3 s
- 1.3 s, Modell 1.2 s (v_absicht 1.2s): OK   Neu       Fahrervorschlag  1.3 s