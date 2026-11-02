// Tastenlogik der iOS-Bildschirmtastatur — ohne JSX, damit Komponente und
// Aufrufer (Login-Trailer, Notiz-Blatt, App.jsx) sie gemeinsam nutzen koennen.

export const REIHE_1 = ['Q', 'W', 'E', 'R', 'T', 'Z', 'U', 'I', 'O', 'P', 'Ü'];
export const REIHE_2 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'Ö', 'Ä'];
export const REIHE_3 = ['Y', 'X', 'C', 'V', 'B', 'N', 'M'];

// Zweite Ebene (Taste 123) — Ziffern und Satzzeichen wie auf dem iPhone.
export const ZAHL_1 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
export const ZAHL_2 = ['-', '/', ':', ';', '(', ')', '€', '&', '@', '"'];
export const ZAHL_3 = ['.', ',', '?', '!', "'"];


// Welche Taste gehoert zu einem Zeichen? Buchstaben werden gross verglichen,
// weil die Tastatur Grossbuchstaben zeigt.
export const tasteFuer = (zeichen) => {
  if (!zeichen) return null;
  if (zeichen === ' ') return 'leer';
  return zeichen.toUpperCase();
};

// Wortvorschlaege der Tastatur. iOS zeigt links das woertlich Getippte in
// Anfuehrungszeichen und daneben passende Ergaenzungen; bei Passwortfeldern
// bleibt die Leiste leer. Die Kandidaten sind eine kleine Demo-Liste — ein
// echtes Woerterbuch braucht die Inszenierung nicht.
const WORT_KANDIDATEN = [
  'stefano', 'stefan', 'steffen', 'spandri', 'spandau', 'sparda',
  'trisar', 'trisha', 'tristan', 'de', 'demo', 'deutsch',
  // Notiz zur Fahrt
  'gast', 'gäste', 'gepäck', 'hotel', 'koffer', 'minuten', 'später', 'verspätung', 'zusätzliche', 'zurück',
];

export const vorschlaegeFuer = (text) => {
  // Wortgrenzen einer Adresse: Punkt, At-Zeichen, Bindestrich, Leerzeichen.
  const wort = String(text || '').split(/[.@\s_-]/).pop();
  if (wort.length < 2) return [];
  const klein = wort.toLowerCase();
  const treffer = WORT_KANDIDATEN
    .filter((k) => k.startsWith(klein) && k !== klein)
    .slice(0, 2);
  return [`\u201C${wort}\u201D`, ...treffer];
};

// Auf welcher Ebene liegt ein Zeichen? Der Trailer schaltet danach um.
const BUCHSTABEN = new Set([...REIHE_1, ...REIHE_2, ...REIHE_3]);
const MAIL_EXTRA = new Set(['@', '.']);
export const ebeneFuer = (zeichen, istMail) => {
  if (!zeichen || zeichen === ' ') return null;             // ueberall vorhanden
  if (BUCHSTABEN.has(zeichen.toUpperCase())) return 'abc';
  if (istMail && MAIL_EXTRA.has(zeichen)) return 'abc';     // Mail-Tastatur hat @ und .
  return 'zahlen';
};
