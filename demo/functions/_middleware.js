// Besucherprotokoll fuer demo.trisar.de: jeder Seitenaufruf im Browserfenster
// (nicht die Apps im Rahmen, nicht Bilder oder Skripte) wird mit Uhrzeit,
// ungefaehrem Ort, Netz, Herkunftsseite und Geraet in D1 gespeichert (Tabelle besuche,
// werkzeuge/protokoll/schema.sql). Bekannte KI-Abrufer (ChatGPT, Claude, Perplexity ...)
// werden immer gespeichert und gekennzeichnet.
// Mensch oder Programm: In die Seite kommt ein kleines Skript, das sich bei
// /besuch-da zurueckmeldet. Das passiert nur, wenn die Seite wirklich im Browser
// laeuft. KI-Abrufer lesen nur den Text und fuehren es nicht aus.
// Keine IP-Adresse, keine Cookies beim Besucher. Eintraege verfallen nach 90 Tagen.
// Ansehen: /protokoll (Passwort, nur fuer den Betreiber), siehe functions/protokoll.js.

import { rohdaten } from '../../werkzeuge/protokoll/rohdaten.js';

const AUFBEWAHREN_S = 90 * 24 * 3600;

// Name, unter dem der Abrufer im Protokoll erscheint. Reihenfolge: genauere Muster zuerst.
const KI = [
  [/ChatGPT-User|ChatGPT Agent|ChatGPT\//i, 'ChatGPT'],
  [/OAI-SearchBot/i, 'ChatGPT-Suche'],
  [/GPTBot/i, 'OpenAI-Crawler'],
  [/Claude-User/i, 'Claude'],
  [/Claude-SearchBot/i, 'Claude-Suche'],
  [/ClaudeBot|anthropic-ai/i, 'Anthropic-Crawler'],
  [/Perplexity-User/i, 'Perplexity'],
  [/PerplexityBot/i, 'Perplexity-Crawler'],
  [/MistralAI-User/i, 'Mistral'],
  [/Google-CloudVertexBot|GoogleOther|Gemini/i, 'Google KI'],
  [/meta-externalagent|meta-externalfetcher/i, 'Meta KI'],
  [/DuckAssistBot/i, 'DuckDuckGo KI'],
  [/cohere-ai|cohere-training/i, 'Cohere'],
  [/YouBot/i, 'You.com'],
  [/Bytespider/i, 'ByteDance-Crawler'],
  [/CCBot/i, 'Common Crawl'],
  [/Amazonbot/i, 'Amazon-Crawler'],
  [/Applebot/i, 'Apple-Crawler'],
];
const VORSCHAU = /linkedin|whatsapp|telegram|slack|discord|facebookexternalhit|twitterbot|skype|teams|outlook/i;
const BOT = /bot|crawl|spider|slurp|monitor|curl|wget|python|headless|lighthouse|scan|http-client|go-http|java\//i;

const kiName = (ua) => (KI.find(([muster]) => muster.test(ua)) || [])[1] || '';
const art = (ua) => (kiName(ua) ? 'ki' : VORSCHAU.test(ua) ? 'vorschau' : BOT.test(ua) || !ua ? 'bot' : 'besuch');

const geraet = (ua) => {
  if (/ipad|tablet/i.test(ua)) return 'Tablet';
  if (/mobile|iphone|android/i.test(ua)) return 'Handy';
  return 'Computer';
};

const browser = (ua) => {
  const treffer = [
    [/edg\//i, 'Edge'], [/opr\/|opera/i, 'Opera'], [/firefox|fxios/i, 'Firefox'],
    [/chrome|crios/i, 'Chrome'], [/safari/i, 'Safari'],
  ].find(([muster]) => muster.test(ua));
  const system = /iphone|ipad/i.test(ua) ? 'iOS' : /android/i.test(ua) ? 'Android'
    : /mac os/i.test(ua) ? 'macOS' : /windows/i.test(ua) ? 'Windows' : /linux/i.test(ua) ? 'Linux' : '';
  return [treffer ? treffer[1] : '', system].filter(Boolean).join(' · ');
};

const istSeitenaufruf = (request) => {
  if (request.method !== 'GET') return false;
  const ziel = request.headers.get('sec-fetch-dest');
  if (ziel) return ziel === 'document';
  return (request.headers.get('accept') || '').includes('text/html');
};

// Rueckmeldung aus dem Browser. Laeuft vor allen anderen Skripten der Seite.
// Zaehlt die Zeit, in der der Tab sichtbar ist, und meldet sie alle 15 s, beim
// Wechsel in den Hintergrund und beim Verlassen (Verweildauer).
const rueckmeldung = (vid) => `<script>(function(){try{var a=0,s=Date.now(),sicht=document.visibilityState!=='hidden';`
  + `function stand(){var j=Date.now();if(sicht)a+=j-s;s=j;}`
  + `function senden(){var u='/besuch-da?v=${vid}&a='+Math.round(a/1000);`
  + `if(navigator.sendBeacon){navigator.sendBeacon(u);}else{fetch(u,{method:'POST',keepalive:true});}}`
  + `document.addEventListener('visibilitychange',function(){stand();sicht=document.visibilityState!=='hidden';if(!sicht)senden();});`
  + `addEventListener('pagehide',function(){stand();senden();});`
  + `setInterval(function(){if(sicht){stand();senden();}},15000);senden();}catch(e){}})();</script>`;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const ua = request.headers.get('user-agent') || '';
  const eigen = (request.headers.get('cookie') || '').includes('trisar_ich=1');
  // Eigene Besuche (Cookie nach Anmeldung auf /protokoll) werden mitgeschrieben, aber als eigen markiert.
  const protokollieren = Boolean(env.PROTOKOLL) && request.method === 'GET'
    && !url.pathname.startsWith('/protokoll') && !url.pathname.startsWith('/besuch-da')
    && (istSeitenaufruf(request) || Boolean(kiName(ua)));
  if (!protokollieren) return context.next();

  // Immer die ganze Seite liefern (kein 304 aus dem Browser-Cache), sonst traegt
  // die Seite die Kennung eines frueheren Besuchs.
  const anfrage = new Request(request);
  anfrage.headers.delete('if-none-match');
  anfrage.headers.delete('if-modified-since');
  let antwort = await context.next(anfrage);

  try {
    const cf = request.cf || {};
    const jetzt = Date.now();
    const vid = crypto.randomUUID();
    const daten = {
      pfad: url.pathname,
      quelle: url.searchParams.get('utm_source') || '',
      herkunft: (request.headers.get('referer') || '').slice(0, 200),
      stadt: cf.city || '',
      region: cf.region || '',
      land: cf.country || '',
      netz: cf.asOrganization || '',
      geraet: geraet(ua),
      browser: browser(ua),
      sprache: (request.headers.get('accept-language') || '').split(',')[0],
      ki: kiName(ua),
      eigen,
      ua: ua.slice(0, 160),
    };
    context.waitUntil(env.PROTOKOLL.batch([
      env.PROTOKOLL.prepare('INSERT INTO besuche (t, art, daten, vid, ray, roh) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(jetzt, art(ua), JSON.stringify(daten), vid, request.headers.get('cf-ray') || '', JSON.stringify(rohdaten(request, jetzt))),
      // Alte Eintraege gleich mit aufraeumen.
      env.PROTOKOLL.prepare('DELETE FROM besuche WHERE t < ?').bind(jetzt - AUFBEWAHREN_S * 1000),
    ]));
    if ((antwort.headers.get('content-type') || '').includes('text/html')) {
      antwort = new HTMLRewriter()
        .on('head', { element: (el) => el.prepend(rueckmeldung(vid), { html: true }) })
        .transform(antwort);
      antwort = new Response(antwort.body, antwort);
      antwort.headers.set('cache-control', 'no-store');
      antwort.headers.delete('etag');
    }
  } catch {
    // Das Protokoll darf die Seite nie stoeren.
  }
  return antwort;
}
