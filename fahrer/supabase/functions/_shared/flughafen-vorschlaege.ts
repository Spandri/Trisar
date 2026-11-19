// Feste Flughafen-Vorschlaege fuer die Adresssuche (places-proxy) und den KI-Assistenten (dispo-admin/ortSuche.ts).

// Flughaefen immer zuerst und richtig: "muc t2", "MUC Terminal 2", "Flughafen Muenchen" usw.
// Ohne das schlug Google bei Kuerzeln nichts vor und die Apps fielen auf eine weltweite Suche zurueck
// ("Muc T2" landete in Italien). Die Texte passen zu den festen Koordinaten in _shared/tomtom-routing.ts.
export const FLUGHAFEN_VORSCHLAEGE: Array<{ muster: RegExp; vorschlaege: string[] }> = [
  // General Aviation Terminal (18.11.): "GAT München Flughafen" wurde sonst eine Filmfirma in Bogenhausen.
  // Vor MUC, damit "MUC GAT" nicht bei den Terminals landet.
  { muster: /^(gat\b|muc[ -]?gat\b|general[ -]?aviation|allgemeine luftfahrt)|\bgat\b.*(flughafen|airport|m(ü|ue|u)n)|(flughafen|airport|muc)\b.*\b(gat\b|general[ -]?aviation)/i,
    vorschlaege: ['Flughafen München General Aviation Terminal (GAT)'] },
  // "Franz Josef" nur ohne Strasse dahinter (18.11.: "Franz Josef Straße 48" wurde Terminal 2).
  { muster: /^(muc\b|flughafen m(ü|ue|u)n|munich airport|airport m(ü|ue|u)n|franz[- ]?jos(ef|eph)\b(?![- ]?(stra(ss|ß)e|str\b|str\.|platz|weg|ring|allee|gasse)))/i,
    vorschlaege: ['Flughafen München Terminal 2', 'Flughafen München Terminal 1'] },
  { muster: /^(fra\b|flughafen frankf|frankfurt airport)/i, vorschlaege: ['Flughafen Frankfurt'] },
  { muster: /^(nue\b|flughafen n(ü|ue|u)rn|nuremberg airport)/i, vorschlaege: ['Flughafen Nürnberg'] },
  { muster: /^(str\b(?!a)|flughafen stuttg|stuttgart airport)/i, vorschlaege: ['Flughafen Stuttgart'] },
  { muster: /^(ber\b|flughafen berl|berlin brandenburg)/i, vorschlaege: ['Flughafen Berlin Brandenburg'] },
  { muster: /^(fmm\b|flughafen memm|memmingen airport|allg(ä|ae)u airport)/i, vorschlaege: ['Flughafen Memmingen'] },
];

export const flughafenVorschlaege = (eingabe: string) => {
  const text = eingabe.trim();
  const treffer = FLUGHAFEN_VORSCHLAEGE.find((f) => f.muster.test(text));
  if (!treffer) return [];
  let liste = treffer.vorschlaege;
  // Terminal schon getippt ("muc t1", "MUC Terminal 1"): das passende Terminal zuerst.
  if (/\b(t|terminal)\s*1\b/i.test(text)) liste = [...liste].sort((a) => (/Terminal 1$/.test(a) ? -1 : 1));
  return liste.map((description) => ({ description, place_id: '' }));
};
