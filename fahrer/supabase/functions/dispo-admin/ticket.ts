// Ticket lesen (Dienstreise, 14.11.2026): DB-Online-Ticket (PDF) -> Reisender, Auftragsnummer, Datum,
// Abschnitte mit Zeiten, Gleisen und Produkt. Das PDF liegt im Speicher dienstreise-tickets (die Dispo hat
// es dort abgelegt), gelesen wird nur hier auf dem eigenen Server, kein fremder Dienst.
//
// Die Verbindungstabelle des Tickets hat feste Spalten: Halt | Datum | Zeit | Gleis | Produkte |
// Reservierung / Hinweise. Je Abschnitt eine Zeile "ab" (Start) und darunter "an" (Ziel). Die Textstuecke
// werden ueber ihre x-Position den Spalten zugeordnet und ueber y zu Zeilen gruppiert.

// deno-lint-ignore no-explicit-any
type Admin = any;
type Stueck = { x: number; y: number; text: string };

export type TicketAbschnitt = {
  art: 'zug' | 'bus' | 'ubahn' | 'sbahn' | 'tram' | 'flug' | 'sonst';
  nummer: string;
  von: string;
  nach: string;
  ab_datum: string | null;
  ab: string;
  an_datum: string | null;
  an: string;
  gleis_ab: string;
  gleis_an: string;
  hinweis: string;
};

const SPALTEN = ['Halt', 'Datum', 'Zeit', 'Gleis', 'Produkte', 'Reservierung / Hinweise'] as const;

const artVonProdukt = (produkt: string): TicketAbschnitt['art'] => {
  const p = produkt.trim().toUpperCase();
  if (/^BUS\b/.test(p)) return 'bus';
  if (/^U\d|^U-?BAHN/.test(p)) return 'ubahn';
  if (/^S\d|^S-?BAHN/.test(p)) return 'sbahn';
  if (/^(STR|TRAM)\b/.test(p)) return 'tram';
  if (/^(ICE|IC|EC|ECE|RJX?|NJ|EN|TGV|FLX|WB|RE|RB|IRE|MEX|ALX|BRB|ARV|ERB|AG)\b/.test(p)) return 'zug';
  return 'sonst';
};

// "14.11." + Jahr der Reise -> "2026-11-14"
const isoTag = (tm: string, jahr: string) => {
  const m = tm.match(/^(\d{2})\.(\d{2})\.?$/);
  return m && jahr ? `${jahr}-${m[2]}-${m[1]}` : null;
};

