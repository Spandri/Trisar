// /protokoll: Besucherprotokoll von demo.trisar.de, nur fuer den Betreiber.
// Passwort als Geheimnis der Pages-Seite (PROTOKOLL_PASSWORT), Abfrage per
// Browser-Anmeldung. Nach der Anmeldung setzt die Seite ein Cookie, damit die
// eigenen Aufrufe nicht mehr im Protokoll landen.
// Beweissicherung: /protokoll?id=N zeigt alle Rohdaten eines Besuchs,
// /protokoll?export=csv bzw. ?export=json laedt alles mit SHA-256-Pruefsumme herunter.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (z) => ESC[z]);

const LAENDER = new Intl.DisplayNames(['de'], { type: 'region' });
const land = (code) => { try { return code ? LAENDER.of(code) : ''; } catch { return code; } };

const tagText = (t) => new Date(t).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
const uhrText = (t) => new Date(t).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' });

const herkunftText = (e) => {
  if (e.quelle) return e.quelle;
  if (!e.herkunft) return 'direkt / Link';
  try {
    const host = new URL(e.herkunft).hostname.replace(/^www\./, '');
    return host.endsWith('trisar.de') ? 'innerhalb der Seite' : host;
  } catch { return e.herkunft; }
};

// Mensch oder Programm: KI-Abrufer nennen sich selbst. Lief die Seite im Browser
// (Rueckmeldung aus dem Skript), war es ein Mensch oder ein KI-Agent im Browser.
const werText = (e) => {
  if (e.eigen) return `<span class="marke">du</span> ${e.js ? '<span class="mensch">im Browser</span>' : ''}`;
  if (e.art === 'ki') return `<span class="marke ki">KI · ${esc(e.ki || 'unbekannt')}</span>`;
  if (e.art === 'vorschau' || e.art === 'bot') return '<span class="klein">Programm</span>';
  return e.js ? '<span class="mensch">im Browser</span>' : '<span class="klein">nur abgerufen</span>';
};

// Verweildauer: sichtbare Zeit im Tab. "laeuft", solange das letzte Lebenszeichen frisch ist.
const dauerText = (e, jetzt) => {
  if (e.aktiv_s == null) return '<span class="klein">–</span>';
  const s = e.aktiv_s;
  const text = s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  return e.zuletzt && jetzt - e.zuletzt < 40000 ? `<span class="mensch">${text} · läuft</span>` : esc(text);
};

const seiteText = (pfad) => ({ '/': 'Startseite', '/index.html': 'Startseite', '/viewer.html': 'Startseite (Rahmen)' })[pfad]
  || (pfad.startsWith('/admin') ? 'Dispo-App direkt' : pfad.startsWith('/fahrer') ? 'Fahrer-App direkt' : pfad);

const sicherGleich = (a, b) => {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i += 1) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
};

const angemeldet = (request, passwort) => {
  const kopf = request.headers.get('authorization') || '';
  if (!kopf.startsWith('Basic ')) return false;
  try {
    const [, pw] = atob(kopf.slice(6)).split(/:(.*)/s);
    return sicherGleich(pw || '', passwort);
  } catch { return false; }
};

async function alleEintraege(db) {
  const { results } = await db.prepare('SELECT id, t, art, daten, js, aktiv_s, zuletzt FROM besuche ORDER BY t DESC LIMIT 5000').all();
  return results.map((z) => ({
    ...JSON.parse(z.daten || '{}'), id: z.id, t: z.t, art: z.art, js: z.js === 1, aktiv_s: z.aktiv_s, zuletzt: z.zuletzt,
  }));
}

