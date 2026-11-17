// Ankunfts- und Abflugtafel des Flughafens Muenchen von munich-airport.de (17.11.2026).
// Ersatz fuer die Lufthansa-Schnittstelle im Live-Board der Dispo, deren Zugang seit 17.11. mit 401
// abgelehnt wird. Kostenlos, nur MUC, nur gestern bis morgen.
//
// Die Flugsuche liefert ohne Flugnummer den ganzen Tag ab Mitternacht, nach Zeit sortiert, 100 Fluege je
// Seite (ein Tag hat rund 340 Ankuenfte). Eine Uhrzeit nimmt sie nicht an, darum Seiten holen und ab
// "jetzt" filtern. Ergebnis 60 s im Speicher, damit die Apps (alle 60 s) die Seite nicht staendig abfragen.
// Gleiche Felder wie bisher bei Lufthansa (flight_number, route_label, time_label, ...).

const BASIS = 'https://www.munich-airport.de';
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const JE_SEITE = 100;
const HOECHSTENS_SEITEN = 6;
const MERKEN_MS = 60_000;
const VERGANGEN_MIN = 20;

export type TafelEintrag = {
  flight_number: string | null;
  marketing_carrier: string | null;
  operating_carrier: string | null;
  is_lufthansa_group_operated: boolean;
  codeshares: string[];
  status_code: string | null;
  status_description: string | null;
  origin: string | null;
  destination: string | null;
  scheduled_time_local: string | null;
  estimated_time_local: string | null;
  actual_time_local: string | null;
  time_label: string | null;
  route_label: string;
  terminal: string | null;
  gate: string | null;
  aircraft_code: string | null;
  delay_minutes: number | null;
};

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const zelle = (zeile: string, klasse: string) => {
  const m = zeile.match(new RegExp(`<td class="${klasse}"[^>]*>([\\s\\S]*?)</td>`));
  return m ? m[1] : '';
};

const minuten = (hhmm: string | null) => {
  const m = hhmm?.match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

const statusCode = (wort: string): string | null => {
  const w = wort.toLowerCase();
  if (!w) return null;
  if (/annul|gestrichen|cancel/.test(w)) return 'CD';
  if (/umgeleitet|divert/.test(w)) return 'RT';
  if (/gelandet|beendet|gep(ä|ae)ck|landung|angekommen|parkposition/.test(w)) return 'LD';
  if (/gestartet|anflug|unterwegs|abgeflogen|in der luft/.test(w)) return 'DP';
  if (/versp(ä|ae)t/.test(w)) return 'DL';
  if (/geplant|planm/.test(w)) return 'NO';
  return null;
};

const heuteBerlin = (jetzt = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(jetzt);

const minuteBerlin = (jetzt = new Date()) => {
  const [h, m] = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false })
    .format(jetzt).split(':').map(Number);
  return h * 60 + m;
};

