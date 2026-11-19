#!/usr/bin/env python3
"""Web-Dispo App.jsx: echte Abfahrt/Ankunft (18.11.2026) einbauen, nur diese Stellen.

Auf dem Server liegt eine aeltere App.jsx (ohne die Routenpunkte der Dispo). Darum wird nicht die ganze
Datei kopiert, sondern nur dieser Teil eingesetzt. Mehrfach aufrufbar.

Aufruf: echte-zeiten-einbauen.py <pfad/zu/admin/src/App.jsx>
"""
import re
import sys

pfad = sys.argv[1]
text = open(pfad, encoding='utf-8').read()
if 'abfahrt_echt' in text:
    print('echte Zeiten schon drin')
    sys.exit(0)


def ersetzen(alt, neu):
    global text
    if text.count(alt) != 1:
        sys.exit(f'Stelle {text.count(alt)}x statt 1x gefunden: {alt[:80]!r}')
    text = text.replace(alt, neu)


# 1) Statusliste
a = "const IN_PROGRESS_LIKE_JOB_STATUSES = new Set(['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active']);\n"
ersetzen(a, a + "const DONE_LIKE_JOB_STATUSES_FOR_TIMES = new Set(['done', 'completed', 'arrived', 'beendet']);\n")

# 2) Spalten: erste Variante kopieren und um die neuen Spalten ergaenzen
m = re.search(r"(        const jobSelectCandidates = \[\n(?:          //[^\n]*\n)*)(          `\$\{jobSelectBase\}[^`]*)`,\n", text)
if not m:
    sys.exit('jobSelectCandidates nicht gefunden')
neu = (m.group(1)
       + "          // Echte Abfahrt/Ankunft (18.11.), ohne die Spalten weiter mit den naechsten.\n"
       + m.group(2) + ", abfahrt_echt, ankunft_echt, ankunft_erwartet`,\n"
       + m.group(2) + "`,\n")
text = text[:m.start()] + neu + text[m.end():]

# 3) Zeiten
ersetzen(
    """          const isDelayed = delayMins > 0 || Boolean(effectiveEtd && originalEtd && effectiveEtd !== originalEtd);
""",
    """          // Echte Zeiten (18.11.): Ab "Unterwegs" steht die echte Abfahrt (GPS, sonst Tipp auf Unterwegs) statt
          // des Plans, die Ankunft ist live (TomTom) bzw. nach dem Ende die echte. Den Plan nur durchgestrichen
          // zeigen, wenn die echte Abfahrt mehr als 5 min ausserhalb des Startfensters liegt.
          const uhrBerlin = (iso) => {
            const ms = Date.parse(String(iso || ''));
            return Number.isFinite(ms)
              ? new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' })
              : '';
          };
          const abfahrtEcht = (isUnderway || DONE_LIKE_JOB_STATUSES_FOR_TIMES.has(normalizedJobStatusFromRow)) ? uhrBerlin(job.abfahrt_echt) : '';
          const ankunftEcht = abfahrtEcht ? (uhrBerlin(job.ankunft_echt) || uhrBerlin(job.ankunft_erwartet)) : '';
          const planBis = normalizeClockValue(job.etd_bis, '');
          const planText = plannedEtd ? `${plannedEtd}${planBis ? `–${planBis}` : ''}` : '';
          const abfahrtEchtMin = parseClockToMinutes(abfahrtEcht);
          const ausserhalbFenster = Boolean(abfahrtEcht) && Number.isFinite(abfahrtEchtMin) && Number.isFinite(plannedEtdMinutes) && (() => {
            const ende = (Number.isFinite(spaetAbMinutes) ? spaetAbMinutes : plannedEtdMinutes) % 1440;
            // Abstand im Tageskreis (ueber Mitternacht), unter 12 h zaehlt als vor bzw. nach dem Fenster.
            const zuFrueh = (plannedEtdMinutes - abfahrtEchtMin + 1440) % 1440;
            const zuSpaet = (abfahrtEchtMin - ende + 1440) % 1440;
            return (zuFrueh > 5 && zuFrueh < 720) || (zuSpaet > 5 && zuSpaet < 720);
          })();
          const isDelayed = abfahrtEcht
            ? ausserhalbFenster
            : (delayMins > 0 || Boolean(effectiveEtd && originalEtd && effectiveEtd !== originalEtd));
          const zeitAnzeige = abfahrtEcht
            ? (isDelayed
              ? { original: planText || '--:--', status: '', new: abfahrtEcht, bis: '',
                  arrivalOriginal, arrivalNew: ankunftEcht || arrivalNew, arrivalTime: ankunftEcht || arrivalNew }
              : { status: '', time: abfahrtEcht, bis: '',
                  arrivalTime: ankunftEcht || arrivalNew, arrivalOriginal, arrivalNew: ankunftEcht || arrivalNew })
            : null;
""")
ersetzen(
    """            startZeit: effectiveEtd || originalEtd || '--:--',
            startZeitBis: normalizeClockValue(job.etd_bis, ''),""",
    """            startZeit: abfahrtEcht || effectiveEtd || originalEtd || '--:--',
            startZeitBis: normalizeClockValue(job.etd_bis, ''),
            abfahrtEcht,
            ankunftEcht,""")
ersetzen(
    """            time: isDelayed
              ? {
                  original: originalEtd || effectiveEtd || '--:--',""",
    """            time: zeitAnzeige || (isDelayed
              ? {
                  original: originalEtd || effectiveEtd || '--:--',""")
ersetzen(
    """                  arrivalTime: arrivalNew,
                  arrivalOriginal,
                  arrivalNew,
                },
            delayMins,""",
    """                  arrivalTime: arrivalNew,
                  arrivalOriginal,
                  arrivalNew,
                }),
            delayMins: abfahrtEcht ? 0 : delayMins,""")

# 4) Fehlen die Spalten (Migration noch nicht da), mit der naechsten Variante weiter
ersetzen(
    """            || MISSING_ORT_COLUMN_RE.test(jobsResult.error.message || '');
          if (!isMissingKnownColumn) break;""",
    """            || MISSING_ORT_COLUMN_RE.test(jobsResult.error.message || '')
            || /abfahrt_echt|ankunft_echt|ankunft_erwartet/.test(jobsResult.error.message || '');
          if (!isMissingKnownColumn) break;""")

open(pfad, 'w', encoding='utf-8').write(text)
print('echte Zeiten eingebaut')