// Vollstaendige Zeilen fuer Detailansicht und Export, Rohdaten als Objekte.
const vollZeile = (z) => ({
  id: z.id,
  zeit_utc: new Date(z.t).toISOString(),
  zeit_berlin: new Date(z.t).toLocaleString('de-DE', { timeZone: 'Europe/Berlin' }),
  art: z.art,
  im_browser: z.js === 1,
  verweildauer_s: z.aktiv_s ?? null,
  letztes_lebenszeichen_utc: z.zuletzt ? new Date(z.zuletzt).toISOString() : null,
  ray_id: z.ray || null,
  zusammenfassung: JSON.parse(z.daten || '{}'),
  rohdaten: z.roh ? JSON.parse(z.roh) : null,
  rueckmeldung: z.js_t ? {
    zeit_utc: new Date(z.js_t).toISOString(),
    sekunden_nach_aufruf: Math.round((z.js_t - z.t) / 100) / 10,
    ray_id: z.js_ray || null,
    rohdaten: z.js_roh ? JSON.parse(z.js_roh) : null,
  } : null,
});

const sha256 = async (text) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

const csvFeld = (w) => `"${String(w ?? '').replace(/"/g, '""')}"`;

async function exportieren(db, format) {
  const { results } = await db.prepare('SELECT * FROM besuche ORDER BY t ASC').all();
  const zeilen = results.map(vollZeile);
  const stempel = new Date().toISOString();
  let text;
  let typ;
  if (format === 'json') {
    const eintraegeText = JSON.stringify(zeilen);
    text = JSON.stringify({
      quelle: 'Besucherprotokoll demo.trisar.de (Cloudflare Pages, D1 trisar-demo-besuche)',
      erstellt_utc: stempel,
      anzahl: zeilen.length,
      hinweis: 'Ray-IDs sind von Cloudflare vergebene Anfrage-Kennungen. IP-Adressen und Cookies werden nicht gespeichert.',
      pruefsumme_eintraege_sha256: await sha256(eintraegeText),
      eintraege: zeilen,
    }, null, 2);
    typ = 'application/json; charset=utf-8';
  } else {
    const kopf = ['id', 'zeit_utc', 'zeit_berlin', 'art', 'ki', 'im_browser', 'verweildauer_s', 'rueckmeldung_utc', 'ray_id', 'rueckmeldung_ray_id',
      'stadt', 'region', 'land', 'postleitzahl', 'asn', 'netz', 'rechenzentrum', 'herkunft', 'seite', 'geraet', 'browser', 'sprache', 'kennung'];
    const reihen = zeilen.map((z) => {
      const d = z.zusammenfassung;
      const roh = z.rohdaten || {};
      return [z.id, z.zeit_utc, z.zeit_berlin, z.art, d.ki || '', z.im_browser ? 'ja' : 'nein', z.verweildauer_s ?? '', z.rueckmeldung?.zeit_utc || '',
        z.ray_id || '', z.rueckmeldung?.ray_id || '', d.stadt, d.region, d.land, roh.ort?.postleitzahl || '', roh.netz?.asn ?? '',
        d.netz, roh.verbindung?.rechenzentrum || '', d.herkunft, d.pfad, d.geraet, d.browser, d.sprache, roh.kennung || d.ua];
    });
    text = `\ufeff${[kopf, ...reihen].map((r) => r.map(csvFeld).join(';')).join('\r\n')}\r\n`;
    typ = 'text/csv; charset=utf-8';
  }
  const summe = await sha256(text);
  const datei = `besucherprotokoll-${stempel.slice(0, 16).replace(/[:T]/g, '-')}-${summe.slice(0, 12)}.${format === 'json' ? 'json' : 'csv'}`;
  return new Response(text, {
    headers: {
      'content-type': typ,
      'content-disposition': `attachment; filename="${datei}"`,
      'x-pruefsumme-sha256': summe,
      'cache-control': 'no-store',
    },
  });
}

