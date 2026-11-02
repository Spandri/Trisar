// Prueft die fertige Demo (mit eingebauten Ergebnissen): plant jedes Szenario
// in der Oberflaeche, ohne Planer-Server, und meldet Treffer + Statuszeile.
//   node planer-pruefen.js [--nach-tutorial] [--basis=http://127.0.0.1:5311] [--uhr=HH:MM] strategie:starttag:zeitraum ...
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const NACH_TUTORIAL = args.includes('--nach-tutorial');
const BASIS = (args.find((a) => a.startsWith('--basis=')) || `--basis=${process.env.DEMO_URL || 'http://127.0.0.1:5311'}`).slice(8);
const UHR = (args.find((a) => a.startsWith('--uhr=')) || '').slice(6);
const SZENARIEN = args.filter((a) => !a.startsWith('--')).map((a) => {
  const [strategie, starttag, zeitraum] = a.split(':');
  return { strategie, starttag: Number(starttag), zeitraum: Number(zeitraum) };
});
const schlafen = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (text) => console.log(`${new Date().toTimeString().slice(0, 8)} ${text}`);

let meldungen = [];

const zustandSenden = (ziel, detail) => ziel.evaluate((d) => window.dispatchEvent(new CustomEvent('trisar:tutorial-zustand', { detail: d })), detail);

const planen = async (page, ziel, { strategie, starttag, zeitraum }) => {
  meldungen = [];
  await zustandSenden(ziel, { ansicht: 'list' });
  await ziel.waitForSelector('[data-tutorial="dispo-start"]');
  await schlafen(800);
  await zustandSenden(ziel, { reset: true, ansicht: 'kiPlaner' });
  await ziel.waitForSelector(`[data-tutorial="planer-strategie-${strategie}"]`);
  await schlafen(2000);
  await ziel.click(`[data-tutorial="planer-strategie-${strategie}"]`);
  await schlafen(500);
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
  const t0 = Date.now();
  await ziel.click('[data-tutorial="planer-starten"]');
  await schlafen(600);
  await ziel.click(`[data-tutorial="planer-zeitraum-${zeitraum}"]`);
  // Fertig, wenn fuer jeden Tag eine Meldung da ist und die Statuszeile steht.
  let status = '';
  while (Date.now() - t0 < 120000) {
    status = await ziel.evaluate(() => {
      const text = document.body.innerText;
      const zeile = text.split('\n').find((z) => /Solver:/.test(z));
      return zeile || '';
    });
    if (meldungen.length >= zeitraum && status) break;
    await schlafen(500);
  }
  await schlafen(1500);
  status = await ziel.evaluate(() => document.body.innerText.split('\n').filter((z) => /Solver:|Fahrten|Flotte/.test(z)).slice(0, 3).join(' | '));
  const vorschlaege = await ziel.evaluate(() => [...document.querySelectorAll('[data-tutorial^="planer-vorschlag-"]')]
    .filter((e) => /^planer-vorschlag-\d+$/.test(e.getAttribute('data-tutorial'))).length);
  const heuristik = /Heuristik/.test(status);
  log(`${NACH_TUTORIAL ? 'tut-' : ''}${strategie}-t${starttag}-z${zeitraum}: ${heuristik ? 'FEHLER HEURISTIK' : 'ok'} · ${Math.round((Date.now() - t0) / 100) / 10} s · ${vorschlaege} Vorschlaege · ${meldungen.join(' ; ')} · ${status}`);
  return !heuristik && meldungen.length >= zeitraum && meldungen.every((m) => /genau/.test(m));
};

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
  });
  let gut = 0;
  const seiteVorbereiten = async (viewport) => {
    const page = await browser.newPage({ viewport });
    page.setDefaultTimeout(180000);
    if (UHR) {
      // Uhrzeit festsetzen (Datum bleibt heute): die Demo legt die Kolonne auf Laden + 20 min.
      const [h, m] = UHR.split(':').map(Number);
      const zeit = new Date(); zeit.setHours(h, m, 0, 0);
      await page.clock.setFixedTime(zeit);
    }
    page.on('console', (m) => { if (/\[planer\]/.test(m.text())) meldungen.push(m.text().replace(/^\[planer\] /, '')); });
    await page.route('**/planner/solve', (route) => route.abort());
    return page;
  };
  if (NACH_TUTORIAL) {
    const page = await seiteVorbereiten({ width: 1512, height: 895 });
    await page.goto(`${BASIS}/?tutorial=dispo`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => Array.isArray(window.TRISAR_TUTORIAL_DISPO) && window.TRISAR_TUTORIAL_DISPO.length > 0);
    const anzahl = await page.evaluate(() => window.TRISAR_TUTORIAL_DISPO.length);
    const app = () => page.frames().find((f) => f.url().includes('/admin/'));
    await schlafen(3000);
    for (let i = 0; i < anzahl; i += 1) {
      if (i > 0) await page.keyboard.press('ArrowRight');
      const t0 = Date.now();
      let ruhig = null;
      while (Date.now() - t0 < 180000) {
        const unterwegs = await page.evaluate(() => !!document.querySelector('.tut')?.classList.contains('unterwegs'));
        let zeiger = true;
        try {
          zeiger = await app().evaluate(() => {
            const z = [...document.querySelectorAll('div')].find((e) => (e.getAttribute('style') || '').includes('width: 22px') && (e.getAttribute('style') || '').includes('border-radius: 50%'));
            return !!z && getComputedStyle(z).opacity !== '0';
          });
        } catch { /* Wechsel */ }
        if (!unterwegs && !zeiger) {
          if (ruhig === null) ruhig = Date.now();
          if (Date.now() - ruhig > 1500) break;
        } else ruhig = null;
        await schlafen(250);
      }
      if (meldungen.length) log(`  Tutorial ${i + 1}: ${meldungen.splice(0).join(' ; ')}`);
      await schlafen(400);
    }
    await page.click('button[data-ziel="frei"]');
    await schlafen(2500);
    for (const s of SZENARIEN) if (await planen(page, app(), s)) gut += 1; // eslint-disable-line no-await-in-loop
  } else {
    for (const s of SZENARIEN) {
      const page = await seiteVorbereiten({ width: 402, height: 874 }); // eslint-disable-line no-await-in-loop
      await page.goto(`${BASIS}/admin/?nosplash=1`, { waitUntil: 'domcontentloaded', timeout: 120000 }); // eslint-disable-line no-await-in-loop
      await page.waitForSelector('[data-tutorial="dispo-start"]'); // eslint-disable-line no-await-in-loop
      await schlafen(1200); // eslint-disable-line no-await-in-loop
      if (await planen(page, page, s)) gut += 1; // eslint-disable-line no-await-in-loop
      await page.close(); // eslint-disable-line no-await-in-loop
    }
  }
  log(`genau getroffen: ${gut}/${SZENARIEN.length}`);
  await browser.close();
})().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
