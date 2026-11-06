// Stundenerfassung: Excel-Export fuer die Dispo (Web, iOS, Android rufen alle diese Aktion auf).
// stunden_export { von: "2026-11-01", bis: "2026-11-30", fahrer: [uuid] | null }
// -> { datei: base64 xlsx, dateiname }
// Enthaelt jeden angenommenen Dienst im Zeitraum: erfasste Stunden, sonst den Vorschlag ("nicht erfasst").

// deno-lint-ignore-file no-explicit-any
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';

type Admin = any;
const antwort = (status: number, daten: unknown) => ({ status, daten });

const zeit = (iso: string | null | undefined) => {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
};
const datumDe = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const hmm = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, '0')}`;
const STATUS = { eingereicht: 'eingereicht', bestaetigt: 'bestätigt', zurueckgewiesen: 'zurückgegeben' } as Record<string, string>;

export const stundenExport = async (admin: Admin, body: any) => {
  const von = String(body?.von || '').slice(0, 10);
  const bis = String(body?.bis || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(von) || !/^\d{4}-\d{2}-\d{2}$/.test(bis) || bis < von) return antwort(400, { error: 'zeitraum_ungueltig' });
  const fahrerIds: string[] | null = Array.isArray(body?.fahrer) && body.fahrer.length ? body.fahrer : null;

  let q = admin.from('driver_service_requests').select('id, driver_id, service_date, service_start_time, service_end_time, status')
    .gte('service_date', von).lte('service_date', bis).in('status', ['accepted', 'assigned', 'approved'])
    .order('service_date').order('service_start_time');
  if (fahrerIds) q = q.in('driver_id', fahrerIds);
  const { data: dienste, error } = await q;
  if (error) return antwort(500, { error: error.message });

  const ids = [...new Set((dienste || []).map((d: any) => d.driver_id))];
  const { data: profile } = ids.length
    ? await admin.from('profiles').select('id, first_name, last_name').in('id', ids)
    : { data: [] };
  const name = new Map((profile || []).map((p: any) => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || 'Fahrer']));
  const { data: zettel } = (dienste || []).length
    ? await admin.from('stundenzettel').select('*').in('dienst_id', dienste.map((d: any) => d.id))
    : { data: [] };
  const zettelJe = new Map((zettel || []).map((z: any) => [z.dienst_id, z]));

  const kopf = ['Fahrer', 'Datum', 'Dienst geplant', 'Beginn', 'Ende', 'Pause (Min.)', 'Arbeitszeit', 'Stunden (dezimal)',
    'Fahrten', 'Status', 'Angepasst', 'Begründung Fahrer', 'Vorschlag System', 'Notiz Dispo'];
  const zeilen: unknown[][] = [kopf];
  const summen = new Map<string, { tage: number; min: number; bestaetigt: number; offen: number }>();

  for (const d of dienste || []) {
    const z: any = zettelJe.get(d.id);
    // Vorschlag ueber die Datenbank-Funktion ohne Benutzerpruefung (nur service_role darf sie aufrufen).
    const { data: v } = await admin.rpc('stunden_vorschlag_server', { p_dienst_id: d.id });
    const beginn = z?.beginn ?? v?.beginn;
    const ende = z?.ende ?? v?.ende;
    const pause = z?.pause_min ?? v?.pause_min ?? 0;
    const min = z?.arbeits_min ?? v?.arbeits_min ?? 0;
    const fn = String(name.get(d.driver_id) || 'Fahrer');
    zeilen.push([
      fn,
      datumDe(d.service_date),
      `${String(d.service_start_time || '').slice(0, 5)}–${String(d.service_end_time || '').slice(0, 5)}`,
      zeit(beginn), zeit(ende), pause, hmm(min), Math.round(min / 6) / 10,
      (v?.fahrten || []).length,
      z ? STATUS[z.status] || z.status : 'nicht erfasst',
      z?.angepasst ? 'ja' : '',
      z?.begruendung || '',
      z?.vorschlag ? `${zeit(z.vorschlag.beginn)}–${zeit(z.vorschlag.ende)}, ${hmm(z.vorschlag.arbeits_min || 0)} h` : '',
      z?.dispo_notiz || '',
    ]);
    const s = summen.get(fn) || { tage: 0, min: 0, bestaetigt: 0, offen: 0 };
    s.tage += 1; s.min += min;
    if (z?.status === 'bestaetigt') s.bestaetigt += 1; else s.offen += 1;
    summen.set(fn, s);
  }

  const mappe = XLSX.utils.book_new();
  const blatt = XLSX.utils.aoa_to_sheet(zeilen);
  blatt['!cols'] = [22, 11, 13, 8, 8, 11, 11, 15, 8, 14, 10, 34, 24, 28].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(mappe, blatt, 'Stunden');
  const summenZeilen: unknown[][] = [['Fahrer', 'Dienste', 'Arbeitszeit', 'Stunden (dezimal)', 'bestätigt', 'offen']];
  [...summen.entries()].sort().forEach(([fn, s]) => summenZeilen.push([fn, s.tage, hmm(s.min), Math.round(s.min / 6) / 10, s.bestaetigt, s.offen]));
  const summenBlatt = XLSX.utils.aoa_to_sheet(summenZeilen);
  summenBlatt['!cols'] = [22, 9, 12, 16, 10, 8].map((w) => ({ wch: w }));
  XLSX.utils.book_append_sheet(mappe, summenBlatt, 'Summen');

  const bytes = XLSX.write(mappe, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  let roh = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) roh += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return antwort(200, { datei: btoa(roh), dateiname: `TRISAR-Stunden_${von}_${bis}.xlsx`, dienste: (dienste || []).length });
};