async function detailSeite(db, id) {
  const z = await db.prepare('SELECT * FROM besuche WHERE id = ?').bind(id).first();
  if (!z) return `<p><a href="/protokoll">← Zurück</a></p><h1>Besuch ${esc(id)}</h1><p class="unter">Nicht gefunden.</p>`;
  const v = vollZeile(z);
  const summe = await sha256(JSON.stringify(v));
  const d = v.zusammenfassung;
  const zeile = (k, w) => `<tr><th>${esc(k)}</th><td>${esc(w ?? '–') || '–'}</td></tr>`;
  return `
    <p><a href="/protokoll">← Zurück zum Protokoll</a></p>
    <h1>Besuch ${esc(v.id)}</h1>
    <p class="unter">${esc(v.zeit_berlin)} (deutsche Zeit) · ${esc(v.zeit_utc)} UTC</p>
    <div class="tabelle"><table class="detail">
      ${zeile('Art', v.art === 'ki' ? `KI-Abruf · ${d.ki}` : v.art)}
      ${zeile('Im Browser geöffnet', v.im_browser ? `ja, Rückmeldung ${v.rueckmeldung.sekunden_nach_aufruf} s nach dem Aufruf` : 'nein')}
      ${zeile('Verweildauer (Tab sichtbar)', v.verweildauer_s == null ? null : `${v.verweildauer_s} s, letztes Lebenszeichen ${v.letztes_lebenszeichen_utc} UTC`)}
      ${zeile('Cloudflare Ray-ID (Aufruf)', v.ray_id)}
      ${zeile('Cloudflare Ray-ID (Rückmeldung)', v.rueckmeldung?.ray_id)}
      ${zeile('Ort', [d.stadt, d.region, land(d.land)].filter(Boolean).join(', '))}
      ${zeile('Netz', `${d.netz || '–'}${v.rohdaten?.netz?.asn ? ` (AS${v.rohdaten.netz.asn})` : ''}`)}
      ${zeile('Cloudflare-Rechenzentrum', v.rohdaten?.verbindung?.rechenzentrum)}
      ${zeile('Herkunft', d.herkunft || 'direkt / Link')}
      ${zeile('Seite', d.pfad)}
      ${zeile('Kennung (User-Agent)', v.rohdaten?.kennung || d.ua)}
      ${zeile('Prüfsumme dieses Eintrags (SHA-256)', summe)}
    </table></div>
    <h2>Rohdaten</h2>
    ${v.rohdaten ? '' : '<p class="unter">Für diesen Eintrag gibt es noch keine Rohdaten (vor Einführung der Beweissicherung am 02.11.2026 erfasst).</p>'}
    <pre>${esc(JSON.stringify(v, null, 2))}</pre>`;
}

const SEITE = (inhalt) => `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Besucherprotokoll</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  :root { --lime: #e3f654; --grau: #9a9a9a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #000; color: #fff; font: 14px/1.4 'Space Grotesk', system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { color: var(--lime); font-size: 36px; margin: 0 0 4px; }
  .unter { color: var(--grau); margin: 0 0 24px; }
  .zahlen { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 24px; }
  .zahl { border: 2px solid var(--lime); color: var(--lime); padding: 10px 16px; min-width: 130px; }
  .zahl b { display: block; font-size: 28px; }
  h2 { color: var(--lime); font-size: 16px; margin: 28px 0 8px; }
  .tabelle { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; min-width: 760px; }
  pre { white-space: pre-wrap; word-break: break-all; background: #111; border: 1px solid #222; padding: 12px; font-size: 12px; color: #ddd; }
  table.detail { min-width: 0; } table.detail th { width: 240px; }
  th, td { text-align: left; padding: 7px 10px; border-bottom: 1px solid #222; vertical-align: top; }
  th { color: var(--grau); font-weight: 500; font-size: 12px; }
  td.zeit { color: var(--lime); font-weight: 700; white-space: nowrap; }
  .klein { color: var(--grau); font-size: 12px; }
  .marke { font-size: 11px; padding: 1px 6px; border: 1px solid var(--grau); color: var(--grau); white-space: nowrap; }
  .marke.ki { border-color: #7aa7ff; color: #7aa7ff; }
  .mensch { color: var(--lime); }
  a { color: var(--lime); }
  .live { color: var(--grau); font-size: 12px; margin: 0 0 16px; }
  .live::before { content: ''; display: inline-block; width: 8px; height: 8px; margin-right: 6px; background: var(--lime); border-radius: 50%; animation: puls 2s infinite; }
  @keyframes puls { 50% { opacity: .2; } }
</style></head><body><main>${inhalt}</main>
<p class="live" id="live" style="max-width:1100px;margin:0 auto;padding:0 16px 32px">live · aktualisiert sich alle 15 s</p>
<script>
  // Live: Inhalt alle 15 s neu holen und austauschen, ohne die Seite neu zu laden.
  // Die Anmeldung schickt der Browser fuer dieselbe Seite automatisch mit.
  setInterval(async () => {
    try {
      const antwort = await fetch(location.href, { cache: 'no-store', credentials: 'same-origin' });
      if (!antwort.ok) return;
      const neu = new DOMParser().parseFromString(await antwort.text(), 'text/html').querySelector('main');
      if (neu) document.querySelector('main').innerHTML = neu.innerHTML;
      document.getElementById('live').textContent = 'live · zuletzt aktualisiert ' + new Date().toLocaleTimeString('de-DE');
    } catch (e) { /* naechster Versuch in 15 s */ }
  }, 15000);
</script></body></html>`;

