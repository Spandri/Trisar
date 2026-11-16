// Ausgenommene Fahrer einer Frage ("allen bis auf Stefano", "alle außer Tim und Lisa", "Stefano nicht").
// Das Modell liest die Namen frei (verstehen.ts, Feld ausser), ki.ts loest sie zu Fahrern auf und legt sie hier
// je Anfrage ab. Der Schluessel ist der admin-Client, den index.ts fuer jede Anfrage neu anlegt.
// alleFahrer und genannteFahrer (dienst.ts) lassen die Ausgenommenen weg, damit jede Regel sie beachtet,
// ohne dass jede Regel eigene Muster dafuer braucht.

type Fahrer = { id: string; name: string };

const AUSNAHMEN = new WeakMap<object, Fahrer[]>();

export const ausnahmenSetzen = (admin: any, fahrer: Fahrer[]) => {
  if (admin && typeof admin === 'object') AUSNAHMEN.set(admin, fahrer);
};

export const ausnahmen = (admin: any): Fahrer[] => (admin && typeof admin === 'object' ? AUSNAHMEN.get(admin) || [] : []);

export const ohneAusnahmen = <T extends { id: string }>(admin: any, liste: T[]): T[] => {
  const weg = new Set(ausnahmen(admin).map((f) => f.id.toLowerCase()));
  return weg.size ? liste.filter((f) => !weg.has(String(f.id).toLowerCase())) : liste;
};

// Fuer Vorschlags-Texte: " (ohne Stefano Spandri)", sonst "".
export const ausnahmenText = (admin: any) => {
  const a = ausnahmen(admin);
  return a.length ? ` (ohne ${a.map((f) => f.name).join(', ')})` : '';
};
