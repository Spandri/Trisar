# Dispatch-Regeln Trisar

## Ziel
Schnelle, nachvollziehbare Disposition mit klaren Prioritaeten.

## Prioritaet bei Fahrten
1. Bereits laufende Fahrten (`in_progress`, `unterwegs`).
2. Fahrten am Pickup (`at_pickup`, `pickup`).
3. Zugewiesene/offene Fahrten nach `ride_date` und `etd`.

## Fahrerstatus (Bedeutung)
- `aktiv`: Fahrer hat aktive Fahrt oder ist unterwegs.
- `inaktiv`: Fahrer hat naechste Fahrt bald, aber aktuell keine aktive Fahrt.
- `frei`: Kein aktiver Auftrag und kein unmittelbarer Folgetermin.

## Dienstfenster
- Dienststart und Dienstende werden im Fahrerprofil gepflegt.
- Bei Massenplanung darf auf mehrere Fahrer gleichzeitig angewendet werden.
- Bei Konflikten sollen Warnungen angezeigt werden.

## Kommunikationsregel
- Antworten in der KI kurz, klar und auf Deutsch.
- Wenn Information fehlt: deutlich sagen, dass sie fehlt.
- Keine erfundenen Daten oder IDs.
