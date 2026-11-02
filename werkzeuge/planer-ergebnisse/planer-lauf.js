// Laesst den KI-Planer der Demo-Oberflaeche planen und beantwortet jede
// Planer-Anfrage mit dem echten CP-SAT-Planer (Zwischenspeicher arbeit/cache,
// gerechnet von planer_rechnen.py). Anfrage und Antwort je Szenario speichern.
//
//   node planer-lauf.js [--nach-tutorial] strategie:starttag:zeitraum ...
//
//   --nach-tutorial  erst das Dispo-Tutorial komplett durchlaufen (es legt
//                    Fahrten an), dann "Disposition frei erkunden" und planen
//   WARTESCHLANGE=1  fehlende Antworten nicht rechnen, sondern die Anfrage in
//                    ZIELORDNER (Standard arbeit/queue) ablegen
//   DEMO_URL         lokal ausgelieferte Demo (Standard http://127.0.0.1:5311)
//   PLANER_PYTHON    Python mit den Planer-Paketen (Standard python3)
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HIER = __dirname;
const PROGRAMM = path.resolve(HIER, '..', '..', '..');
const ARBEIT = process.env.PLANER_ARBEIT || path.join(HIER, 'arbeit');
const BASIS = process.env.DEMO_URL || 'http://127.0.0.1:5311';
const PYTHON = process.env.PLANER_PYTHON || 'python3';
const JOBS = path.join(PROGRAMM, 'demo-vorschau', 'admin-app-demo', 'src', 'demo', 'data', 'jobs.json');
const CACHE = path.join(ARBEIT, 'cache');
const ANFRAGEN = path.join(ARBEIT, 'anfragen');
const SZENARIEN = path.join(ARBEIT, 'szenarien');
const ZIELORDNER = path.resolve(ARBEIT, process.env.ZIELORDNER || 'queue');
[CACHE, ANFRAGEN, SZENARIEN, ZIELORDNER].forEach((o) => fs.mkdirSync(o, { recursive: true }));

const args = process.argv.slice(2);
const NACH_TUTORIAL = args.includes('--nach-tutorial');
const AUFTRAEGE = args.filter((a) => !a.startsWith('--')).map((a) => {
  const [strategie, starttag, zeitraum] = a.split(':');
  return { strategie, starttag: Number(starttag), zeitraum: Number(zeitraum) };
});
const PRAEFIX = NACH_TUTORIAL ? 'tut-' : '';

const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (text) => console.log(`${new Date().toTimeString().slice(0, 8)} ${text}`);
const isoTag = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HEUTE = isoTag(new Date());
const SEED = new Set(JSON.parse(fs.readFileSync(JOBS, 'utf8')).map((j) => String(j.id)));

// In der Demo angelegte Fahrten haben zufaellige IDs — sie zaehlen ueber ihren Inhalt.
const neuMerkmal = (r) => JSON.stringify([r.ride_date, r.etd, r.status, r.pickup_name, r.pickup_address, r.dropoff_name, r.dropoff_address]);
const istNeu = (r) => !SEED.has(String(r?.id));

// Fuer reine Demo-Fahrten identisch mit dem bisherigen Schluessel.
const schluesselVon = (a) => {
  const tag = Math.round((new Date(`${a.serviceDate}T12:00:00`) - new Date(`${HEUTE}T12:00:00`)) / 86400000);
  const ruhe = (a.drivers || []).map((d) => [d.id, d.earliest_start_minute ?? null, d.latest_end_minute ?? null]);
  const fahrten = (a.rides || []).map((r) => [istNeu(r) ? `neu:${neuMerkmal(r)}` : r.id, r.etd, r.status]).sort();
  return crypto.createHash('sha1').update(JSON.stringify({ tag, s: a.settings, ruhe, fahrten, bedarf: a.demandProfile })).digest('hex');
};

