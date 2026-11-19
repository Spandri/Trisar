// Feste Uhr fuer den zurueckgehaltenen Topf (18.11.): Datum UND Uhrzeit stehen fest, Standard Mittwoch 18.11.2026
// 11:00 Berlin. Die Erwartungen in zurueck/*.json ("morgen", "übernächsten Freitag" = 27.11.) gelten fuer diesen Tag.
// Anders als uhr.ts, das nur die Uhrzeit festhaelt. Muss vor allen anderen Modulen geladen werden.
//   --datum=2026-11-18 --uhr=11:00
// deno-lint-ignore-file no-explicit-any
const arg = (n: string, s: string) => Deno.args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) || s;
const [jahr, monat, tag] = arg('datum', '2026-11-18').split('-').map(Number);
const [hh, mm] = arg('uhr', '11:00').split(':').map(Number);
const Echt = Date;
// Abstand Berlin zu UTC an diesem Tag (Winterzeit 60 min, Sommerzeit 120 min).
const probe = new Echt(Echt.UTC(jahr, monat - 1, tag, 12, 0));
const berlinStunde = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', hourCycle: 'h23' }).format(probe));
const versatz = (berlinStunde - 12) * 60;
const ziel = Echt.UTC(jahr, monat - 1, tag, hh, mm) - versatz * 60000;
const verschiebung = ziel - Echt.now();
class TestDate extends Echt {
  constructor(...a: any[]) {
    if (a.length === 0) super(Echt.now() + verschiebung);
    else super(...(a as []));
  }
  static now() { return Echt.now() + verschiebung; }
}
(globalThis as any).Date = TestDate;
console.log(`Feste Uhr: ${new Date().toISOString()} (Berlin ${arg('datum', '2026-11-18')} ${arg('uhr', '11:00')})`);
if (!Deno.env.get('KI_SPERRE_MS')) Deno.env.set('KI_SPERRE_MS', '0');
