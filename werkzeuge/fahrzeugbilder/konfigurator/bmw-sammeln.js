// BMW-Konfigurator: 36 Ansichten (360-Grad) je Aussenlack sammeln (13.11.2026, abgelegt 18.11.).
// Im Browser auf https://configure.bmw.de/de_DE/configure/<Baureihe>/ einfuegen (G07 = X7, G70 = 7er, G05 = X5 ...),
// dann window.__bmwSchnell('<modell>', '<zurueck-URL>') aufrufen. Ergebnis landet in localStorage '__bmw2'
// und wird per URL-Anker an den Empfaenger auf 127.0.0.1:5341 geschickt (Konfigurator-CSP blockt fetch).
// Danach JSON nach konfigurator/bmw/<modell>.json, python3 bmw-verarbeiten.py <modell>, katalog-bauen.py.
window.__bmwSchnell = async function (modell, ziel) {
  function* walk(root) { for (const el of root.querySelectorAll('*')) { yield el; if (el.shadowRoot) yield* walk(el.shadowRoot); } }
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  const finde = (p) => { for (const el of walk(document)) if (p(el)) return el; return null; };
  const alle = (p) => { const a = []; for (const el of walk(document)) if (p(el)) a.push(el); return a; };
  const klickbar = (el) => { let e = el; for (let i = 0; i < 6 && e; i++) { if (e.matches?.('button,a,[role=button],[role=tab]')) break; e = e.parentElement || e.getRootNode()?.host; } return e || el; };
  const st = { modell, schritt: 'start', fertig: false, erg: [] }; window.__stand = st;
  try {
    for (let i = 0; i < 30; i++) { await warte(700); if (finde((el) => el.tagName === 'BUTTON' && /VIEW_360/.test(el.getAttribute('aria-label') || ''))) break; }
    await warte(1500);
    const tab = finde((el) => el.children.length <= 1 && el.textContent.trim() === 'Außenfarben');
    if (!tab) { st.schritt = 'Außenfarben fehlt'; return; }
    klickbar(tab).click(); await warte(4000);
    const istLack = (a) => /(metallic|uni|frozen|matt)/i.test(a) && !/(Sonderlackierung|Leder|Akzent|Speiche|Räder|LMR|Polster)/i.test(a);
    const codes = {}; alle((el) => el.tagName === 'CON-SWATCH' && /^P0/.test(el.getAttribute('data-node-code') || '') && istLack(el.getAttribute('data-test-swatch-name') || '')).forEach((el) => { codes[el.getAttribute('data-test-swatch-name')] = el.getAttribute('data-node-code'); });
    const namen = Object.keys(codes); st.namen = namen.length; st.schritt = 'lacke';
    let vorher = null;
    for (const n of namen) {
      if (st.erg.length >= 14) break;
      const sw = finde((el) => el.tagName === 'CON-SWATCH' && el.getAttribute('data-test-swatch-name') === n);
      if (!sw) continue;
      if (!location.href.includes(codes[n])) { sw.click(); for (let i = 0; i < 16 && !location.href.includes(codes[n]); i++) await warte(500); }
      if (!location.href.includes(codes[n])) continue;
      await warte(1500);
      const k = finde((el) => el.tagName === 'BUTTON' && /VIEW_360/.test(el.getAttribute('aria-label') || ''));
      if (!k) continue;
      k.click();
      let liste = null;
      for (let i = 0; i < 30; i++) { await warte(500); const v = finde((el) => el.tagName === 'WEBCOM-360-VIEW-ELEMENT'); const u = v?.__imageUrls; if (u && u.length === 36 && u[0].highResImage !== vorher) { liste = u.map((x) => x.highResImage); break; } }
      if (liste) { vorher = liste[0]; st.erg.push({ name: n, code: codes[n], frames: liste }); }
      const a = JSON.parse(localStorage.getItem('__bmw2') || '{}'); a[modell] = st.erg; localStorage.setItem('__bmw2', JSON.stringify(a));
      const zu = finde((el) => el.tagName === 'BUTTON' && /(close|schließen)/i.test((el.getAttribute('aria-label') || '') + el.textContent) && el.getBoundingClientRect().top < 120);
      if (zu) zu.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await warte(1500);
      const tab2 = finde((el) => el.children.length <= 1 && el.textContent.trim() === 'Außenfarben'); if (tab2) { klickbar(tab2).click(); await warte(1500); }
    }
  } catch (e) { st.schritt = 'Fehler: ' + e.message; }
  finally {
    st.fertig = true;
    if (ziel) location.href = 'http://127.0.0.1:5341/#' + new URLSearchParams({ name: 'bmw2-' + modell + '.json', daten: JSON.stringify(st.erg), zurueck: ziel }).toString();
  }
};
