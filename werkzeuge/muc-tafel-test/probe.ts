// Probe der MUC-Tafel ohne Server: deno run -A werkzeuge/muc-tafel-test/probe.ts [datum]
import { mucTafel } from '../../fahrer/supabase/functions/_shared/muc-tafel.ts';
const lh = new Set(['LH', 'VL', 'EW', 'E2', 'LX', 'OS', 'SN', 'EN', '4Y']);
const datum = Deno.args[0] || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
for (const abfluege of [false, true]) {
  const t0 = Date.now();
  const liste = await mucTafel({ abfluege, datum, limit: 8, nurLhGruppe: true, lhGruppe: lh });
  console.log(abfluege ? 'Abfluege' : 'Ankuenfte', datum, `${Date.now() - t0} ms`);
  for (const e of liste) console.log('  ', e.time_label, e.flight_number, e.route_label, e.status_description, 'T' + e.terminal, e.delay_minutes);
}
