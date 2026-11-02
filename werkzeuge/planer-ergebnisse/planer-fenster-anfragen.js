// Sammelt die eindeutigen Planer-Anfragen (Fahrten je Tag/Einstellung, Fahrer je
// Einstellung), fuer die planer_fenster.py die exakten Zulaessigkeitsgrenzen je
// Fahrt und die wirksamen Fahrerprofile rechnet.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DEMO = path.resolve(__dirname, '..', '..', 'admin-app-demo', 'src', 'demo');
const ARBEIT = process.env.PLANER_ARBEIT || path.join(__dirname, 'arbeit');
const ORDNER = path.join(ARBEIT, 'szenarien');

(async () => {
  const k = await import(pathToFileURL(path.join(DEMO, 'planerSchluessel.js')).href);
  const dateien = fs.readdirSync(ORDNER).filter((n) => /^(tut-)?[a-z]+-t\d-z\d\.json$/.test(n)).sort();
  const fahrten = new Map();
  const fahrer = new Map();
  for (const name of dateien) {
    const d = JSON.parse(fs.readFileSync(path.join(ORDNER, name), 'utf8'));
    const heute = d.heute || k.isoTag(new Date(d.erfasst));
    for (const { anfrage } of d.paare || []) {
      const s = k.anfrageSchluessel({ tag: k.tagAbstand(anfrage.serviceDate, heute), settings: anfrage.settings, drivers: anfrage.drivers, rides: anfrage.rides, vehicles: anfrage.vehicles });
      const fk = `${s.tag}|${s.einstellungen}|${s.fahrten}`;
      if (!fahrten.has(fk)) fahrten.set(fk, anfrage);
      const pk = `${s.einstellungen}|${s.fahrer}`;
      if (!fahrer.has(pk)) fahrer.set(pk, anfrage);
    }
  }
  const aus = fs.createWriteStream((fs.mkdirSync(path.join(ARBEIT, 'fenster'), { recursive: true }), path.join(ARBEIT, 'fenster', 'anfragen.jsonl')));
  fahrten.forEach((anfrage, kennung) => aus.write(`${JSON.stringify({ art: 'fahrten', kennung, anfrage })}\n`));
  fahrer.forEach((anfrage, kennung) => aus.write(`${JSON.stringify({ art: 'fahrer', kennung, anfrage })}\n`));
  aus.end(() => console.log(`${fahrten.size} Fahrten-Kennungen, ${fahrer.size} Fahrer-Kennungen`));
})();
