// Feste Uhrzeit fuer den Testsatz (15.11.): Datum bleibt heute, die Uhr steht auf --uhr=HH:MM (Berlin),
// Standard 11:00. Sonst haengen Faelle mit "morgen" von der Uhrzeit ab, denn nachts vor 05:00 meint
// "morgen" das heutige Datum (dienst.ts datumAusText). Muss vor allen anderen Modulen geladen werden.
// deno-lint-ignore-file no-explicit-any
const wunsch = Deno.args.find((a) => a.startsWith('--uhr='))?.slice(6) || '11:00';
const [hh, mm] = wunsch.split(':').map(Number);
const Echt = Date;
const berlinTeile = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(d).map((t) => [t.type, t.value]));
const jetzt = new Echt();
const t = berlinTeile(jetzt);
// Abstand Berlin zu UTC (Minuten) fuer heute.
const roh = (Number(t.hour) * 60 + Number(t.minute)) - (jetzt.getUTCHours() * 60 + jetzt.getUTCMinutes());
const versatz = roh < -720 ? roh + 1440 : roh > 720 ? roh - 1440 : roh;
const ziel = Echt.UTC(Number(t.year), Number(t.month) - 1, Number(t.day), hh, mm) - versatz * 60000;
const verschiebung = ziel - Echt.now();
class TestDate extends Echt {
  constructor(...a: any[]) {
    if (a.length === 0) super(Echt.now() + verschiebung);
    else super(...(a as []));
  }
  static now() { return Echt.now() + verschiebung; }
}
(globalThis as any).Date = TestDate;
console.log(`Testuhr: ${new Date().toISOString()} (Berlin ${wunsch})`);

// Sicherung gegen haengendes Modell (verstehen.ts) im Testsatz aus: eine langsame Antwort soll nicht die
// naechsten Faelle kippen. ausfall-test.ts schaltet sie gezielt ein.
if (!Deno.env.get('KI_SPERRE_MS')) Deno.env.set('KI_SPERRE_MS', '0');
