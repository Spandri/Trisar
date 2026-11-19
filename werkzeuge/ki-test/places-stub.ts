// Feste Adresssuche fuer den Testsatz (18.11.): Google Places wird nicht gefragt. Bekannte Texte liefern feste
// Treffer, alles andere einen Fehler, dann bleibt der getippte Text wie bisher ohne Schluessel.
// Muss vor ki.ts geladen werden (ki-test.ts importiert es direkt nach uhr.ts).
// deno-lint-ignore-file no-explicit-any
const normal = (t: string) => String(t || '').toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const p = (main: string, secondary: string) => ({ description: `${main}, ${secondary}`, structured_formatting: { main_text: main, secondary_text: secondary } });

export const PLACES: Record<string, any[]> = {
  'franz josef strasse 48': [
    p('Franz-Joseph-Straße 48', '80801 München, Deutschland'),
    p('Franz-Josef-Straße 48', '85540 Haar, Deutschland'),
    p('Franz-Josef-Strauß-Ring 4', '80539 München, Deutschland'),
  ],
  'avalon emil frey frankfurter ring': [
    p('Emil Frey Avalon BMW', 'Frankfurter Ring 227, 80807 München, Deutschland'),
    p('Emil Frey Avalon Volvo', 'Moosacher Straße 52, 80809 München, Deutschland'),
  ],
  'gibtsnicht weg 7': [],
  'leopoldstrasse 10': [p('Leopoldstraße 10', '80802 München, Deutschland')],
};

if (!Deno.env.get('GOOGLE_PLACES_SERVER_KEY')) Deno.env.set('GOOGLE_PLACES_SERVER_KEY', 'test');
const echt = globalThis.fetch;
globalThis.fetch = (async (u: any, o?: any) => {
  const url = String(u?.url ?? u);
  if (url.startsWith('https://maps.googleapis.com/maps/api/place/autocomplete')) {
    const treffer = PLACES[normal(new URL(url).searchParams.get('input') || '')];
    if (!treffer) return new Response(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'Testsatz' }), { status: 400 });
    return new Response(JSON.stringify({ status: treffer.length ? 'OK' : 'ZERO_RESULTS', predictions: treffer }), { status: 200 });
  }
  return echt(u, o);
}) as typeof fetch;
