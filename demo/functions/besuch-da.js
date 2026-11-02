// /besuch-da?v=<Kennung>&a=<Sekunden>: Die Seite lief wirklich im Browser (Skript ausgefuehrt).
// a = bisher sichtbare Zeit im Tab, kommt alle 15 s und beim Verlassen (Verweildauer).
// Setzt im Besucherprotokoll den Haken js und haelt Zeit, Ray-ID und Rohdaten der
// Rueckmeldung fest (Beweissicherung). Siehe functions/_middleware.js.

import { rohdaten } from '../../werkzeuge/protokoll/rohdaten.js';

export async function onRequest({ request, env }) {
  const vid = new URL(request.url).searchParams.get('v') || '';
  if (env.PROTOKOLL && request.method === 'POST' && /^[0-9a-f-]{36}$/.test(vid)) {
    try {
      const jetzt = Date.now();
      const aktiv = Math.max(0, Math.min(Number(new URL(request.url).searchParams.get('a')) || 0, 24 * 3600));
      // Nur die erste Rueckmeldung zaehlt.
      await env.PROTOKOLL.prepare('UPDATE besuche SET js = 1, js_t = ?, js_ray = ?, js_roh = ? WHERE vid = ? AND js = 0')
        .bind(jetzt, request.headers.get('cf-ray') || '', JSON.stringify(rohdaten(request, jetzt)), vid).run();
      // Verweildauer: nie mehr als seit dem Aufruf vergangen ist.
      await env.PROTOKOLL.prepare('UPDATE besuche SET aktiv_s = MAX(COALESCE(aktiv_s, 0), MIN(?, (? - t) / 1000)), zuletzt = ? WHERE vid = ?')
        .bind(aktiv, jetzt, jetzt, vid).run();
    } catch {
      // Protokoll nicht erreichbar: der Besucher merkt davon nichts.
    }
  }
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}
