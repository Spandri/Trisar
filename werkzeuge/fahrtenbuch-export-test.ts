// Export des Fahrtenbuchs lokal pruefen (nichts geht an den Server):
//   deno run --allow-net --allow-import --allow-write werkzeuge/fahrtenbuch-export-test.ts <Zielordner>
// Schreibt je eine xlsx-, csv- und pdf-Datei aus Beispieldaten in den Zielordner.
import { fahrtenbuchExport } from '../fahrer/supabase/functions/dispo-admin/fahrtenbuch.ts';

const ziel = Deno.args[0] || '.';
const zeilen = [];
for (let i = 0; i < 70; i += 1) {
  const leer = i % 2 === 1;
  zeilen.push({
    id: 100 - i, tag: `2026-11-${String(21 - Math.floor(i / 6)).padStart(2, '0')}`, art: leer ? 'leer' : 'gast',
    beginn: `2026-11-17T${String(8 + (i % 10)).padStart(2, '0')}:13:00Z`, ende: `2026-11-17T${String(9 + (i % 10)).padStart(2, '0')}:12:00Z`,
    km_start: i % 7 === 3 ? null : 48165 - i * 20, km_ende: i % 7 === 3 ? null : 48203 - i * 20,
    km: 38.1 - (i % 5), km_quelle: i % 7 === 3 ? 'route' : 'tacho',
    von: leer ? 'Bayerischer Hof' : 'Flughafen München Terminal 2 Ebene 03 Ankunft → Süd', nach: leer ? 'Depot Größe' : 'Hotel Bayerischer Hof, Promenadeplatz 2–6, 80333 München',
    fahrer: i % 3 ? 'Joris Müller' : null, kennzeichen: 'M-X7247',
  });
}
const daten = { vehicle_id: 'x', vin: 'WBA21EN0309582583', kennzeichen: 'M-X7247', fahrzeug: 'BMW X7', km_stand: 48212,
  von: '2026-11-01', bis: '2026-11-21', km_gesamt: 1284.4, km_gast: 842.1, km_leer: 442.3, zeilen };
const admin = { rpc: () => Promise.resolve({ data: daten, error: null }) };
for (const format of ['xlsx', 'csv', 'pdf']) {
  const { status, daten: d } = await fahrtenbuchExport(admin, { vehicle_id: '00000000-0000-0000-0000-0000000000a1', von: '2026-11-01', bis: '2026-11-21', format }) as any;
  if (status !== 200) { console.log('FEHLER', format, d); continue; }
  const bytes = Uint8Array.from(atob(d.datei), (c) => c.charCodeAt(0));
  await Deno.writeFile(`${ziel}/${d.dateiname}`, bytes);
  console.log('ok  ', d.dateiname, bytes.length, 'Bytes');
}
for (const [body, soll] of [[{ vehicle_id: 'x', von: '2026-11-01', bis: '2026-11-21' }, 400], [{ vehicle_id: '00000000-0000-0000-0000-0000000000a1', von: '2026-11-21', bis: '2026-11-01' }, 400], [{ vehicle_id: '00000000-0000-0000-0000-0000000000a1', von: '2026-11-01', bis: '2026-11-21', format: 'doc' }, 400]] as [any, number][]) {
  const r = await fahrtenbuchExport(admin, body) as any;
  console.log(r.status === soll ? 'ok  ' : 'FEHLER', 'Eingabe abgelehnt', r.daten.error);
}
