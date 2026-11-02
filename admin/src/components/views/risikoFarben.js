// Farben und kleine Helfer fuer die Risiko-Ansichten. Eigene Datei, weil
// Komponenten-Dateien fuer Fast Refresh nur Komponenten exportieren sollen.

export const LIME = '#e3f654';
export const GRUEN = '#59be80';
export const ROT = '#ff6f63';
export const DUNKEL = '#1c1c1d';

export const KLASSE_FARBE = { hoch: ROT, mittel: LIME, niedrig: GRUEN };

// Luft am schlechten Tag (1 von 10): bis 2 min knapp, ab 10 min sicher.
export const luftFarbe = (v) => (v == null ? '#3a3a3a' : v <= 2 ? ROT : v < 10 ? LIME : GRUEN);

export const zahl = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n)).toLocaleString('de-DE') : '–');

export const minuten = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
};

// Zeitfenster eines Ereignisses ("18:00–20:15 · 22:15–23:45") als Minutenpaare.
export const fensterAus = (zeit) => String(zeit || '').split('·')
  .map((teil) => teil.trim().split(/[–-]/).map(minuten))
  .filter(([a, b]) => a != null && b != null);
