// Fahrtenbuch je Fahrzeug: Export fuer die Dispo (Web, iOS, Android rufen alle diese Aktion auf).
// fahrtenbuch_export { vehicle_id: uuid, von: "2026-11-01", bis: "2026-11-30", format: "xlsx" | "csv" | "pdf" }
// -> { datei: base64, dateiname, typ, zeilen }
// Die Daten kommen aus der Datenbank-Funktion fahrtenbuch_daten (haengt an der Fahrgestellnummer).

// deno-lint-ignore-file no-explicit-any
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

type Admin = any;
const antwort = (status: number, daten: unknown) => ({ status, daten });

const TYP: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  pdf: 'application/pdf',
};
const ART: Record<string, string> = { gast: 'Gast', leer: 'Leer' };
const QUELLE: Record<string, string> = { tacho: 'Tacho', gps_zaehler: 'GPS-Zähler', gps_spur: 'GPS-Spur (ca.)', route: 'Route (ca.)' };

const zeit = (iso: string | null | undefined) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
};
const datumDe = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const zahl = (n: unknown) => (n === null || n === undefined || n === '' ? null : Number(n));
const komma = (n: number | null, stellen = 1) => (n === null ? '' : n.toFixed(stellen).replace('.', ','));

const base64 = (u8: Uint8Array) => {
  let roh = '';
  for (let i = 0; i < u8.length; i += 0x8000) roh += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(roh);
};

const KOPF = ['Datum', 'Beginn', 'Ende', 'Art', 'Von', 'Nach', 'Fahrer', 'km-Stand Beginn', 'km-Stand Ende', 'km', 'Quelle', 'Kennzeichen'];

// Eine Zeile je Eintrag, aelteste zuerst (so liest sich ein Fahrtenbuch).
const tabelle = (d: any) => [...(d.zeilen || [])].reverse().map((z: any) => ({
  datum: datumDe(String(z.tag)),
  beginn: zeit(z.beginn),
  ende: zeit(z.ende),
  art: ART[z.art] || z.art || '',
  von: z.von || '',
  nach: z.nach || '',
  fahrer: z.fahrer || '',
  kmStart: zahl(z.km_start),
  kmEnde: zahl(z.km_ende),
  km: zahl(z.km),
  quelle: QUELLE[z.km_quelle] || '',
  kennzeichen: z.kennzeichen || '',
}));

const kopfzeilen = (d: any) => [
  ['Fahrtenbuch', d.kennzeichen || ''],
  ['Fahrzeug', d.fahrzeug || ''],
  ['Fahrgestellnummer', d.vin || ''],
  ['Zeitraum', `${datumDe(String(d.von))} – ${datumDe(String(d.bis))}`],
  ['Kilometerstand', zahl(d.km_stand) ?? ''],
  ['km gesamt', zahl(d.km_gesamt) ?? 0],
  ['km Gast', zahl(d.km_gast) ?? 0],
  ['km Leer', zahl(d.km_leer) ?? 0],
];