// Antwort aus dem Zwischenspeicher auf die IDs der aktuellen Anfrage umschreiben.
const idsUebertragen = (antwort, alteAnfrage, anfrage) => {
  if (!alteAnfrage) return antwort;
  const alt = new Map((alteAnfrage.rides || []).filter(istNeu).map((r) => [String(r.id), neuMerkmal(r)]));
  if (!alt.size) return antwort;
  const frei = new Map();
  (anfrage.rides || []).filter(istNeu).forEach((r) => {
    const m = neuMerkmal(r);
    frei.set(m, [...(frei.get(m) || []), String(r.id)]);
  });
  const ersetzen = (id) => (alt.has(String(id)) ? ((frei.get(alt.get(String(id))) || []).shift() || id) : id);
  (antwort.suggestions || []).forEach((v) => { v.assigned_ride_ids = (v.assigned_ride_ids || []).map(ersetzen); });
  antwort.unassigned_ride_ids = (antwort.unassigned_ride_ids || []).map(ersetzen);
  return antwort;
};

let lauf = null; // Zustand des laufenden Szenarios

const weiterleitungEinrichten = async (page) => {
  // Eine gebaute Demo enthaelt schon Ergebnisse — beim Erfassen ausblenden,
  // sonst gehen keine Anfragen an den Planer.
  const leer = (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: 'export default {"eintraege":[]};' });
  await page.route(/planer-ergebnisse-[^/]*\.js(\?.*)?$/, leer);
  await page.route(/planer-ergebnisse\.json(\?.*)?$/, leer);
  await page.route('**/planner/solve', async (route) => {
    const zustand = lauf || { paare: [], offen: 0, wartet: 0, name: 'ohne Szenario' };
    zustand.offen += 1;
    const anfrage = JSON.parse(route.request().postData() || '{}');
    try {
      const schluessel = schluesselVon(anfrage);
      const cacheDatei = path.join(CACHE, `${schluessel}.json`);
      const anfrageDatei = path.join(ANFRAGEN, `${schluessel}.json`);
      const info = `${schluessel.slice(0, 10)}, Fahrten ${anfrage.rides?.length} (neu ${(anfrage.rides || []).filter(istNeu).length}), Ruhefenster ${(anfrage.drivers || []).filter((d) => d.earliest_start_minute != null || d.latest_end_minute != null).length}`;
      if (fs.existsSync(cacheDatei)) {
        const alt = fs.existsSync(anfrageDatei) ? JSON.parse(fs.readFileSync(anfrageDatei, 'utf8')) : null;
        const antwort = idsUebertragen(JSON.parse(fs.readFileSync(cacheDatei, 'utf8')), alt, anfrage);
        log(`  [${zustand.name}] Tag ${anfrage.serviceDate}: aus Zwischenspeicher (${info})`);
        zustand.paare.push({ anfrage, antwort });
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(antwort) });
        return;
      }
      // Folgetag mit Ruhezeiten: exakt aus dem Einzeltag ableiten, wenn der
      // schon gerechnet ist (gleichwertige Fahrer tauschen, siehe planer_ableiten.py).
      const mitRuhe = (anfrage.drivers || []).some((d) => d.earliest_start_minute != null || d.latest_end_minute != null);
      if (mitRuhe && zustand.wartet === 0) {
        const allein = {
          ...anfrage,
          drivers: (anfrage.drivers || []).map(({ earliest_start_minute: _f, latest_end_minute: _s, ...rest }) => rest),
        };
        const alleinSchluessel = schluesselVon(allein);
        const alleinCache = path.join(CACHE, `${alleinSchluessel}.json`);
        if (fs.existsSync(alleinCache)) {
          const alleinAnfrageDatei = path.join(ANFRAGEN, `${alleinSchluessel}.json`);
          const alleinAntwort = idsUebertragen(
            JSON.parse(fs.readFileSync(alleinCache, 'utf8')),
            fs.existsSync(alleinAnfrageDatei) ? JSON.parse(fs.readFileSync(alleinAnfrageDatei, 'utf8')) : null,
            anfrage,
          );
          const tmp = path.join(ARBEIT, 'tmp');
          fs.mkdirSync(tmp, { recursive: true });
          const dateiAnfrage = path.join(tmp, `${schluessel}.anfrage.json`);
          const dateiAllein = path.join(tmp, `${schluessel}.allein.json`);
          const dateiAus = path.join(tmp, `${schluessel}.abgeleitet.json`);
          fs.writeFileSync(dateiAnfrage, JSON.stringify(anfrage));
          fs.writeFileSync(dateiAllein, JSON.stringify(alleinAntwort));
          const ableitung = spawnSync(PYTHON, [path.join(HIER, 'planer_ableiten.py'), dateiAnfrage, dateiAllein, dateiAus], { encoding: 'utf8', timeout: 300000 });
          const meldung = `${ableitung.stdout || ''}${ableitung.stderr || ''}`.trim().split('\n').pop();
          if (ableitung.status === 0) {
            const antwort = JSON.parse(fs.readFileSync(dateiAus, 'utf8'));
            fs.writeFileSync(cacheDatei, JSON.stringify(antwort));
            fs.writeFileSync(anfrageDatei, JSON.stringify(anfrage));
            fs.writeFileSync(path.join(CACHE, `${schluessel}.abgeleitet`), `${alleinSchluessel}\n${meldung}\n`);
            log(`  [${zustand.name}] Tag ${anfrage.serviceDate}: abgeleitet aus ${alleinSchluessel.slice(0, 10)} — ${meldung} (${info})`);
            zustand.paare.push({ anfrage, antwort, abgeleitetVon: alleinSchluessel });
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(antwort) });
            return;
          }
          log(`  [${zustand.name}] Tag ${anfrage.serviceDate}: nicht ableitbar — ${meldung}`);
        }
      }
      // Nur die erste offene Anfrage eines Laufs ist gueltig — spaetere Tage
      // bauten sonst auf dem Heuristik-Ersatz des Vortags auf.
      if (zustand.wartet === 0 && lauf) {
        if (!fs.existsSync(anfrageDatei)) fs.writeFileSync(anfrageDatei, JSON.stringify(anfrage));
        const ziel = path.join(ZIELORDNER, `${schluessel}.json`);
        if (!fs.existsSync(ziel)) fs.writeFileSync(ziel, JSON.stringify(anfrage));
        log(`  [${zustand.name}] Tag ${anfrage.serviceDate}: in Warteschlange (${info})`);
      } else {
        log(`  [${zustand.name}] Tag ${anfrage.serviceDate}: fehlt, baut auf Ersatz auf — verworfen (${info})`);
      }
      zustand.wartet += 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"wartet auf Rechnung"}' });
    } catch (fehler) {
      log(`  FEHLER ${fehler.message}`);
      await route.abort();
    } finally {
      zustand.offen -= 1;
    }
  });
};

