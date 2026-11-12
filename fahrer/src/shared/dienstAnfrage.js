// Dienstanfrage: welche Zeilen der Fahrer sieht (gleich in iOS DienstAnfrage.swift und Android DienstAnfrage.kt).
//
// Ganz neuer Dienst (kein vorher): Dienststart, jede Pause mit Pausenstart und Pausenende, Dienstende.
// Geaenderter Dienst (vorher = zuletzt angenommener Stand aus dienst_aenderung): nur was sich geaendert
// hat. Also z. B. nur "Dienstende 23:00" oder nur "Pausenende 19:00". Pausen werden der Reihe nach
// verglichen. Eine weggefallene Pause erscheint als "Pause 18:00–19:00 entfällt". Hat sich nichts
// erkennbar geaendert, gilt wieder der ganze Dienst.

const hm = (wert) => String(wert || '').slice(0, 5);
const minuten = (wert) => {
  const m = hm(wert).match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const pausenListe = (pausen) => (Array.isArray(pausen) ? pausen : [])
  .map((p) => ({ von: hm(p?.von), bis: hm(p?.bis) }))
  .filter((p) => p.von && p.bis);

// Reihenfolge im Dienst: Minuten ab Dienstbeginn (Nachtdienst und Pausen nach Mitternacht hinten).
const sortierWert = (zeit, beginn) => {
  const m = minuten(zeit);
  if (m === null) return Number.POSITIVE_INFINITY;
  return beginn !== null && m < beginn ? m + 1440 : m;
};

// Zeilen einer Anfrage: [{ art: 'start'|'ende'|'pause_start'|'pause_ende'|'pause_weg', zeit, bis? }]
export const anfrageZeilen = ({ startTime, endTime, pausen, vorher }) => {
  const start = hm(startTime);
  const ende = hm(endTime);
  const jetzt = pausenListe(pausen);
  const ganz = () => [
    ...(start ? [{ art: 'start', zeit: start }] : []),
    ...jetzt.flatMap((p) => [{ art: 'pause_start', zeit: p.von }, { art: 'pause_ende', zeit: p.bis }]),
    ...(ende ? [{ art: 'ende', zeit: ende }] : []),
  ];
  let zeilen;
  if (!vorher) {
    zeilen = ganz();
  } else {
    const alt = pausenListe(vorher.pausen);
    zeilen = [];
    if (start && start !== hm(vorher.start)) zeilen.push({ art: 'start', zeit: start });
    // Pausen der Reihe nach vergleichen: gleiche Stelle = geaendert (nur was anders ist),
    // zusaetzliche = neu (Start und Ende), fehlende = entfaellt.
    jetzt.forEach((p, i) => {
      const a = alt[i];
      if (!a || a.von !== p.von) zeilen.push({ art: 'pause_start', zeit: p.von });
      if (!a || a.bis !== p.bis) zeilen.push({ art: 'pause_ende', zeit: p.bis });
    });
    alt.slice(jetzt.length).forEach((a) => zeilen.push({ art: 'pause_weg', zeit: a.von, bis: a.bis }));
    if (ende && ende !== hm(vorher.ende)) zeilen.push({ art: 'ende', zeit: ende });
    if (!zeilen.length) zeilen = ganz();
  }
  const beginn = minuten(start || vorher?.start);
  const rang = { start: 0, pause_start: 1, pause_weg: 1, pause_ende: 2, ende: 3 };
  return zeilen.sort((a, b) => {
    if (a.art === 'start') return -1;
    if (b.art === 'start') return 1;
    if (a.art === 'ende') return 1;
    if (b.art === 'ende') return -1;
    return sortierWert(a.zeit, beginn) - sortierWert(b.zeit, beginn) || rang[a.art] - rang[b.art];
  });
};

// Text einer Zeile.
export const zeilenText = (z, t) => {
  if (z.art === 'start') return t('screens.serviceStart', { time: z.zeit });
  if (z.art === 'ende') return t('screens.serviceEnd', { time: z.zeit });
  if (z.art === 'pause_start') return t('screens.pauseStart', { time: z.zeit });
  if (z.art === 'pause_ende') return t('screens.pauseEnd', { time: z.zeit });
  return t('screens.pauseRemoved', { von: z.zeit, bis: z.bis });
};

export const LIME = '#E3F654';
export const ROT = '#FF6F63';
export const GRAU = '#868687';
export const zeilenFarbe = (z) => (z.art === 'start' ? LIME : z.art === 'ende' ? ROT : GRAU);

// Schriftgroesse: erste Zeile gross (Dienst 38, Pause 33, Pause entfaellt 26), weitere 24.
export const zeilenGroesse = (z, erste) => {
  if (!erste) return 24;
  if (z.art === 'start' || z.art === 'ende') return 38;
  return z.art === 'pause_weg' ? 26 : 33;
};

// Kartenhoehe: 2 Rand + 19 Luft + Zeilen (je 20 Abstand dazwischen) + 19 Luft + 2 Rand.
export const anfrageKartenHoehe = (zeilen) => 42 + (zeilen || []).reduce((n, z, i) => n + zeilenGroesse(z, i === 0) + (i ? 20 : 0), 0);

// Angenommener Dienst: Pausen als Zeilen mit Minuten ab Tagesbeginn (fuer die Reihenfolge zwischen den Fahrten).
export const pausenZeilen = (pausen, startTime) => {
  const beginn = minuten(startTime);
  return pausenListe(pausen).flatMap((p, i) => [
    { art: 'pause_start', zeit: p.von, m: sortierWert(p.von, beginn), key: `ps${i}` },
    { art: 'pause_ende', zeit: p.bis, m: sortierWert(p.bis, beginn) + 0.5, key: `pe${i}` },
  ]);
};

export const zuMinuten = minuten;
