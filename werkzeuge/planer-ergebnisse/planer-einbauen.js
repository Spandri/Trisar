// Uebernimmt die mit dem echten CP-SAT-Planer gerechneten Szenarien in die
// Demo-Daten (admin-app-demo/src/demo/data/planer-ergebnisse.json).
// Schluessel kommen aus admin-app-demo/src/demo/planerSchluessel.js — dieselbe
// Funktion, mit der die Demo zur Laufzeit sucht.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const DEMO = path.resolve(__dirname, '..', '..', 'admin-app-demo', 'src', 'demo');
const ARBEIT = process.env.PLANER_ARBEIT || path.join(__dirname, 'arbeit');
const ZIEL = path.join(DEMO, 'data', 'planer-ergebnisse.json');
const ZIEL_HEUTE = path.join(DEMO, 'data', 'planer-ergebnisse-heute.json');
const ORDNER = path.join(ARBEIT, 'szenarien');

(async () => {
  const k = await import(pathToFileURL(path.join(DEMO, 'planerSchluessel.js')).href);
  const seed = new Set(JSON.parse(fs.readFileSync(path.join(DEMO, 'data', 'jobs.json'), 'utf8')).map((j) => String(j.id)));
  const dateien = fs.readdirSync(ORDNER).filter((n) => /^(tut-)?[a-z]+-t\d-z\d\.json$/.test(n)).sort();

  const eintraege = new Map();
  let paareGesamt = 0;
  let abgeleitet = 0;
  const probleme = [];
  for (const name of dateien) {
    const d = JSON.parse(fs.readFileSync(path.join(ORDNER, name), 'utf8'));
    const heute = d.heute || k.isoTag(new Date(d.erfasst));
    for (const { anfrage, antwort, abgeleitetVon } of d.paare || []) {
      paareGesamt += 1;
      if (antwort?.source !== 'cp_sat') { probleme.push(`${name} ${anfrage.serviceDate}: keine CP-SAT-Antwort`); continue; }
      const ids = new Set((anfrage.rides || []).map((r) => String(r.id)));
      const inAntwort = [
        ...(antwort.suggestions || []).flatMap((v) => v.assigned_ride_ids || []),
        ...(antwort.unassigned_ride_ids || []),
      ].map(String);
      const fremd = inAntwort.filter((id) => !ids.has(id));
      if (fremd.length || inAntwort.length !== ids.size) {
        probleme.push(`${name} ${anfrage.serviceDate}: Fahrt-IDs passen nicht (${fremd.length} fremd, ${inAntwort.length}/${ids.size})`);
        continue;
      }
      const schluessel = k.anfrageSchluessel({
        tag: k.tagAbstand(anfrage.serviceDate, heute),
        settings: anfrage.settings,
        drivers: anfrage.drivers,
        rides: anfrage.rides,
        vehicles: anfrage.vehicles,
      });
      // In der Demo angelegte Fahrten: Inhalt merken, um sie zur Laufzeit zuzuordnen.
      const neueFahrten = {};
      (anfrage.rides || []).forEach((r) => {
        if (!seed.has(String(r.id))) neueFahrten[String(r.id)] = k.fahrtMerkmalHash(r);
      });
      if (schluessel.tag === 0) continue; // Heute: eigene Datei mit allen Kolonnen-Lagen
      const kennung = [schluessel.tag, schluessel.einstellungen, schluessel.fahrer, schluessel.ruhe, schluessel.fahrten, schluessel.fahrzeuge].join('#');
      if (eintraege.has(kennung)) continue;
      if (abgeleitetVon) abgeleitet += 1;
      const eintrag = { ...schluessel, antwort };
      if (Object.keys(neueFahrten).length) eintrag.neueFahrten = neueFahrten;
      eintraege.set(kennung, eintrag);
    }
  }

  // Exakte Grenzen je Fahrt und Fahrerprofile (planer_fenster.py) fuer die Laufzeit-Anpassung.
  const fenster = JSON.parse(fs.readFileSync(path.join(ARBEIT, 'fenster', 'ergebnis.json'), 'utf8'));

  // Heute: jede 5-Minuten-Lage der Kolonnenfahrt (planer_heute.py).
  const leseZeilen = (datei) => fs.readFileSync(datei, 'utf8').split('\n').filter(Boolean).map((z) => JSON.parse(z));
  const heuteAnfragen = leseZeilen(path.join(ARBEIT, 'heute', 'anfragen.jsonl'));
  const heuteAntworten = new Map(leseZeilen(path.join(ARBEIT, 'heute', 'antworten.jsonl')).map((z) => [z.name, z.antwort]));
  const antworten = [];
  const antwortIndex = new Map();
  const gruppen = new Map();
  heuteAnfragen.forEach(({ name, heute, erfasst, anfrage }) => {
    const antwort = heuteAntworten.get(name);
    if (antwort?.source !== 'cp_sat') { probleme.push(`Heute ${name}: keine CP-SAT-Antwort`); return; }
    const s = k.anfrageSchluessel({ tag: k.tagAbstand(anfrage.serviceDate, heute || k.isoTag(new Date(erfasst))), settings: anfrage.settings, drivers: anfrage.drivers, rides: anfrage.rides, vehicles: anfrage.vehicles });
    if (s.tag !== 0) { probleme.push(`Heute ${name}: Tag ${s.tag}`); return; }
    const neueFahrten = {};
    (anfrage.rides || []).forEach((r) => { if (!seed.has(String(r.id))) neueFahrten[String(r.id)] = k.fahrtMerkmalHash(r); });
    const gruppenKennung = [s.einstellungen, s.fahrer, s.ruhe, s.fahrzeuge, JSON.stringify(neueFahrten)].join('#');
    if (!gruppen.has(gruppenKennung)) {
      gruppen.set(gruppenKennung, { einstellungen: s.einstellungen, fahrer: s.fahrer, ruhe: s.ruhe, fahrzeuge: s.fahrzeuge, ...(Object.keys(neueFahrten).length ? { neueFahrten } : {}), varianten: {} });
    }
    const text = JSON.stringify(antwort);
    if (!antwortIndex.has(text)) { antwortIndex.set(text, antworten.length); antworten.push(antwort); }
    const gruppe = gruppen.get(gruppenKennung);
    if (gruppe.varianten[s.fahrten] != null && gruppe.varianten[s.fahrten] !== antwortIndex.get(text)) probleme.push(`Heute ${name}: Fingerabdruck doppelt`);
    gruppe.varianten[s.fahrten] = antwortIndex.get(text);
  });
  fs.writeFileSync(ZIEL_HEUTE, JSON.stringify({ planer: 'cp_sat', erstellt: new Date().toISOString(), gruppen: [...gruppen.values()], antworten }));
  console.log(`Heute: ${heuteAnfragen.length} Kolonnen-Lagen in ${gruppen.size} Gruppen, ${antworten.length} verschiedene Antworten → ${Math.round(fs.statSync(ZIEL_HEUTE).size / 1024)} KB`);

  const ausgabe = {
    planer: 'cp_sat',
    quelle: 'admin-app-lokal/optimizer (KI-Korridor + OR-Tools CP-SAT), mit den Anfragen der Demo-Oberflaeche gerechnet',
    erstellt: new Date().toISOString(),
    eintraege: [...eintraege.values()],
    fahrtFenster: fenster.fahrtFenster,
    fahrerProfile: fenster.fahrerProfile,
  };
  fs.writeFileSync(ZIEL, JSON.stringify(ausgabe));
  console.log(`${dateien.length} Szenario-Dateien, ${paareGesamt} Planungstage, ${ausgabe.eintraege.length} eindeutige Ergebnisse (${abgeleitet} Folgetage exakt abgeleitet) → ${Math.round(fs.statSync(ZIEL).size / 1024)} KB`);
  probleme.forEach((p) => console.log('  PROBLEM', p));
  ausgabe.eintraege.forEach((e) => {
    const s = JSON.parse(e.einstellungen);
    const kp = e.antwort.kpis || {};
    console.log(`  Tag ${e.tag} · ${s[0]} · Ruhe ${e.ruhe === k.OHNE_RUHEZEITEN ? 'nein' : 'ja '} · neu ${Object.keys(e.neueFahrten || {}).length} · Dienste ${e.antwort.suggestions.length} · offen ${e.antwort.unassigned_ride_ids.length} · Guete ${kp.optimality_gap} ${kp.solver_status}`);
  });
})().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