export async function onRequest({ request, env }) {
  const passwort = env.PROTOKOLL_PASSWORT;
  if (!passwort) {
    return new Response(SEITE('<h1>Besucherprotokoll</h1><p class="unter">Noch kein Passwort gesetzt.</p>'), {
      status: 503, headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
  if (!angemeldet(request, passwort)) {
    return new Response('Anmeldung erforderlich', {
      status: 401,
      headers: { 'www-authenticate': 'Basic realm="TRISAR Besucherprotokoll", charset="UTF-8"', 'cache-control': 'no-store' },
    });
  }

  const url = new URL(request.url);
  const kopfHtml = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
    // Eigene Aufrufe ab jetzt nicht mehr zaehlen (ein Jahr).
    'set-cookie': 'trisar_ich=1; Max-Age=31536000; Path=/; Secure; HttpOnly; SameSite=Lax',
  };
  const format = url.searchParams.get('export');
  if (env.PROTOKOLL && (format === 'csv' || format === 'json')) return exportieren(env.PROTOKOLL, format);
  const id = Number(url.searchParams.get('id'));
  if (env.PROTOKOLL && id) return new Response(SEITE(await detailSeite(env.PROTOKOLL, id)), { headers: kopfHtml });

  const alle = url.searchParams.get('alle') === '1';
  const eintraege = env.PROTOKOLL ? await alleEintraege(env.PROTOKOLL) : [];
  // Standard: Besuche und KI-Abrufe. Bots und Link-Vorschauen nur auf Wunsch.
  const sichtbar = alle ? eintraege : eintraege.filter((e) => e.art === 'besuch' || e.art === 'ki');
  // Zahlen oben ohne die eigenen Besuche.
  const besuche = eintraege.filter((e) => e.art === 'besuch' && !e.eigen);
  const kiAbrufe = eintraege.filter((e) => e.art === 'ki').length;
  const vorschauen = eintraege.filter((e) => e.art === 'vorschau').length;
  const tag = 24 * 3600 * 1000;
  const jetzt = Date.now();

  // Wiedererkennung ohne Speicher beim Besucher: gleiches Netz, Geraet, Browser,
  // Sprache und Land gilt als vermutlich dieselbe Person. Nummer je Tag und insgesamt.
  const profil = (e) => [e.netz, e.geraet, e.browser, e.sprache, e.land].join('|');
  const jeTag = new Map();
  const gesamtJe = new Map();
  for (const e of [...eintraege].reverse()) {
    if (e.art !== 'besuch') continue;
    const k = profil(e);
    const kt = `${tagText(e.t)}|${k}`;
    jeTag.set(kt, (jeTag.get(kt) || 0) + 1);
    gesamtJe.set(k, (gesamtJe.get(k) || 0) + 1);
    e.nrHeute = jeTag.get(kt);
    e.nrGesamt = gesamtJe.get(k);
  }

  const nachTag = new Map();
  for (const e of sichtbar) {
    const k = tagText(e.t);
    if (!nachTag.has(k)) nachTag.set(k, []);
    nachTag.get(k).push(e);
  }

  const zeilen = [...nachTag.entries()].map(([k, liste]) => `
    <h2>${esc(k)} · ${liste.length}</h2>
    <div class="tabelle"><table>
      <tr><th>Uhrzeit</th><th>Wer</th><th>Dauer</th><th>Ort</th><th>Netz / Organisation</th><th>Herkunft</th><th>Gerät</th><th>Seite</th></tr>
      ${liste.map((e) => `<tr>
        <td class="zeit"><a href="/protokoll?id=${e.id}" style="text-decoration:none">${esc(uhrText(e.t))}</a></td>
        <td>${werText(e)}${e.nrGesamt > 1 ? `<div class="klein">vermutlich ${e.nrHeute > 1 ? `${e.nrHeute}. Besuch heute` : 'wieder da'} · ${e.nrGesamt}. insgesamt</div>` : ''}</td>
        <td style="white-space:nowrap">${dauerText(e, jetzt)}</td>
        <td>${esc([e.stadt, land(e.land)].filter(Boolean).join(', ') || '–')}<div class="klein">${esc(e.region)}</div></td>
        <td>${esc(e.netz || '–')}</td>
        <td>${esc(herkunftText(e))}${e.art === 'vorschau' || e.art === 'bot' ? ` <span class="marke">${e.art === 'vorschau' ? 'Link-Vorschau' : 'Bot'}</span>` : ''}</td>
        <td>${esc(e.geraet)}<div class="klein">${esc(e.browser)}${e.sprache ? ` · ${esc(e.sprache)}` : ''}</div></td>
        <td>${esc(seiteText(e.pfad))}</td>
      </tr>`).join('')}
    </table></div>`).join('');

  const inhalt = `
    <h1>Besucherprotokoll</h1>
    <p class="unter">demo.trisar.de · Uhrzeit in deutscher Zeit · Ort und Netz sind ungefähr (Standort des Internetanschlusses) · Einträge verfallen nach 90 Tagen · „im Browser“ = Seite lief wirklich im Browser (Mensch oder KI-Agent im Browser), „nur abgerufen“ = Text geholt, nichts ausgeführt · Dauer = Zeit, in der der Tab sichtbar war · „vermutlich 3. Besuch“ = gleiches Netz, Gerät, Browser und Sprache wie frühere Besuche · deine eigenen Besuche stehen mit „du“ in der Liste, zählen aber nicht in den Zahlen oben</p>
    <div class="zahlen">
      <div class="zahl"><b>${besuche.filter((e) => jetzt - e.t < tag).length}</b>letzte 24 h</div>
      <div class="zahl"><b>${besuche.filter((e) => jetzt - e.t < 7 * tag).length}</b>letzte 7 Tage</div>
      <div class="zahl"><b>${besuche.length}</b>gesamt</div>
      <div class="zahl"><b>${besuche.filter((e) => e.js).length}</b>im Browser geöffnet</div>
      <div class="zahl"><b>${kiAbrufe}</b>KI-Abrufe</div>
      <div class="zahl"><b>${vorschauen}</b>Link-Vorschauen</div>
    </div>
    <p class="klein">${alle ? '<a href="/protokoll">Nur echte Besuche zeigen</a>' : '<a href="/protokoll?alle=1">Auch Bots und Link-Vorschauen zeigen</a>'}
      · Export mit allen Rohdaten: <a href="/protokoll?export=csv">CSV (Excel)</a> · <a href="/protokoll?export=json">JSON</a>
      · Uhrzeit anklicken für alle Details eines Besuchs</p>
    ${zeilen || '<p class="unter">Noch keine Besuche.</p>'}`;

  return new Response(SEITE(inhalt), { headers: kopfHtml });
}
