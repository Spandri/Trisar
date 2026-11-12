// Reihenfolge der Zeiten (Wunsch 12.11.): Dienststart < Pausenanfang < Pausenende < Dienstende.
// Gerechnet in Minuten ab Dienststart, ueber Mitternacht. Gleiche Logik in iOS (Stunden.swift)
// und Android (kern/Stunden.kt). Liefert den ersten Fehler als Text oder ''.
const minuten = (hhmm) => {
  const [h, m] = String(hhmm || '').slice(0, 5).split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};

export const reihenfolgeFehler = (start, ende, pausen = []) => {
  const s = minuten(start);
  const liste = (pausen || []).map((p) => ({ von: minuten(p?.von), bis: minuten(p?.bis) })).filter((p) => p.von !== null && p.bis !== null);
  if (s === null) {
    return liste.some((p) => p.von === p.bis) ? 'Pausenende muss nach Pausenanfang liegen.' : '';
  }
  const ab = (m) => (((m - s) % 1440) + 1440) % 1440;
  const e = minuten(ende);
  const offEnde = e === null ? 1440 : ab(e);
  if (e !== null && offEnde === 0) return 'Dienstende muss nach Dienststart liegen.';
  const sortiert = liste.map((p) => ({ von: ab(p.von), bis: ab(p.bis) })).sort((a, b) => a.von - b.von);
  // Liegt eine Pause ausserhalb, entscheidet die Naehe: kurz vor dem Start (z. B. 07:00 bei Start 08:00)
  // heisst "vor Dienststart", sonst "nach Dienstende". Ohne Ende gelten Pausen ab 16 h als "vor".
  const grenze = e === null ? 960 : (offEnde + 1440) / 2;
  for (const p of sortiert) {
    if (p.von === 0 || p.von >= grenze) return 'Pausenanfang muss nach Dienststart liegen.';
    if (p.von >= offEnde) return 'Dienstende muss nach Pausenende liegen.';
    if (p.bis <= p.von) return 'Pausenende muss nach Pausenanfang liegen.';
    if (p.bis >= offEnde) return 'Dienstende muss nach Pausenende liegen.';
  }
  for (let i = 1; i < sortiert.length; i += 1) {
    if (sortiert[i].von < sortiert[i - 1].bis) return 'Pausen dürfen sich nicht überschneiden.';
  }
  return '';
};