const seiteHolen = async (abfluege: boolean, datum: string, seite: number) => {
  const url = new URL(`${BASIS}/flightsearch/${abfluege ? 'departures' : 'arrivals'}`);
  url.searchParams.set(abfluege ? 'flight_search_presenter[flight_from_muc]' : 'flight_search_presenter[flight_to_muc]', '1');
  url.searchParams.set(abfluege ? 'flight_search_presenter[flight_date_from_muc]' : 'flight_search_presenter[flight_date_to_muc]', datum);
  url.searchParams.set('page', String(seite));
  url.searchParams.set('per_page', String(JE_SEITE));
  const antwort = await fetch(url.toString(), {
    headers: { 'User-Agent': BROWSER, Accept: 'text/html, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!antwort.ok) throw new Error(`muc_http_${antwort.status}`);
  const html = await antwort.text();
  // Die Seite meldet den Tag, den sie zeigt. Weicht er ab, hat sie das Datum nicht angenommen.
  const kopf = html.match(/Flüge (?:nach|von) München am (\d{2})\.(\d{2})\.(\d{4})/);
  if (kopf && `${kopf[3]}-${kopf[2]}-${kopf[1]}` !== datum) return [];
  return html.split(/<tr data-flight-id="/).slice(1)
    .filter((stueck) => /^[^"]+" class="fp-flight-item"/.test(stueck))
    .map((stueck) => stueck.slice(0, stueck.indexOf('</tr>')));
};

const zeileLesen = (zeile: string, abfluege: boolean, datum: string, lhGruppe: Set<string>): TafelEintrag | null => {
  const nummern = [...zelle(zeile, 'fp-flight-number').matchAll(/<span class="nobr">([^<]+)<\/span>/g)].map((m) => text(m[1]));
  const haupt = nummern[0]?.match(/^([A-Z0-9]{2,3})\s*0*(\d{1,4}[A-Z]?)\s*(?:\(([^)]+)\))?/);
  if (!haupt) return null;
  const airline = haupt[1];
  const flug = `${airline}${haupt[2]}`;
  const codeshares = nummern.slice(1).map((n) => n.replace(/\s+/g, '').replace(/^([A-Z0-9]{2,3})0+/, '$1')).filter(Boolean);
  const flughafenText = text(zelle(zeile, 'fp-flight-airport'));
  const anderer = flughafenText.match(/\(([A-Z]{3})\)/)?.[1] || flughafenText || null;
  const statusText = text(zelle(zeile, 'fp-flight-status')) || null;
  const [geplantText, erwartetText] = text(zelle(zeile, 'fp-flight-time-muc')).split('|').map((s) => s.trim());
  const geplant = geplantText?.match(/\d{2}:\d{2}/)?.[0] || null;
  const erwartet = erwartetText?.match(/\d{2}:\d{2}/)?.[0] || null;
  const bereich = text(zelle(zeile, 'fp-flight-area'));
  const code = statusText ? statusCode(statusText) : null;
  const fertig = abfluege ? code === 'DP' : code === 'LD';
  const geplantMin = minuten(geplant);
  const erwartetMin = minuten(erwartet);
  return {
    flight_number: flug,
    marketing_carrier: airline,
    operating_carrier: airline,
    is_lufthansa_group_operated: lhGruppe.has(airline),
    codeshares,
    status_code: code,
    status_description: statusText,
    origin: abfluege ? 'MUC' : anderer,
    destination: abfluege ? anderer : 'MUC',
    scheduled_time_local: geplant ? `${datum}T${geplant}` : null,
    estimated_time_local: erwartet && !fertig ? `${datum}T${erwartet}` : null,
    actual_time_local: erwartet && fertig ? `${datum}T${erwartet}` : null,
    time_label: erwartet || geplant,
    route_label: abfluege ? `MUC -> ${anderer || '?'}` : `${anderer || '?'} -> MUC`,
    terminal: bereich ? bereich.replace(/^T/i, '') : null,
    gate: null,
    aircraft_code: haupt[3] || null,
    delay_minutes: geplantMin !== null && erwartetMin !== null ? erwartetMin - geplantMin : null,
  };
};

const merker = new Map<string, { zeit: number; eintraege: TafelEintrag[] }>();

/**
 * Naechste Ankuenfte bzw. Abfluege in MUC. Heute ab 20 min vor jetzt, an anderen Tagen ab Mitternacht.
 * nurLhGruppe: nur von der Lufthansa-Gruppe durchgefuehrte Fluege (wie das bisherige Board).
 */
export const mucTafel = async (
  { abfluege, datum, limit, nurLhGruppe, lhGruppe }:
    { abfluege: boolean; datum: string; limit: number; nurLhGruppe: boolean; lhGruppe: Set<string> },
): Promise<TafelEintrag[]> => {
  const schluessel = `${abfluege}:${datum}:${limit}:${nurLhGruppe}`;
  const alt = merker.get(schluessel);
  if (alt && Date.now() - alt.zeit < MERKEN_MS) return alt.eintraege;

  const ab = datum === heuteBerlin() ? minuteBerlin() - VERGANGEN_MIN : -1;
  const gefunden: TafelEintrag[] = [];
  for (let seite = 0; seite < HOECHSTENS_SEITEN && gefunden.length < limit; seite += 1) {
    const zeilen = await seiteHolen(abfluege, datum, seite);
    for (const zeile of zeilen) {
      const e = zeileLesen(zeile, abfluege, datum, lhGruppe);
      if (!e) continue;
      if (nurLhGruppe && !e.is_lufthansa_group_operated) continue;
      const min = minuten(e.time_label);
      if (min !== null && min < ab) continue;
      gefunden.push(e);
      if (gefunden.length >= limit) break;
    }
    if (zeilen.length < JE_SEITE) break;
  }
  // Angezeigt wird die erwartete Zeit, darum danach sortieren (die Seite sortiert nach Plan).
  gefunden.sort((a, b) => String(a.time_label || '').localeCompare(String(b.time_label || '')));
  merker.set(schluessel, { zeit: Date.now(), eintraege: gefunden });
  return gefunden;
};
