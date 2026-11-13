// Im Browser auf .../car-configurator.html/start/CCci/DE/de/tc/<Baureihe> ausfuehren (Mercedes-Pkw-Konfigurator).
// Startet eine neue Konfiguration, geht zu "Farben" und klickt jeden Lack an. Je Lack wird die Bildadresse
// (iris.webp, transparent, POV als Platzhalter) gemerkt: localStorage.__mb[<modell>] = [{name, lu, url}].
// Aufruf: await __mbModell('<modell-id>')   Stand: window.__stand
window.__mbModell = async function (modell) {
  function* walk(root) { for (const el of root.querySelectorAll('*')) { yield el; if (el.shadowRoot) yield* walk(el.shadowRoot); } }
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const finde = (pruef) => { for (const el of walk(document)) if (pruef(el)) return el; return null; };
  window.__stand = { modell, schritt: 'start', fertig: false, erg: [] };
  // 1. Neue Konfiguration starten
  let knopf = null;
  for (let i = 0; i < 20 && !knopf; i++) { await warte(700); const karte = finde((el) => el.tagName === 'WB7-CARD' && /Neue Konfiguration/.test(el.textContent)); knopf = karte && finde.call(null, () => false); if (karte) knopf = [...karte.querySelectorAll('wb7-button')][0]; }
  if (knopf) { (knopf.shadowRoot?.querySelector('button') || knopf).click(); }
  // 2. Farben
  window.__stand.schritt = 'farben';
  let farben = null;
  for (let i = 0; i < 30 && !farben; i++) { await warte(700); farben = finde((el) => el.tagName === 'A' && el.textContent.trim() === 'Farben'); }
  if (!farben) { window.__stand.schritt = 'Farben nicht gefunden'; window.__stand.fertig = true; return; }
  farben.click();
  let namen = [];
  for (let i = 0; i < 30 && namen.length === 0; i++) {
    await warte(700);
    for (const el of walk(document)) { if (el.tagName === 'IMG') { const a = el.getAttribute('alt') || ''; if (/metallic|\buni\b|bright|magno|MANUFAKTUR/i.test(a) && !namen.includes(a)) namen.push(a); } }
  }
  window.__stand.schritt = 'lacke'; window.__stand.namen = namen.length;
  // 3. Jeden Lack anklicken
  for (const n of namen) {
    const img = finde((el) => el.tagName === 'IMG' && el.getAttribute('alt') === n);
    let e = img; for (let i = 0; i < 8 && e; i++) { if (e.matches?.('button,a,[role=button],[role=radio],label,input')) break; e = e.parentElement || e.getRootNode()?.host; }
    performance.clearResourceTimings();
    (e || img).click();
    let url = null;
    for (let i = 0; i < 20 && !url; i++) { await warte(700); url = performance.getEntriesByType('resource').map((x) => x.name).find((u) => /iris\.webp/.test(u) && /POV=BE/.test(u)); }
    const lu = (location.href.match(/_LU-([A-Z0-9]+)/) || [])[1];
    window.__stand.erg.push({ name: n, lu, url: url ? url.replace(/POV=BE\d+/, 'POV={POV}').replace(/&imwidth=\d+/, '') : null });
  }
  // Der zu Beginn gewaehlte Lack laedt beim Anklicken nichts neu: einmal anderen, dann ihn nochmal
  const fehlt = window.__stand.erg.filter((x) => !x.url);
  for (const f of fehlt) {
    const andere = window.__stand.erg.find((x) => x.url);
    for (const n of [andere?.name, f.name]) {
      const img = finde((el) => el.tagName === 'IMG' && el.getAttribute('alt') === n);
      let e = img; for (let i = 0; i < 8 && e; i++) { if (e.matches?.('button,a,[role=button],[role=radio],label,input')) break; e = e.parentElement || e.getRootNode()?.host; }
      performance.clearResourceTimings(); (e || img).click();
      let url = null; for (let i = 0; i < 20 && !url; i++) { await warte(700); url = performance.getEntriesByType('resource').map((x) => x.name).find((u) => /iris\.webp/.test(u) && /POV=BE/.test(u)); }
      if (n === f.name && url) { f.url = url.replace(/POV=BE\d+/, 'POV={POV}').replace(/&imwidth=\d+/, ''); f.lu = (location.href.match(/_LU-([A-Z0-9]+)/) || [])[1]; }
    }
  }
  const alle = JSON.parse(localStorage.getItem('__mb') || '{}'); alle[modell] = window.__stand.erg; localStorage.setItem('__mb', JSON.stringify(alle));
  window.__stand.fertig = true;
};
