// Haeufige Tippfehler und Verhoerer glaetten, bevor Regeln oder Modell den Satz lesen (15.11.).
// Aus dem ki_protokoll: "Dienst statt für 23:30" (gemeint Dienststart) wurde zur Frage nach dem Dienstende,
// "tim morgn ab 7" wurde zu heute. Nur feste, eindeutige Formen, damit kein richtiges Wort veraendert wird
// ("morgens", "sorgen" bleiben).

const FORMEN: [RegExp, string][] = [
  [/\bdienst\s*(statt|stadt|staat|stat|start\s*up|startup)\b/gi, 'Dienststart'],
  [/\bdienst\s+start\b/gi, 'Dienststart'],
  [/\bdienst\s+(beginn|begin)\b/gi, 'Dienstbeginn'],
  [/\bdienstbegin\b/gi, 'Dienstbeginn'],
  [/\bdienst\s+ende\b/gi, 'Dienstende'],
  [/\b(ü|ue)bermo(rgn|gren|rgne|regn|rgem|rgeb)\b/gi, 'übermorgen'],
  [/\b(morgn|mogren|mrogen|morgne|moregn|morgem|morgeb|mogen)\b/gi, 'morgen'],
  [/\bheut\b/gi, 'heute'],
  [/\bgestren\b/gi, 'gestern'],
  [/\bfeier\s*a(bnd|bned|bedn|ben)\b/gi, 'Feierabend'],
  [/\bfeier\s+abend\b/gi, 'Feierabend'],
];

const ENDE_WORT = /\b(bis|ende|dienstende|schichtende|feierabend|schluss|aufh(ö|oe)r\w*)\b/i;

export const glaetten = (frage: string) => {
  let text = String(frage || '');
  const ersetzt: string[] = [];
  for (const [muster, neu] of FORMEN) {
    text = text.replace(muster, (alt) => {
      if (alt.toLowerCase() !== neu.toLowerCase()) ersetzt.push(`${alt} -> ${neu}`);
      return neu;
    });
  }
  // "24 Uhr" als Ende ist Mitternacht (16.11.): "Dienstende heute 24 Uhr" fragte nach der Uhrzeit, "von 16 bis
  // 24 Uhr" verlor still das Ende. Regeln und Modell kennen nur 00:00 bis 23:59, und 00:00 als Ende heisst dort
  // schon "nach Mitternacht". Nur nach einem Ende-Wort. "24 Uhr" als Beginn faengt unmoeglich() ab.
  text = text.replace(/\b24(?:[:.]00)?\s*uhr\b|\b24:00\b|(?<=\bbis\s)24\b(?!\s*[.:,]?\d|\s*\.|\s*(?:euro|€|fahrer|stunden|std|min|km|personen|g(?:ä|ae)ste|tage)\b)/gi, (alt: string, pos: number) => {
    if (!ENDE_WORT.test(text.slice(0, pos))) return alt;
    ersetzt.push(`${alt} -> 00:00`);
    return '00:00';
  });
  return { text, ersetzt };
};

// Das Modell rutscht selten mitten im Satz ins Chinesische (15.11. bei "Wie wird das Wetter morgen").
// Ab dem ersten solchen Zeichen abschneiden. Bleibt kaum etwas uebrig, gilt die Antwort als unbrauchbar (null).
export const nurDeutsch = (antwort: string): string | null => {
  const text = String(antwort || '');
  const pos = text.search(/[\u3000-\u30ff\u3400-\u9fff\uac00-\ud7af\uff00-\uffef]/);
  if (pos < 0) return text;
  const rest = text.slice(0, pos).replace(/\s+\S*$/, '').trim();
  const saetze = rest.match(/^.*[.!?]/s)?.[0]?.trim() || '';
  return saetze.length >= 15 ? saetze : null;
};

// Unmoegliche Angaben abfangen, bevor Modell oder Regeln sie still umdeuten (15.11., Haertetest):
// "25 Uhr" wurde 01:00, der "30.02." wurde der 30.11., "Pause von 12 bis 11" wurde 11 bis 12.
// Liefert die Rueckfrage oder null.
export const unmoeglich = (frage: string, jahr: number): string | null => {
  const t = String(frage || '');
  // Datum TT.MM. oder TT.MM.JJJJ
  for (const m of t.matchAll(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4})?(?!\d)/g)) {
    const tag = Number(m[1]);
    const monat = Number(m[2]);
    const jahre = m[3] ? [Number(m[3])] : [jahr, jahr + 1];
    const gibtEs = monat >= 1 && monat <= 12 && tag >= 1 && jahre.some((j) => tag <= new Date(Date.UTC(j, monat, 0)).getUTCDate());
    if (!gibtEs) return `Den ${m[1]}.${m[2]}. gibt es nicht. Welchen Tag meinst du? Ich habe nichts geändert.`;
  }
  const ohneDatum = t.replace(/(?<![\d.])\d{1,2}\.\d{1,2}\.(\d{4})?(?!\d)/g, ' ');
  // Uhrzeit HH:MM, HH.MM Uhr, HH Uhr
  for (const m of ohneDatum.matchAll(/(?<![\d:.,])(\d{1,2}):(\d{2})(?![\d:])|(?<![\d:.,])(\d{1,2})\.(\d{2})\s*uhr\b|(?<![\d:.,])(\d{1,2})\s*uhr\b/gi)) {
    const h = Number(m[1] ?? m[3] ?? m[5]);
    const min = Number(m[2] ?? m[4] ?? 0);
    if (h > 24 || min > 59 || (h === 24 && min > 0)) return `Die Uhrzeit „${m[0].trim()}“ gibt es nicht. Welche Zeit meinst du? Ich habe nichts geändert.`;
    // 24 Uhr ohne Ende-Wort davor (glaetten hat es sonst schon zu 00:00 gemacht): als Beginn nicht eindeutig.
    if (h === 24) return `„${m[0].trim()}“ ist hier nicht eindeutig. Schreib bitte 0 Uhr und den Tag, den du meinst. Ich habe nichts geändert.`;
  }
  // Pause, die vor ihrem Beginn endet (nicht ueber Mitternacht)
  const p = ohneDatum.match(/pause\D{0,25}?(\d{1,2})(?:[:.](\d{2}))?\s*(?:uhr\s*)?(?:bis|-|–)\s*(\d{1,2})(?:[:.](\d{2}))?/i);
  if (p) {
    const von = Number(p[1]) * 60 + Number(p[2] || 0);
    // 00:00 als Ende ist Mitternacht (auch aus "bis 24 Uhr"), also das Tagesende.
    const bis = (Number(p[3]) * 60 + Number(p[4] || 0)) || 24 * 60;
    if (bis <= von && !(von >= 21 * 60 && bis <= 4 * 60)) return `Die Pause endet um ${p[3]}${p[4] ? `:${p[4]}` : ''} vor ihrem Beginn um ${p[1]}${p[2] ? `:${p[2]}` : ''}. Von wann bis wann soll sie gehen? Ich habe nichts geändert.`;
  }
  return null;
};