/** Text eines DB-Tickets lesen. Gibt null zurueck, wenn es kein DB-Ticket ist. */
export const dbTicketLesen = (stuecke: Stueck[], volltext: string) => {
  if (!/Auftragsnummer/i.test(volltext) || !/Halt\s+Datum\s+Zeit/i.test(volltext)) return null;

  const jahr = volltext.match(/am (\d{2})\.(\d{2})\.(\d{4})/)?.[3]
    || volltext.match(/Gültigkeit: \d{2}\.\d{2}\.(\d{4})/)?.[1] || '';
  const reisedatum = (() => {
    const m = volltext.match(/Reiseverbindung[^]*?am (\d{2})\.(\d{2})\.(\d{4})/) || volltext.match(/Gültigkeit: (\d{2})\.(\d{2})\.(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  })();

  // Reisender: das Textstueck direkt vor "Auftragsnummer".
  // Vor- und Nachname sind oft zwei Textstuecke derselben Zeile: alle Stuecke dieser Zeile nehmen.
  const auftragIndex = stuecke.findIndex((s) => /^Auftragsnummer/i.test(s.text));
  const nameY = auftragIndex > 0 ? stuecke[auftragIndex - 1].y : null;
  const name = nameY == null ? '' : stuecke
    .filter((s) => Math.abs(s.y - nameY) < 2 && !/Auftragsnummer|Zangenabdruck|Barcode/i.test(s.text))
    .sort((a, b) => a.x - b.x).map((s) => s.text).join(' ').trim();
  const auftragsnummer = volltext.match(/Auftragsnummer:\s*(\d{6,})/)?.[1] || '';
  const ticketcode = volltext.match(/Ticketcode:\s*([A-Z0-9]+)/)?.[1] || '';
  const klasse = volltext.match(/Klasse\s+(\d\. Klasse)/)?.[1] || '';
  const tarif = volltext.match(/(Super Sparpreis|Sparpreis|Flexpreis|Normalpreis|Deutschland-Ticket)[^.]*?(\([^)]*\))?/)?.[0]?.trim() || '';
  const zugbindung = [...volltext.matchAll(/((?:ICE|IC|EC|ECE|RJX?|NJ|TGV|FLX)\s*\d+)\s*,?\s*(\d{1,2}:\d{2})\s+Uhr\s+am\s+(\d{2}\.\d{2}\.\d{4})/g)]
    .map((m) => `${m[1]} ${m[2]}`);

  // Spaltenkoepfe der Verbindungstabelle.
  const kopfY = stuecke.find((s) => s.text === 'Halt')?.y;
  if (kopfY == null) return null;
  const koepfe = SPALTEN.map((n) => ({ n, x: stuecke.find((s) => s.text === n && Math.abs(s.y - kopfY) < 2)?.x ?? null }))
    .filter((k): k is { n: typeof SPALTEN[number]; x: number } => k.x != null)
    .sort((a, b) => a.x - b.x);
  const spalteVon = (x: number) => {
    let treffer = koepfe[0]?.n;
    for (const k of koepfe) if (x >= k.x - 3) treffer = k.n;
    return treffer;
  };

  // Tabelle: unter dem Kopf bis "Wichtige Nutzungshinweise".
  const endeY = stuecke.find((s) => /^Wichtige/.test(s.text) && s.y < kopfY)?.y ?? -Infinity;
  const zellen = stuecke.filter((s) => s.y < kopfY - 2 && s.y > endeY + 2);
  const zeilenJeY = new Map<number, Record<string, string>>();
  for (const z of zellen) {
    const y = Math.round(z.y);
    const schluessel = [...zeilenJeY.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    const zeile = zeilenJeY.get(schluessel) || {};
    const spalte = spalteVon(z.x) || 'Halt';
    zeile[spalte] = zeile[spalte] ? `${zeile[spalte]} ${z.text}` : z.text;
    zeilenJeY.set(schluessel, zeile);
  }
  const zeilen = [...zeilenJeY.entries()].sort((a, b) => b[0] - a[0]).map(([, z]) => z);

  const abschnitte: TicketAbschnitt[] = [];
  for (let i = 0; i < zeilen.length; i += 1) {
    const ab = zeilen[i];
    const zeitAb = (ab.Zeit || '').match(/^ab\s+(\d{1,2}:\d{2})/);
    if (!zeitAb) continue;
    const an = zeilen[i + 1] || {};
    const zeitAn = (an.Zeit || '').match(/^an\s+(\d{1,2}:\d{2})/);
    const produkt = (ab.Produkte || '').trim();
    abschnitte.push({
      art: artVonProdukt(produkt),
      nummer: produkt,
      von: (ab.Halt || '').trim(),
      nach: (an.Halt || '').trim(),
      ab_datum: isoTag((ab.Datum || '').trim(), jahr),
      ab: zeitAb[1].padStart(5, '0'),
      an_datum: isoTag((an.Datum || '').trim(), jahr),
      an: zeitAn ? zeitAn[1].padStart(5, '0') : '',
      gleis_ab: (ab.Gleis || '').trim(),
      gleis_an: (an.Gleis || '').trim(),
      hinweis: [ab['Reservierung / Hinweise'], an['Reservierung / Hinweise']].filter(Boolean).join(' ').trim(),
    });
    if (zeitAn) i += 1;
  }
  if (!abschnitte.length) return null;

  return {
    quelle: 'db',
    name,
    auftragsnummer,
    ticketcode,
    klasse,
    tarif,
    zugbindung,
    datum: reisedatum || abschnitte[0].ab_datum,
    abschnitte,
  };
};

/** PDF aus dem Speicher holen, Text mit Position lesen, als DB-Ticket deuten. */
export const ticketLesen = async (admin: Admin, body: Record<string, unknown>) => {
  const pfad = String(body?.pfad || '').trim();
  if (!pfad || pfad.includes('..')) return { status: 400, daten: { error: 'pfad fehlt' } };
  const { data: datei, error } = await admin.storage.from('dienstreise-tickets').download(pfad);
  if (error || !datei) return { status: 404, daten: { error: 'Ticket nicht gefunden' } };
  const bytes = new Uint8Array(await datei.arrayBuffer());

  const { getDocumentProxy } = await import('https://esm.sh/unpdf@1.0.5');
  const pdf = await getDocumentProxy(bytes);
  const stuecke: Stueck[] = [];
  const texte: string[] = [];
  // Nur die ersten Seiten, die Verbindung steht vorne.
  for (let s = 1; s <= Math.min(pdf.numPages, 3); s += 1) {
    const seite = await pdf.getPage(s);
    const inhalt = await seite.getTextContent();
    for (const it of inhalt.items as Array<{ str?: string; transform?: number[] }>) {
      const text = String(it.str || '').trim();
      if (!text) continue;
      // Seiten untereinander: y je Seite um 10000 versetzt, damit die Reihenfolge stimmt.
      stuecke.push({ x: it.transform?.[4] ?? 0, y: (it.transform?.[5] ?? 0) - (s - 1) * 10000, text });
      texte.push(text);
    }
  }
  const ergebnis = dbTicketLesen(stuecke, texte.join(' '));
  if (!ergebnis) {
    return { status: 200, daten: { erkannt: false, meldung: 'Kein DB-Ticket erkannt. Bitte die Felder von Hand ausfüllen.' } };
  }
  return { status: 200, daten: { erkannt: true, ...ergebnis } };
};
