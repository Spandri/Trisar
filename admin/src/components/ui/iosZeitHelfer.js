// Hilfen fuer die Zeitauswahl (siehe IosZeitauswahl.jsx).

// Laeuft die App im simulierten iPhone der Demo-Seite?
export const imDemoRahmen = () => {
  try {
    return typeof window !== 'undefined' && window.parent && window.parent !== window;
  } catch {
    return false;
  }
};

export const zeitZuTeilen = (wert) => {
  const treffer = /^(\d{1,2}):(\d{2})/.exec(String(wert || ''));
  if (!treffer) return null;
  return { h: Math.min(23, Number(treffer[1])), m: Math.min(59, Number(treffer[2])) };
};
