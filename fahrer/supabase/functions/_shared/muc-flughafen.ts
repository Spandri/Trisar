// Flugdaten vom Flughafen Muenchen, kostenlos (Forschungsphase, siehe reports/Flugdaten Quellen fuer TRISAR.md).
//
// 1. Live: die Flugsuche von munich-airport.de. Eine Abfrage je Flugnummer und Tag, findet auch Codeshare-Nummern
//    (EY 6070 -> LH 2431). Liefert Status, geplante und erwartete Landung, Terminal. Das Gate steht nur auf der
//    Detailseite. Die Seite kennt nur gestern bis morgen.
// 2. Plan: der Saisonflugplan als PDF (taeglich neu erzeugt), fuer Fahrten weiter in der Zukunft. Nur Hauptflugnummern,
//    keine Codeshares, keine kurzfristigen Streichungen. Wird hoechstens einmal am Tag in muc_flugplan geladen.
//
// Die Nutzungsbedingungen des Flughafens erlauben nur nicht gewerblichen Gebrauch. Sobald ein Betrieb damit faehrt,
// braucht es eine freigegebene oder bezahlte Quelle.

export const MUC_ANBIETER = 'muc_flughafen';
export const MUC_PLAN_ANBIETER = 'muc_flugplan';

const BASIS = 'https://www.munich-airport.de';
const PLAN_URL = `${BASIS}/saisonflugplan`;
const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const PLAN_ALTER_STUNDEN = 20;
const ZEITZONE = 'Europe/Berlin';

export type MucZusammenfassung = {
  provider: string;
  flight_iata: string;
  operating_carrier: string | null;
  operating_flight_number: string | null;
  marketing_carrier: string | null;
  marketing_flight_number: string | null;
  flight_status_code: string | null;
  flight_status_description: string | null;
  departure_airport: string | null;
  departure_terminal: string | null;
  departure_gate: string | null;
  arrival_airport: string | null;
  arrival_terminal: string | null;
  arrival_gate: string | null;
  scheduled_departure_local: string | null;
  estimated_departure_local: string | null;
  actual_departure_local: string | null;
  scheduled_arrival_local: string | null;
  estimated_arrival_local: string | null;
  actual_arrival_local: string | null;
  aircraft_code: string | null;
  aircraft_registration: string | null;
  aircraft_icao24: string | null;
  delay_minutes: number | null;
};

export type MucTreffer = {
  zusammenfassung: MucZusammenfassung;
  codeshares: string[];
  flug_id: string | null;
};

/** "LH 2431", "lh2431", "GF 087" -> "LH2431", "GF87". Leer, wenn es keine Flugnummer ist. */
export const mucFlugNorm = (wert: unknown): string => {
  const roh = String(wert ?? '').toUpperCase().replace(/\s+/g, '');
  const m = roh.match(/^([A-Z0-9]{2,3}?)(\d{1,4})([A-Z]?)$/);
  if (!m) return '';
  return `${m[1]}${String(Number(m[2]))}${m[3]}`;
};

const teile = (flug: string) => {
  const m = flug.match(/^([A-Z0-9]{2,3}?)(\d{1,4}[A-Z]?)$/);
  return m ? { airline: m[1], nummer: m[2] } : { airline: null, nummer: null };
};

/** Heutiges Datum in Muenchen als YYYY-MM-DD. */
export const mucHeute = (jetzt = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: ZEITZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(jetzt);

const tageZwischen = (von: string, bis: string) =>
  Math.round((Date.parse(`${bis}T00:00:00Z`) - Date.parse(`${von}T00:00:00Z`)) / 86_400_000);

const tagVerschieben = (datum: string, tage: number) =>
  new Date(Date.parse(`${datum}T00:00:00Z`) + tage * 86_400_000).toISOString().slice(0, 10);

/** Die Live-Seite kennt nur gestern, heute und morgen. */
export const mucLiveMoeglich = (datum: string, jetzt = new Date()) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return false;
  const abstand = tageZwischen(mucHeute(jetzt), datum);
  return abstand >= -1 && abstand <= 1;
};

const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

const zelle = (zeile: string, klasse: string) => {
  const m = zeile.match(new RegExp(`<td class="${klasse}"[^>]*>([\\s\\S]*?)</td>`));
  return m ? m[1] : '';
};