const zustandSenden = (ziel, detail) => ziel.evaluate((d) => window.dispatchEvent(new CustomEvent('trisar:tutorial-zustand', { detail: d })), detail);

const planen = async (page, ziel, szenario) => {
  const { strategie, starttag, zeitraum } = szenario;
  const name = `${PRAEFIX}${strategie}-t${starttag}-z${zeitraum}`;
  lauf = { paare: [], offen: 0, wartet: 0, name };
  await zustandSenden(ziel, { ansicht: 'list' });
  await ziel.waitForSelector('[data-tutorial="dispo-start"]');
  await schlafen(800);
  await zustandSenden(ziel, { reset: true, ansicht: 'kiPlaner' });
  await ziel.waitForSelector(`[data-tutorial="planer-strategie-${strategie}"]`);
  await schlafen(2500);
  await ziel.click(`[data-tutorial="planer-strategie-${strategie}"]`);
  await schlafen(600);

  // Auf den Starttag wischen (ein Tag je Wischer).
  for (let i = 0; i < starttag; i += 1) {
    const box = await (await ziel.$('[data-tutorial="planer-wischflaeche"]')).boundingBox();
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.8, y);
    await page.mouse.down();
    for (let s = 1; s <= 12; s += 1) {
      await page.mouse.move(box.x + box.width * 0.8 - (s * 16 * box.width) / 402, y);
      await schlafen(16);
    }
    await page.mouse.up();
    await schlafen(700);
  }

  await ziel.click('[data-tutorial="planer-starten"]');
  await schlafen(700);
  await ziel.click(`[data-tutorial="planer-zeitraum-${zeitraum}"]`);

  const t0 = Date.now();
  while (Date.now() - t0 < 30 * 60 * 1000) {
    if (lauf.paare.length + lauf.wartet >= zeitraum && lauf.offen === 0) break;
    if (lauf.wartet > 0 && lauf.offen === 0 && Date.now() - t0 > 8000) break;
    await schlafen(1000);
  }
  const ergebnis = lauf;
  lauf = null;
  if (ergebnis.wartet > 0) {
    log(`${name}: unvollstaendig (${ergebnis.paare.length} aus Zwischenspeicher, ${ergebnis.wartet} fehlen) — keine Szenario-Datei`);
    return false;
  }
  await schlafen(1500);
  const sichtbar = await ziel.evaluate(() => [...document.querySelectorAll('[data-tutorial^="planer-vorschlag-"]')]
    .filter((e) => /^planer-vorschlag-\d+$/.test(e.getAttribute('data-tutorial'))).length);
  const datei = path.join(SZENARIEN, `${name}.json`);
  fs.writeFileSync(datei, JSON.stringify({
    strategie, starttag, zeitraum, nachTutorial: NACH_TUTORIAL, heute: HEUTE, erfasst: new Date().toISOString(), paare: ergebnis.paare, sichtbareVorschlaege: sichtbar,
  }));
  log(`${name}: fertig, ${ergebnis.paare.length} Tage, ${sichtbar} Vorschlaege sichtbar`);
  return true;
};

