// Linie je Dienstreise-Abschnitt fuer die Karte (14.11.2026): Bus entlang der Strassen (OSRM Auto auf dem
// MacBook 2018), U-Bahn und Tram entlang ihrer Gleise (eigener OSRM, werkzeuge/stadtbahn-bauen.sh).
// Zuege und Fluege haben ihre Linie live (train-validate / Bogen), dafuer hier nichts.
// Aufruf nur vom Datenbank-Trigger (dienstreise_linie_anstossen, service_role) mit { aktion: 'abschnitt_linie',
// abschnitt_ids: [...] }. Schreibt dienstreise_abschnitt.linie ([[lng, lat], ...]). Klappt es nicht, bleibt
// die Linie leer (gerade Linie in den Apps).
// deno-lint-ignore no-explicit-any
type Admin = any;

/** Douglas-Peucker wie in train-validate (0.00015 Grad ~ 15 m). */
const vereinfachen = (punkte: [number, number][], toleranz = 0.00015): [number, number][] => {
  if (punkte.length < 3) return punkte;
  const behalten = new Uint8Array(punkte.length);
  behalten[0] = 1;
  behalten[punkte.length - 1] = 1;
  const stapel: [number, number][] = [[0, punkte.length - 1]];
  while (stapel.length) {
    const [a, b] = stapel.pop()!;
    const [x1, y1] = punkte[a];
    const [x2, y2] = punkte[b];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const laenge = Math.hypot(dx, dy) || 1e-12;
    let weitester = -1;
    let max = 0;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs(dy * punkte[i][0] - dx * punkte[i][1] + x2 * y1 - y2 * x1) / laenge;
      if (d > max) { max = d; weitester = i; }
    }
    if (weitester >= 0 && max > toleranz) {
      behalten[weitester] = 1;
      stapel.push([a, weitester], [weitester, b]);
    }
  }
  return punkte.filter((_, i) => behalten[i]);
};

const route = async (basen: string[], profil: string, von: [number, number], nach: [number, number], radius: number, extra = '') => {
  for (const basis of basen) {
    try {
      const r = await fetch(`${basis}/route/v1/${profil}/${von[0]},${von[1]};${nach[0]},${nach[1]}?overview=full&geometries=geojson&radiuses=${radius};${radius}${extra}`, {
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      const linie = (await r.json())?.routes?.[0]?.geometry?.coordinates;
      if (!Array.isArray(linie) || linie.length < 2) continue;
      return vereinfachen(linie as [number, number][])
        .map(([lng, lat]) => [Math.round(lng * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] as [number, number]);
    } catch { /* naechste Adresse */ }
  }
  return null;
};

const AUTO = [Deno.env.get('TRISAR_AUTO_OSRM_URL'), 'http://fahrer-app-lokal-osm-osrm-1:5000', 'http://host.docker.internal:5001']
  .filter(Boolean) as string[];
const STADTBAHN = [Deno.env.get('TRISAR_STADTBAHN_OSRM_URL'), 'http://trisar-osrm-stadtbahn:5000', 'http://host.docker.internal:5003']
  .filter(Boolean) as string[];

export const abschnittLinien = async (admin: Admin, body: Record<string, unknown>) => {
  const ids = (Array.isArray(body?.abschnitt_ids) ? body.abschnitt_ids : []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x));
  if (!ids.length) return { status: 400, daten: { error: 'abschnitt_ids fehlt' } };
  const { data: teile, error } = await admin.from('dienstreise_abschnitt')
    .select('id, art, von_lat, von_lng, nach_lat, nach_lng').in('id', ids);
  if (error) return { status: 500, daten: { error: error.message } };
  const punkte: Record<string, number> = {};
  for (const a of teile || []) {
    if (a.von_lat == null || a.von_lng == null || a.nach_lat == null || a.nach_lng == null) continue;
    const von: [number, number] = [a.von_lng, a.von_lat];
    const nach: [number, number] = [a.nach_lng, a.nach_lat];
    let linie: [number, number][] | null = null;
    if (a.art === 'bus') linie = await route(AUTO, 'driving', von, nach, 300);
    // U-Bahn ohne Tram-Gleise und umgekehrt, sonst springt die Route am Hauptbahnhof auf die andere Ebene.
    else if (a.art === 'ubahn') linie = await route(STADTBAHN, 'train', von, nach, 800, '&exclude=tram');
    else if (a.art === 'tram') linie = await route(STADTBAHN, 'train', von, nach, 800, '&exclude=subway');
    else continue;
    await admin.from('dienstreise_abschnitt').update({ linie }).eq('id', a.id);
    punkte[a.id] = linie?.length ?? 0;
  }
  return { status: 200, daten: { ok: true, punkte } };
};