const minuten = (hhmm: string | null) => {
  if (!hhmm) return null;
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** Statuswort der Seite -> Code wie bei Lufthansa, den die Apps schon uebersetzen. */
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

const zusammenfassungBauen = ({
  provider, flug, gefragt, datum, herkunft, statusText, abflug, geplant, erwartet, terminal, gate, flugzeug,
}: {
  provider: string; flug: string; gefragt: string; datum: string; herkunft: string | null; statusText: string | null;
  abflug: string | null; geplant: string | null; erwartet: string | null; terminal: string | null; gate: string | null;
  flugzeug: string | null;
}): MucZusammenfassung => {
  const code = statusText ? statusCode(statusText) : null;
  const geplantMin = minuten(geplant);
  const erwartetMin = minuten(erwartet);
  // Erwartet kurz nach Mitternacht bei geplant spaet abends: Landung am Folgetag (und umgekehrt).
  let erwartetDatum = datum;
  if (geplantMin !== null && erwartetMin !== null) {
    if (erwartetMin - geplantMin < -12 * 60) erwartetDatum = tagVerschieben(datum, 1);
    if (erwartetMin - geplantMin > 12 * 60) erwartetDatum = tagVerschieben(datum, -1);
  }
  let verspaetung: number | null = null;
  if (geplantMin !== null && erwartetMin !== null) {
    verspaetung = erwartetMin - geplantMin + tageZwischen(datum, erwartetDatum) * 24 * 60;
  }
  // Abflug ist Ortszeit am Herkunftsflughafen. Liegt er nach der Landung, war er am Vortag.
  const abflugMin = minuten(abflug);
  const abflugDatum = abflugMin !== null && geplantMin !== null && abflugMin > geplantMin ? tagVerschieben(datum, -1) : datum;
  const gelandet = code === 'LD';
  const betreiber = teile(flug);
  const verkauf = teile(gefragt);
  return {
    provider,
    flight_iata: flug,
    operating_carrier: betreiber.airline,
    operating_flight_number: betreiber.nummer,
    marketing_carrier: verkauf.airline,
    marketing_flight_number: verkauf.nummer,
    flight_status_code: code,
    flight_status_description: statusText || null,
    departure_airport: herkunft,
    departure_terminal: null,
    departure_gate: null,
    arrival_airport: 'MUC',
    arrival_terminal: terminal,
    arrival_gate: gate,
    scheduled_departure_local: abflug ? `${abflugDatum}T${abflug}` : null,
    estimated_departure_local: null,
    actual_departure_local: null,
    scheduled_arrival_local: geplant ? `${datum}T${geplant}` : null,
    estimated_arrival_local: erwartet && !gelandet ? `${erwartetDatum}T${erwartet}` : null,
    actual_arrival_local: erwartet && gelandet ? `${erwartetDatum}T${erwartet}` : null,
    aircraft_code: flugzeug,
    aircraft_registration: null,
    aircraft_icao24: null,
    delay_minutes: verspaetung,
  };
};

const holen = async (url: string, ajax: boolean) => {
  const antwort = await fetch(url, {
    headers: {
      'User-Agent': BROWSER,
      Accept: ajax ? 'text/html, */*; q=0.01' : 'text/html',
      ...(ajax ? { 'X-Requested-With': 'XMLHttpRequest' } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!antwort.ok) throw new Error(`muc_http_${antwort.status}`);
  return await antwort.text();
};

/** Gate (und erwartete Landung) von der Detailseite. Fehler sind egal, dann bleibt das Gate leer. */
const mucDetail = async (flugId: string) => {
  try {
    const html = await holen(`${BASIS}/flugdetailseite-75020?flight_id=${encodeURIComponent(flugId)}`, false);
    const gate = html.match(/T\d[A-Z]?\s*-\s*Gate\s+([A-Z0-9]+)/);
    return { gate: gate ? gate[1] : null };
  } catch {
    return { gate: null };
  }
};

/**
 * Ankunft in MUC zu einer Flugnummer (auch Codeshare) an einem Tag. null, wenn der Flug an dem Tag nicht nach
 * MUC fliegt oder der Tag ausserhalb gestern bis morgen liegt. Wirft bei Netzwerkfehlern.
 */
export const mucAnkunftLive = async (
  flugnummer: unknown,
  datum: string,
  { mitGate = true, jetzt = new Date() }: { mitGate?: boolean; jetzt?: Date } = {},
): Promise<MucTreffer | null> => {
  const gefragt = mucFlugNorm(flugnummer);
  if (!gefragt || !mucLiveMoeglich(datum, jetzt)) return null;
  const url = new URL(`${BASIS}/flightsearch/arrivals`);
  url.searchParams.set('flight_search_presenter[flight_to_muc]', '1');
  url.searchParams.set('flight_search_presenter[flight_date_to_muc]', datum);
  url.searchParams.set('flight_search_presenter[flight_number]', gefragt);
  url.searchParams.set('page', '0');
  url.searchParams.set('per_page', '10');
  const html = await holen(url.toString(), true);

  // Die Seite meldet den Tag, den sie wirklich zeigt. Weicht er ab, hat sie das Datum nicht angenommen.
  const kopf = html.match(/Flüge nach München am (\d{2})\.(\d{2})\.(\d{4})/);
  if (kopf && `${kopf[3]}-${kopf[2]}-${kopf[1]}` !== datum) return null;

  const zeilen = html.split(/<tr data-flight-id="/).slice(1)
    .filter((stueck) => /^[^"]+" class="fp-flight-item"/.test(stueck))
    .map((stueck) => ({ id: stueck.slice(0, stueck.indexOf('"')), zeile: stueck.slice(0, stueck.indexOf('</tr>')) }));

  for (const { id, zeile } of zeilen) {
    const nummernZelle = zelle(zeile, 'fp-flight-number');
    const nummern = [...nummernZelle.matchAll(/<span class="nobr">([^<]+)<\/span>/g)].map((m) => text(m[1]));
    if (!nummern.length) continue;
    const haupt = nummern[0].match(/^([A-Z0-9]{2,3})\s*(\d{1,4}[A-Z]?)\s*(?:\(([^)]+)\))?/);
    if (!haupt) continue;
    const flug = mucFlugNorm(`${haupt[1]}${haupt[2]}`);
    const codeshares = nummern.slice(1).map(mucFlugNorm).filter(Boolean);
    if (flug !== gefragt && !codeshares.includes(gefragt)) continue;

    const herkunftText = text(zelle(zeile, 'fp-flight-airport'));
    const herkunft = herkunftText.match(/\(([A-Z]{3})\)/)?.[1] || null;
    const statusText = text(zelle(zeile, 'fp-flight-status')) || null;
    const abflug = text(zelle(zeile, 'fp-flight-time-other')).match(/\d{2}:\d{2}/)?.[0] || null;
    const [geplantText, erwartetText] = text(zelle(zeile, 'fp-flight-time-muc')).split('|').map((s) => s.trim());
    const geplant = geplantText?.match(/\d{2}:\d{2}/)?.[0] || null;
    const erwartet = erwartetText?.match(/\d{2}:\d{2}/)?.[0] || null;
    const bereich = text(zelle(zeile, 'fp-flight-area'));
    const terminal = bereich ? bereich.replace(/^T/i, '') : null;
    const gate = mitGate ? (await mucDetail(id)).gate : null;

    return {
      zusammenfassung: zusammenfassungBauen({
        provider: MUC_ANBIETER, flug, gefragt, datum, herkunft, statusText, abflug, geplant, erwartet,
        terminal, gate, flugzeug: haupt[3] || null,
      }),
      codeshares,
      flug_id: id,
    };
  }
  return null;
};

// ---------------------------------------------------------------- Saisonflugplan

type PlanZeile = {
  flugnummer: string;
  zeit_andere: string | null;
  zeit_muc: string;
  tage: string;
  flughafen: string | null;
  gueltig_von: string;
  gueltig_bis: string;
  terminal: string | null;
  airline: string | null;
};

const datumAusPlan = (wert: string) => {
  const m = wert.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
  return m ? `20${m[3]}-${m[2]}-${m[1]}` : null;
};

/** Eine Textzeile des PDFs ("L|LH 2431|18:10|20:00|1234567|GOT|17.11.26|23.12.26|2|Lufthansa") -> Ankunft. */
export const mucPlanZeileLesen = (zeile: string): PlanZeile | null => {
  const t = zeile.split('|').map((s) => s.trim()).filter(Boolean);
  if (t[0] !== 'L') return null;
  const flug = mucFlugNorm(t[1]);
  if (!flug) return null;
  const tageIndex = t.findIndex((s, i) => i > 1 && /^[1-7-]{7}$/.test(s));
  if (tageIndex < 0) return null;
  const zeiten = t.slice(2, tageIndex).filter((s) => /^\d{2}:\d{2}$/.test(s));
  if (!zeiten.length) return null;
  // Spalten: Abflug am anderen Flughafen, Zeit in MUC. Leere Zellen fehlen, darum von hinten.
  const zeitMuc = zeiten[zeiten.length - 1];
  const zeitAndere = zeiten.length > 1 ? zeiten[0] : null;
  const rest = t.slice(tageIndex + 1);
  const flughafen = rest.find((s) => /^[A-Z]{3}$/.test(s)) || null;
  const datumStellen = rest.map((s, i) => (datumAusPlan(s) ? i : -1)).filter((i) => i >= 0);
  if (datumStellen.length < 2) return null;
  const daten = [datumAusPlan(rest[datumStellen[0]])!, datumAusPlan(rest[datumStellen[1]])!];
  const nachBis = rest.slice(datumStellen[1] + 1);
  const terminal = nachBis.find((s) => /^\d[A-Z]?$/.test(s)) || null;
  const airline = nachBis.filter((s) => s !== terminal).join(' ') || null;
  return {
    flugnummer: flug, zeit_andere: zeitAndere, zeit_muc: zeitMuc, tage: t[tageIndex],
    flughafen, gueltig_von: daten[0], gueltig_bis: daten[1], terminal, airline,
  };
};

// deno-lint-ignore no-explicit-any
type PdfJs = any;
// deno-lint-ignore no-explicit-any
type Admin = any;

/** Seiten je Teil. Die Edge Runtime erlaubt je Aufruf nur 2 s CPU, das ganze PDF (87 Seiten) braucht auf der
 *  2018 mehr. 10 Seiten plus Oeffnen bleiben dort sicher darunter (15 lagen schon knapp ueber 1 s). */
const SEITEN_JE_TEIL = 10;

/**
 * Ein Teil des Saisonflugplans: PDF laden, Seiten ab..bis lesen, Ankuenfte zurueck. pdf.js wird hereingereicht,
 * weil die Edge Runtime keine Module zur Laufzeit nachlaedt (nur flight-validate bindet es fest ein).
 */
export const mucFlugplanTeilLesen = async (pdfjs: PdfJs, ab: number, bis: number) => {
  const antwort = await fetch(PLAN_URL, { headers: { 'User-Agent': BROWSER }, signal: AbortSignal.timeout(60_000) });
  if (!antwort.ok) throw new Error(`plan_http_${antwort.status}`);
  const dok = await pdfjs.getDocument({
    data: new Uint8Array(await antwort.arrayBuffer()), isEvalSupported: false, useSystemFonts: false,
  }).promise;
  const zeilen: string[] = [];
  let datenstand: string | null = null;
  for (let seite = Math.max(1, ab); seite <= Math.min(bis, dok.numPages); seite += 1) {
    const inhalt = await (await dok.getPage(seite)).getTextContent();
    const nachHoehe = new Map<number, { x: number; s: string }[]>();
    // deno-lint-ignore no-explicit-any
    for (const stueck of inhalt.items as any[]) {
      if (!stueck.str?.trim()) continue;
      const y = Math.round(stueck.transform[5]);
      if (!nachHoehe.has(y)) nachHoehe.set(y, []);
      nachHoehe.get(y)!.push({ x: stueck.transform[4], s: stueck.str });
    }
    for (const [, stuecke] of [...nachHoehe.entries()].sort((a, b) => b[0] - a[0])) {
      const zeile = stuecke.sort((a, b) => a.x - b.x).map((s) => s.s.trim()).join('|');
      zeilen.push(zeile);
      if (!datenstand) datenstand = zeile.match(/Datenstand:?\|?\s*(\d{2}\.\d{2}\.\d{4})/)?.[1] || null;
    }
  }
  const seiten = dok.numPages as number;
  await dok.destroy?.();
  return {
    seiten,
    datenstand,
    ankuenfte: zeilen.map(mucPlanZeileLesen).filter((z): z is PlanZeile => Boolean(z)),
  };
};

/** Ein Teil lesen und unter dem Stand speichern (flight-validate, Aufruf {muc_flugplan_teil: {stand, ab, bis}}). */
export const mucFlugplanTeilSpeichern = async (admin: Admin, pdfjs: PdfJs, stand: string, ab: number, bis: number) => {
  const teil = await mucFlugplanTeilLesen(pdfjs, ab, bis);
  for (let i = 0; i < teil.ankuenfte.length; i += 500) {
    const { error } = await admin.from('muc_flugplan')
      .insert(teil.ankuenfte.slice(i, i + 500).map((z) => ({ ...z, stand })));
    if (error) throw new Error(`muc_flugplan_insert: ${error.message}`);
  }
  return { seiten: teil.seiten, datenstand: teil.datenstand, zeilen: teil.ankuenfte.length };
};

const planAlt = (geladenAm: string | null | undefined, jetzt = new Date()) =>
  !geladenAm || Date.parse(geladenAm) < jetzt.getTime() - PLAN_ALTER_STUNDEN * 3_600_000;

const flightValidateAufrufen = async (body: Record<string, unknown>) => {
  const url = Deno.env.get('SUPABASE_URL');
  const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !schluessel) throw new Error('muc_flugplan: SUPABASE_URL oder Service-Schluessel fehlt');
  const antwort = await fetch(`${url}/functions/v1/flight-validate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${schluessel}`, apikey: schluessel, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const ergebnis = await antwort.json().catch(() => ({}));
  if (!antwort.ok) throw new Error(`muc_flugplan_teil HTTP ${antwort.status}: ${ergebnis?.error || ergebnis?.message || ''}`);
  return ergebnis;
};

/**
 * Laedt den Saisonflugplan neu, wenn der letzte Stand aelter als 20 Stunden ist (oder erzwingen): in Teilen zu
 * 10 Seiten, jeder Teil ein eigener Aufruf von flight-validate (eigenes CPU-Budget). Erst wenn alle Teile da sind,
 * wird der alte Stand geloescht. Einmal am Tag dauert die erste Suche dadurch einige Sekunden.
 * Gibt die Zahl der Ankuenfte zurueck, null wenn nichts zu tun war oder ein anderer Aufruf gerade laedt.
 */
export const mucFlugplanAuffrischen = async (admin: Admin, { erzwingen = false } = {}) => {
  const jetzt = new Date();
  // Ohne .or(): PostgREST liest den Zeitstempel im or-Filter falsch. Erst lesen, dann nur aendern, wenn der Wert
  // noch derselbe ist (so laedt bei zwei gleichzeitigen Aufrufen nur einer).
  const { data: alt, error: leseFehler } = await admin.from('muc_flugplan_stand').select('geladen_am').eq('id', 1).maybeSingle();
  if (leseFehler) throw new Error(`muc_flugplan_stand: ${leseFehler.message}`);
  const bisher: string | null = alt?.geladen_am ?? null;
  if (!erzwingen && !planAlt(bisher, jetzt)) return null;
  let anspruch = admin.from('muc_flugplan_stand').update({ geladen_am: jetzt.toISOString() }).eq('id', 1);
  anspruch = bisher ? anspruch.eq('geladen_am', bisher) : anspruch.is('geladen_am', null);
  const { data: geholt, error: anspruchFehler } = await anspruch.select('id');
  if (anspruchFehler) throw new Error(`muc_flugplan_stand: ${anspruchFehler.message}`);
  if (!geholt?.length) return null;

  const stand = crypto.randomUUID();
  try {
    let zeilen = 0;
    let datenstand: string | null = null;
    let seiten = 1;
    for (let ab = 1; ab <= seiten; ab += SEITEN_JE_TEIL) {
      const teil = await flightValidateAufrufen({ muc_flugplan_teil: { stand, ab, bis: ab + SEITEN_JE_TEIL - 1 } });
      seiten = Number(teil.seiten) || 0;
      zeilen += Number(teil.zeilen) || 0;
      datenstand = datenstand || teil.datenstand || null;
    }
    if (zeilen < 200) throw new Error(`plan_zu_wenig_zeilen_${zeilen}`);
    await admin.from('muc_flugplan').delete().neq('stand', stand);
    await admin.from('muc_flugplan_stand')
      .update({ geladen_am: new Date().toISOString(), datenstand, zeilen, fehler: null })
      .eq('id', 1);
    return zeilen;
  } catch (fehler) {
    await admin.from('muc_flugplan').delete().eq('stand', stand);
    // In einer Stunde nochmal versuchen.
    const nochmal = new Date(Date.now() - (PLAN_ALTER_STUNDEN - 1) * 3_600_000).toISOString();
    await admin.from('muc_flugplan_stand')
      .update({ geladen_am: nochmal, fehler: fehler instanceof Error ? fehler.message : String(fehler) })
      .eq('id', 1);
    throw fehler;
  }
};

/** Wochentag 1 (Mo) bis 7 (So) zu YYYY-MM-DD. */
const wochentag = (datum: string) => {
  const tag = new Date(`${datum}T12:00:00Z`).getUTCDay();
  return tag === 0 ? 7 : tag;
};

/**
 * Planmaessige Ankunft in MUC laut Saisonflugplan. null, wenn die Flugnummer an dem Tag nicht im Plan steht
 * (auch bei Codeshare-Nummern, die stehen nicht im Plan).
 */
export const mucAnkunftPlan = async (admin: Admin, flugnummer: unknown, datum: string): Promise<MucTreffer | null> => {
  const flug = mucFlugNorm(flugnummer);
  if (!flug || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null;
  const { data, error } = await admin.from('muc_flugplan')
    .select('flugnummer,zeit_andere,zeit_muc,tage,flughafen,gueltig_von,gueltig_bis,terminal')
    .eq('flugnummer', flug)
    .lte('gueltig_von', datum)
    .gte('gueltig_bis', datum);
  if (error) throw new Error(`muc_flugplan: ${error.message}`);
  const tag = wochentag(datum);
  const treffer = (data || []).find((z: PlanZeile) => z.tage?.[tag - 1] && z.tage[tag - 1] !== '-');
  if (!treffer) return null;
  return {
    zusammenfassung: zusammenfassungBauen({
      provider: MUC_PLAN_ANBIETER, flug, gefragt: flug, datum, herkunft: treffer.flughafen,
      statusText: null, abflug: treffer.zeit_andere?.slice(0, 5) || null, geplant: treffer.zeit_muc.slice(0, 5),
      erwartet: null, terminal: treffer.terminal, gate: null, flugzeug: null,
    }),
    codeshares: [],
    flug_id: null,
  };
};

/**
 * Erst live (gestern bis morgen), sonst Saisonflugplan. Laedt den Plan vorher neu, wenn er alt ist; Fehler beim
 * Laden halten die Suche nicht auf (dann gilt der alte Stand).
 */
export const mucAnkunft = async (
  admin: Admin,
  flugnummer: unknown,
  datum: string,
  optionen: { mitGate?: boolean; jetzt?: Date } = {},
): Promise<MucTreffer | null> => {
  const direkt = await mucAnkunftDirekt(admin, flugnummer, datum, optionen);
  if (direkt !== null) return direkt;
  // Nichts gefunden: vielleicht eine Codeshare-Nummer. Die Seite loest Codeshares nur am Flugtag auf und der
  // Saisonplan kennt sie gar nicht. Codeshares fliegen meist taeglich auf demselben Flug, darum: heute oder gestern
  // live nachschlagen (EY6070 -> LH2431) und den Hauptflug am gewuenschten Tag suchen.
  const gefragt = mucFlugNorm(flugnummer);
  if (!gefragt) return null;
  const heute = mucHeute(optionen.jetzt);
  for (const tag of [heute, tagVerschieben(heute, -1)]) {
    if (tag === datum) continue;
    let heuteLive: MucTreffer | null = null;
    try {
      heuteLive = await mucAnkunftLive(gefragt, tag, { ...optionen, mitGate: false });
    } catch {
      return null;
    }
    const haupt = heuteLive?.zusammenfassung.flight_iata;
    if (!haupt || haupt === gefragt) continue;
    const treffer = await mucAnkunftDirekt(admin, haupt, datum, optionen);
    if (!treffer) return null;
    const verkauf = teile(gefragt);
    return {
      ...treffer,
      zusammenfassung: {
        ...treffer.zusammenfassung,
        marketing_carrier: verkauf.airline,
        marketing_flight_number: verkauf.nummer,
      },
      codeshares: [...new Set([...treffer.codeshares, gefragt])],
    };
  }
  return null;
};

/** Live (gestern bis morgen) oder Saisonplan, nur fuer genau diese Nummer. */
const mucAnkunftDirekt = async (
  admin: Admin,
  flugnummer: unknown,
  datum: string,
  optionen: { mitGate?: boolean; jetzt?: Date },
): Promise<MucTreffer | null> => {
  if (mucLiveMoeglich(datum, optionen.jetzt)) {
    try {
      // Die Live-Seite ist fuer gestern bis morgen massgeblich: Findet sie den Flug nicht, fliegt er an dem Tag
      // nicht nach MUC (oder ist gestrichen), auch wenn er im Saisonplan steht.
      return await mucAnkunftLive(flugnummer, datum, optionen);
    } catch (fehler) {
      console.warn('muc live', fehler instanceof Error ? fehler.message : fehler);
    }
  }
  try {
    await mucFlugplanAuffrischen(admin);
  } catch (fehler) {
    console.warn('muc flugplan laden', fehler instanceof Error ? fehler.message : fehler);
  }
  return await mucAnkunftPlan(admin, flugnummer, datum);
};