// Dispo-Tutorial Schritt fuer Schritt bis zum Ende, dann frei erkunden.
const tutorialDurchlaufen = async (page) => {
  await page.goto(`${BASIS}/?tutorial=dispo`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => Array.isArray(window.TRISAR_TUTORIAL_DISPO) && window.TRISAR_TUTORIAL_DISPO.length > 0, null, { timeout: 120000 });
  const anzahl = await page.evaluate(() => window.TRISAR_TUTORIAL_DISPO.length);
  const app = () => page.frames().find((f) => f.url().includes('/admin/'));
  const unterwegs = () => page.evaluate(() => !!document.querySelector('.tut')?.classList.contains('unterwegs'));
  const zeigerSichtbar = async () => {
    try {
      return await app().evaluate(() => {
        const z = [...document.querySelectorAll('div')].find((e) => {
          const s = e.getAttribute('style') || '';
          return s.includes('width: 22px') && s.includes('border-radius: 50%');
        });
        return !!z && getComputedStyle(z).opacity !== '0';
      });
    } catch { return true; }
  };
  const warteSchritt = async () => {
    const t0 = Date.now();
    let ruhig = null;
    while (Date.now() - t0 < 180000) {
      if (!(await unterwegs()) && !(await zeigerSichtbar())) {
        if (ruhig === null) ruhig = Date.now();
        if (Date.now() - ruhig > 1500) return Date.now() - t0;
      } else {
        ruhig = null;
      }
      await schlafen(250);
    }
    return 'timeout';
  };
  await schlafen(3000);
  lauf = null;
  for (let i = 0; i < anzahl; i += 1) {
    if (i > 0) await page.keyboard.press('ArrowRight');
    const dauer = await warteSchritt();
    const kat = await page.evaluate((n) => { const s = window.TRISAR_TUTORIAL_DISPO[n]; return s.kategorie || s.kategorieLinks; }, i);
    log(`  Tutorial ${i + 1}/${anzahl} ${kat}: ${dauer === 'timeout' ? 'ZEITUEBERSCHREITUNG' : `${Math.round(dauer / 100) / 10} s`}`);
    await schlafen(400);
  }
  await page.click('button[data-ziel="frei"]');
  await schlafen(2500);
  return app();
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: NACH_TUTORIAL ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] : [],
  });
  let fertig = 0;
  if (NACH_TUTORIAL) {
    const page = await browser.newPage({ viewport: { width: 1512, height: 895 } });
    page.setDefaultTimeout(180000);
    page.on('dialog', (d) => d.dismiss());
    await weiterleitungEinrichten(page);
    const ziel = await tutorialDurchlaufen(page);
    for (const szenario of AUFTRAEGE) {
      // eslint-disable-next-line no-await-in-loop
      if (await planen(page, ziel, szenario)) fertig += 1;
    }
  } else {
    for (const szenario of AUFTRAEGE) {
      // Jedes Szenario in frischer Seite: gleiche Ausgangsdaten wie beim Besucher.
      const page = await browser.newPage({ viewport: { width: 402, height: 874 } });
      page.setDefaultTimeout(180000);
      await weiterleitungEinrichten(page);
      await page.goto(`${BASIS}/admin/?nosplash=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForSelector('[data-tutorial="dispo-start"]');
      await schlafen(1500);
      if (await planen(page, page, szenario)) fertig += 1;
      await page.close();
    }
  }
  log(`Szenarien fertig: ${fertig}/${AUFTRAEGE.length}`);
  await browser.close();
})().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