const alsXlsx = (d: any) => {
  const zeilen: unknown[][] = [...kopfzeilen(d), [], KOPF];
  for (const z of tabelle(d)) {
    zeilen.push([z.datum, z.beginn, z.ende, z.art, z.von, z.nach, z.fahrer, z.kmStart ?? '', z.kmEnde ?? '', z.km ?? '', z.quelle, z.kennzeichen]);
  }
  const mappe = XLSX.utils.book_new();
  const blatt = XLSX.utils.aoa_to_sheet(zeilen);
  blatt['!cols'] = [18, 22, 8, 8, 30, 30, 20, 15, 15, 9, 15, 13].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(mappe, blatt, 'Fahrtenbuch');
  return new Uint8Array(XLSX.write(mappe, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
};

// CSV fuer deutsches Excel: Strichpunkt, Komma als Dezimalzeichen, BOM fuer Umlaute.
const alsCsv = (d: any) => {
  const feld = (w: unknown) => {
    const s = String(w ?? '');
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const zeilen = [[...KOPF, 'Fahrgestellnummer'].map(feld).join(';')];
  for (const z of tabelle(d)) {
    zeilen.push([z.datum, z.beginn, z.ende, z.art, z.von, z.nach, z.fahrer, komma(z.kmStart, 0), komma(z.kmEnde, 0), komma(z.km), z.quelle, z.kennzeichen, d.vin || '']
      .map(feld).join(';'));
  }
  return new TextEncoder().encode('﻿' + zeilen.join('\r\n') + '\r\n');
};

// PDF quer, eine Tabelle, Kopf auf jeder Seite.
const alsPdf = async (d: any) => {
  const { PDFDocument, StandardFonts, rgb } = await import('https://esm.sh/pdf-lib@1.17.1');
  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold);
  const B = 841.89, H = 595.28, RAND = 36;
  // Helvetica kennt nur WinAnsi: alles andere wird ersetzt, damit ein Sonderzeichen den Export nicht abbricht.
  const sauber = (s: string) => [...String(s ?? '')].map((c) => {
    const n = c.codePointAt(0) || 0;
    if (c === '→') return '>';
    return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || '–—€‚„“”‘’…'.includes(c) ? c : '?';
  }).join('');
  const kuerzen = (s: string, breite: number, font: any, gr: number) => {
    let t = sauber(s);
    if (font.widthOfTextAtSize(t, gr) <= breite) return t;
    while (t.length > 1 && font.widthOfTextAtSize(t + '…', gr) > breite) t = t.slice(0, -1);
    return t + '…';
  };
  const spalten = [
    { t: 'Datum', b: 56 }, { t: 'Beginn', b: 38 }, { t: 'Ende', b: 38 }, { t: 'Art', b: 34 },
    { t: 'Von', b: 158 }, { t: 'Nach', b: 158 }, { t: 'Fahrer', b: 96 },
    { t: 'Stand Beginn', b: 62, r: true }, { t: 'Stand Ende', b: 58, r: true }, { t: 'km', b: 40, r: true }, { t: 'Quelle', b: 31.89 },
  ];
  const zeilen = tabelle(d);
  let seite: any = null;
  let y = 0;
  let nr = 0;
  const zelle = (text: string, x: number, sp: any, font: any, gr: number, farbe = rgb(0.11, 0.11, 0.11)) => {
    const t = kuerzen(text, sp.b - 6, font, gr);
    const dx = sp.r ? sp.b - 6 - font.widthOfTextAtSize(t, gr) : 0;
    seite.drawText(t, { x: x + dx, y, size: gr, font, color: farbe });
  };
  const neueSeite = () => {
    seite = pdf.addPage([B, H]);
    nr += 1;
    y = H - RAND - 14;
    seite.drawText(sauber(`Fahrtenbuch ${d.kennzeichen || ''}`), { x: RAND, y, size: 16, font: fett });
    const rechts = sauber(`${datumDe(String(d.von))} – ${datumDe(String(d.bis))}   Seite ${nr}`);
    seite.drawText(rechts, { x: B - RAND - normal.widthOfTextAtSize(rechts, 9), y: y + 2, size: 9, font: normal, color: rgb(0.4, 0.4, 0.4) });
    y -= 16;
    const unter = [d.fahrzeug, d.vin ? `Fahrgestellnummer ${d.vin}` : '', zahl(d.km_stand) !== null ? `Kilometerstand ${komma(zahl(d.km_stand), 0)}` : '']
      .filter(Boolean).join('   ');
    seite.drawText(sauber(unter), { x: RAND, y, size: 9, font: normal, color: rgb(0.4, 0.4, 0.4) });
    if (nr === 1) {
      y -= 14;
      seite.drawText(sauber(`Gesamt ${komma(zahl(d.km_gesamt) ?? 0)} km   Gast ${komma(zahl(d.km_gast) ?? 0)} km   Leer ${komma(zahl(d.km_leer) ?? 0)} km`),
        { x: RAND, y, size: 10, font: fett });
    }
    y -= 20;
    let x = RAND;
    for (const sp of spalten) { zelle(sp.t, x, sp, fett, 8); x += sp.b; }
    y -= 5;
    seite.drawLine({ start: { x: RAND, y }, end: { x: B - RAND, y }, thickness: 0.7, color: rgb(0.11, 0.11, 0.11) });
    y -= 12;
  };
  neueSeite();
  for (const z of zeilen) {
    if (y < RAND + 10) neueSeite();
    const werte = [z.datum, z.beginn, z.ende, z.art, z.von, z.nach, z.fahrer, komma(z.kmStart, 0), komma(z.kmEnde, 0), komma(z.km),
      z.quelle.replace(' (ca.)', '').replace('GPS-Zähler', 'GPS').replace('GPS-Spur', 'ca.').replace('Route', 'ca.')];
    let x = RAND;
    werte.forEach((w, i) => { zelle(w, x, spalten[i], normal, 8); x += spalten[i].b; });
    y -= 4;
    seite.drawLine({ start: { x: RAND, y }, end: { x: B - RAND, y }, thickness: 0.3, color: rgb(0.85, 0.85, 0.85) });
    y -= 11;
  }
  return new Uint8Array(await pdf.save());
};

export const fahrtenbuchExport = async (admin: Admin, body: any) => {
  const von = String(body?.von || '').slice(0, 10);
  const bis = String(body?.bis || '').slice(0, 10);
  const format = String(body?.format || 'xlsx').toLowerCase();
  const fahrzeug = String(body?.vehicle_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(fahrzeug)) return antwort(400, { error: 'fahrzeug_fehlt' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis) || bis < von) return antwort(400, { error: 'zeitraum_ungueltig' });
  if (!TYP[format]) return antwort(400, { error: 'format_ungueltig' });

  const { data: d, error } = await admin.rpc('fahrtenbuch_daten', { p_vehicle: fahrzeug, p_von: von, p_bis: bis });
  if (error) return antwort(500, { error: error.message });
  if (!d) return antwort(404, { error: 'fahrzeug_unbekannt' });

  const bytes = format === 'pdf' ? await alsPdf(d) : format === 'csv' ? alsCsv(d) : alsXlsx(d);
  const name = String(d.kennzeichen || d.vin || 'Fahrzeug').replace(/[^A-Za-z0-9ÄÖÜäöü-]+/g, '-');
  return antwort(200, {
    datei: base64(bytes),
    dateiname: `TRISAR-Fahrtenbuch_${name}_${von}_${bis}.${format}`,
    typ: TYP[format],
    zeilen: (d.zeilen || []).length,
  });
};
