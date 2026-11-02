// Erzeugt die Heute-Anfragen fuer jede 5-Minuten-Lage der Kolonnenfahrt.
// demoClient.js legt die Beispiel-Kolonne (Summit-Delegation) auf "Laden + 20 min",
// aufgerundet auf 5 Minuten. Alles andere an der Anfrage bleibt wie erfasst.
const fs = require('fs');
const path = require('path');

const DEMO = path.resolve(__dirname, '..', '..', 'admin-app-demo', 'src', 'demo');
const ARBEIT = process.env.PLANER_ARBEIT || path.join(__dirname, 'arbeit');
const KOLONNE = '4ce042be-fe4e-5551-af45-60feb881d279';
const distanzen = JSON.parse(fs.readFileSync(path.join(DEMO, 'data', 'distances.json'), 'utf8'));
const verkehr = JSON.parse(fs.readFileSync(path.join(DEMO, 'data', 'traffic_factors.json'), 'utf8'));

// Wie echteFahrzeit() in services/kiDriverPlanner.js.
const echteFahrzeit = (ride) => {
  const von = String(ride?.pickup_name || ride?.pickup_address || '').trim();
  const nach = String(ride?.dropoff_name || ride?.dropoff_address || '').trim();
  if (!von || !nach) return null;
  const tabelle = distanzen?.minuten || {};
  const basis = tabelle[`${von}|${nach}`] ?? tabelle[`${nach}|${von}`];
  if (!Number.isFinite(Number(basis))) return null;
  const stunde = Number(String(ride?.etd || '').slice(0, 2));
  const faktor = Number(verkehr?.stundenFaktor?.[stunde]) || 1;
  return Math.max(5, Math.round(Number(basis) * faktor));
};

const aus = fs.createWriteStream((fs.mkdirSync(path.join(ARBEIT, 'heute'), { recursive: true }), path.join(ARBEIT, 'heute', 'anfragen.jsonl')));
let anzahl = 0;
for (const zustand of ['', 'tut-']) {
  for (const strategie of ['ausgewogen', 'effizient', 'konservativ']) {
    const datei = JSON.parse(fs.readFileSync(path.join(ARBEIT, 'szenarien', `${zustand}${strategie}-t0-z1.json`), 'utf8'));
    const basis = datei.paare[0].anfrage;
    if (!basis.rides.some((r) => r.id === KOLONNE)) throw new Error(`Kolonnenfahrt fehlt in ${zustand}${strategie}`);
    for (let minute = 0; minute < 24 * 60; minute += 5) {
      const etd = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`;
      const rides = basis.rides.map((r) => {
        if (r.id !== KOLONNE) return r;
        const neu = { ...r, etd };
        if ('original_etd' in r) neu.original_etd = etd;
        const minuten = echteFahrzeit(neu);
        if (minuten != null) neu.duration_minutes = minuten;
        return neu;
      });
      aus.write(`${JSON.stringify({ name: `${zustand}${strategie}@${etd.slice(0, 5)}`, heute: datei.heute || null, erfasst: datei.erfasst, anfrage: { ...basis, rides } })}\n`);
      anzahl += 1;
    }
  }
}
aus.end(() => console.log(`${anzahl} Anfragen`));
