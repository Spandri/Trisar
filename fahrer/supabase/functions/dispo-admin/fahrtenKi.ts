// Fahrten per KI-Assistent steuern, was es bisher nur an der Fahrt selbst gab:
//   "Storniere die Fahrt von Herrn Engel"                 -> status cancelled + jobs_archive (wie Archivieren im Web)
//   "Lösche die Fahrt von Julia Weber endgültig"          -> jobs geloescht (wie Loeschen im Web)
//   "Markiere die Fahrt von Herrn Engel als erledigt"     -> status done
//   "Kopiere die Fahrt von Julia Weber auf morgen"        -> neue Fahrt mit allem, anderes Datum, ohne Fahrer
//   "Gib der Fahrt von Herrn Engel die Notiz Kindersitz"  -> job_notes (Notiz der Disposition)
//   "Welche Fahrten sind heute verspätet?"                -> Flug-Verspaetung und Fahrten, die laut Uhr schon laufen muessten
//   "Ist der Flug von Herrn Engel verspätet?", "Wann landet LH2034?" -> flight-validate
// Welche Fahrt: Gast, Fahrer, Uhrzeit, Tag aus dem Satz, sonst die zuletzt besprochene (letzteFahrtId).
// Aendern immer erst mit Rueckfrage, "ja" fuehrt aus (kontext.offeneFahrtAktion). Rueckgaengig: kontext.rueckgaengig.

// deno-lint-ignore-file no-explicit-any
import { istFahrtAuftrag } from './absicht.ts';
import { datumAusText, genannteFahrer, jetztBerlin, normal, plusTage, tagLesbar, zeitenAusText } from './dienst.ts';

const FRIST_MS = 15 * 60 * 1000;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|klar|genau|passt|mach(s|e)?( das)?|bestaetig\w*|in ordnung|gerne|bitte|los|storn\w*|loesch\w*)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht)\b/;
const hm = (t: unknown) => (t ? String(t).slice(0, 5) : '');
const FLUG_RE = /\b([A-Z0-9]{2}|[A-Z]{3})\s?(\d{1,4}[A-Z]?)\b/;

type Fahrt = { id: string; datum: string; zeit: string; start: string; ziel: string; status: string; fahrer: string; gaeste: string[]; flug: string; driverId: string | null };

const ohne = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offeneFahrtAktion;
  return k;
};
const fahrtText = (f: Fahrt, heute: string) => `${tagLesbar(f.datum, heute)} ${f.zeit} ${f.start} → ${f.ziel}${f.gaeste.length ? `, ${f.gaeste.join(', ')}` : ''}${f.fahrer ? `, ${f.fahrer}` : ''}`;

// Fahrten mit Gaesten und Fahrernamen laden.
const fahrtenLaden = async (admin: any, von: string, bis: string): Promise<Fahrt[]> => {
  const { data } = await admin.from('jobs').select('id, ride_date, etd, pickup_name, dropoff_name, status, driver_id, flight_number')
    .gte('ride_date', von).lte('ride_date', bis).order('ride_date', { ascending: true });
  const jobs = Array.isArray(data) ? data : [];
  if (!jobs.length) return [];
  const { data: jg } = await admin.from('job_guests').select('job_id, guest_id').in('job_id', jobs.map((j: any) => j.id));
  const gIds = [...new Set((Array.isArray(jg) ? jg : []).map((x: any) => String(x.guest_id)))];
  const { data: g } = gIds.length ? await admin.from('guests').select('id, first_name, last_name').in('id', gIds) : { data: [] };
  const gName = new Map((Array.isArray(g) ? g : []).map((x: any) => [String(x.id), `${x.first_name || ''} ${x.last_name || ''}`.trim()]));
  const dIds = [...new Set(jobs.map((j: any) => j.driver_id).filter(Boolean).map(String))];
  const { data: p } = dIds.length ? await admin.from('profiles').select('id, first_name, last_name').in('id', dIds) : { data: [] };
  const pName = new Map((Array.isArray(p) ? p : []).map((x: any) => [String(x.id), [x.first_name, x.last_name].filter(Boolean).join(' ')]));
  return jobs.map((j: any) => ({
    id: String(j.id), datum: String(j.ride_date).slice(0, 10), zeit: hm(j.etd), start: String(j.pickup_name || '?'), ziel: String(j.dropoff_name || '?'),
    status: String(j.status || ''), driverId: j.driver_id ? String(j.driver_id) : null, fahrer: j.driver_id ? pName.get(String(j.driver_id)) || '' : '',
    flug: String(j.flight_number || ''),
    gaeste: (Array.isArray(jg) ? jg : []).filter((x: any) => String(x.job_id) === String(j.id)).map((x: any) => gName.get(String(x.guest_id)) || '').filter(Boolean),
  }));
};

// Die gemeinte Fahrt. Liefert { fahrt } oder { antwort } (keine/mehrere).
const fahrtFinden = async (admin: any, text: string, letzteFahrtId: string | null, nurOffen = true) => {
  const { datum: heute } = jetztBerlin();
  const hatTag = /\b(heute|morgen|uebermorgen|gestern|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b|\b[0-3]?\d\.[01]?\d\./.test(text);
  const tag = hatTag ? (/\bgestern\b/.test(text) ? plusTage(heute, -1) : datumAusText(text, heute)) : null;
  let liste = await fahrtenLaden(admin, tag || plusTage(heute, -1), tag || plusTage(heute, 60));
  if (nurOffen) liste = liste.filter((f) => !['cancelled', 'done'].includes(f.status));
  const wort = (w: string) => w.length >= 3 && new RegExp(`\\b${normal(w).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(text);
  // Gast: voller Name oder Nachname ("Herrn Engel").
  const nachGast = liste.filter((f) => f.gaeste.some((g) => wort(g) || wort(g.split(' ').slice(-1)[0] || '')));
  const fahrer = await genannteFahrer(admin, text);
  const nachFahrer = fahrer.length ? liste.filter((f) => f.driverId && fahrer.some((x) => x.id === f.driverId)) : [];
  let treffer = nachGast.length ? nachGast : nachFahrer;
  if (nachGast.length && nachFahrer.length) treffer = nachGast.filter((f) => nachFahrer.includes(f)) .length ? nachGast.filter((f) => nachFahrer.includes(f)) : nachGast;
  const zeiten = zeitenAusText(text).map((z) => z.zeit);
  if (zeiten.length && treffer.length > 1) {
    const mitZeit = treffer.filter((f) => zeiten.includes(f.zeit));
    if (mitZeit.length) treffer = mitZeit;
  }
  if (!treffer.length && !nachGast.length && !fahrer.length && zeiten.length) treffer = liste.filter((f) => zeiten.includes(f.zeit));
  if (!treffer.length && letzteFahrtId && /\b(die|diese|der)\s+fahrt\b/.test(text) && !nachGast.length && !fahrer.length) {
    const alle = await fahrtenLaden(admin, plusTage(heute, -30), plusTage(heute, 365));
    const f = alle.find((x) => x.id === letzteFahrtId);
    if (f) treffer = [f];
  }
  if (!treffer.length) return { antwort: 'Diese Fahrt finde ich nicht. Nenne Gast, Fahrer, Tag oder Uhrzeit, z. B. „die Fahrt von Herrn Engel morgen um 10:30“.' };
  if (treffer.length > 1) {
    return { antwort: `Mehrere Fahrten passen:\n${treffer.slice(0, 6).map((f) => `- ${fahrtText(f, heute)}`).join('\n')}\nNenne noch Tag oder Uhrzeit.` };
  }
  return { fahrt: treffer[0] };
};

// ---- Ausfuehren ----

const ausfuehren = async (admin: any, a: any): Promise<{ text: string; rueckgaengig?: any }> => {
  if (a.art === 'storno') {
    const { data: alt } = await admin.from('jobs').select('status').eq('id', a.id).maybeSingle();
    const { error } = await admin.from('jobs').update({ status: 'cancelled' }).eq('id', a.id);
    if (error) return { text: `Nicht storniert (${error.message}).` };
    await admin.from('jobs_archive').insert({ job_id: a.id, archived_by: 'ki-assistent', snapshot: { rideId: a.id, quelle: 'ki', text: a.titel } });
    return { text: `Storniert: ${a.titel}.`, rueckgaengig: { art: 'storno', id: a.id, status: alt?.status || 'pending', text: `Stornierung von ${a.titel}` } };
  }
  if (a.art === 'loeschen') {
    const { error } = await admin.from('jobs').delete().eq('id', a.id);
    return { text: error ? `Nicht gelöscht (${error.message}).` : `Gelöscht: ${a.titel}. Das lässt sich nicht rückgängig machen.` };
  }
  if (a.art === 'erledigt') {
    const { data: alt } = await admin.from('jobs').select('status').eq('id', a.id).maybeSingle();
    const { error } = await admin.from('jobs').update({ status: 'done' }).eq('id', a.id);
    return error ? { text: `Nicht geändert (${error.message}).` }
      : { text: `Erledigt: ${a.titel}.`, rueckgaengig: { art: 'feld', tabelle: 'jobs', id: a.id, alt: { status: alt?.status || 'assigned' }, text: `Erledigt-Markierung von ${a.titel}` } };
  }
  if (a.art === 'kopieren') {
    const { data: quelle } = await admin.from('jobs').select('*').eq('id', a.id).maybeSingle();
    if (!quelle) return { text: 'Die Fahrt gibt es nicht mehr.' };
    const { id: _i, created_at: _c, updated_at: _u, ...kopie } = quelle;
    // Neuer Tag, neu zu vergeben, ohne Altlasten aus Flug- und Routenabgleich.
    Object.assign(kopie, { ride_date: a.datum, status: 'pending', driver_id: null, driver_response_status: null, driver_responded_at: null,
      refusal_reason: null, refused_by_driver_id: null, original_etd: null, ext_flight_payload: null, ext_flight_last_sync_at: null });
    const { data: neu, error } = await admin.from('jobs').insert(kopie).select('id').single();
    if (error || !neu?.id) return { text: `Nicht kopiert (${error?.message || 'unbekannt'}).` };
    const { data: jg } = await admin.from('job_guests').select('guest_id, is_main_contact').eq('job_id', a.id);
    if (Array.isArray(jg) && jg.length) await admin.from('job_guests').insert(jg.map((x: any) => ({ job_id: neu.id, guest_id: x.guest_id, is_main_contact: x.is_main_contact })));
    return { text: `Kopiert auf ${tagLesbar(a.datum, jetztBerlin().datum)}, noch ohne Fahrer.`, rueckgaengig: { art: 'neu', tabelle: 'jobs', id: String(neu.id), text: `Kopie von ${a.titel}` } };
  }
  if (a.art === 'notiz') {
    const { data: neu, error } = await admin.from('job_notes').insert({ job_id: a.id, note_text: a.notiz }).select('id').single();
    return error ? { text: `Notiz nicht gespeichert (${error.message}).` }
      : { text: `Notiz gespeichert: „${a.notiz}“.`, rueckgaengig: { art: 'neu', tabelle: 'job_notes', id: String(neu?.id || ''), text: `Notiz „${a.notiz}“` } };
  }
  return { text: 'Unbekannte Aktion.' };
};

// Rueckgaengig fuer Fahrten (von steuernKi.ts aufgerufen).
export const fahrtRueckgaengig = async (admin: any, r: any): Promise<string | null> => {
  if (r?.art !== 'storno') return null;
  const { error } = await admin.from('jobs').update({ status: r.status }).eq('id', r.id);
  await admin.from('jobs_archive').delete().eq('job_id', r.id);
  return error ? `Nicht rückgängig gemacht (${error.message}).` : `Rückgängig gemacht: ${r.text}.`;
};

// ---- Fluege ----

const flugAbfragen = async (nummer: string, datum: string) => {
  const url = Deno.env.get('SUPABASE_URL');
  const schluessel = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !schluessel) return null;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/functions/v1/flight-validate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${schluessel}`, apikey: schluessel, 'Content-Type': 'application/json' },
      body: JSON.stringify({ flight_number: nummer.replace(/\s+/g, '').toUpperCase(), ride_date: datum, require_lufthansa_group: false }),
      signal: AbortSignal.timeout(15000),
    });
    return await r.json().catch(() => null);
  } catch {
    return null;
  }
};
const uhrAus = (iso: unknown) => {
  const m = String(iso || '').match(/T(\d{2}:\d{2})/) || String(iso || '').match(/\b(\d{2}:\d{2})\b/);
  return m ? m[1] : '';
};
const flugText = (nummer: string, d: any, tag: string) => {
  if (!d?.valid) {
    const grund = d?.reason === 'flight_not_found' ? 'nicht gefunden' : String(d?.message || 'Abfrage gerade nicht möglich');
    return `Flug ${nummer} ${tag}: ${grund}. Kostenlos sehe ich Flüge meist erst am Flugtag.`;
  }
  const s = d.summary || {};
  const plan = uhrAus(s.scheduled_arrival_local);
  const erwartet = uhrAus(s.actual_arrival_local || s.estimated_arrival_local);
  const versp = Number(s.delay_minutes);
  const teile = [
    plan ? `planmäßig ${plan}` : '',
    erwartet && erwartet !== plan ? `${s.actual_arrival_local ? 'gelandet' : 'erwartet'} ${erwartet}` : '',
    Number.isFinite(versp) && versp > 0 ? `${versp} Minuten Verspätung` : (Number.isFinite(versp) ? 'pünktlich' : ''),
    s.arrival_terminal ? `Terminal ${s.arrival_terminal}` : '',
    s.arrival_gate ? `Gate ${s.arrival_gate}` : '',
  ].filter(Boolean);
  return `Flug ${nummer} ${tag}: ${teile.join(', ') || 'gefunden, aber ohne Zeiten'}.`;
};

export const fahrtenSteuern = async (admin: any, frage: string, kontext: any, letzteFahrtId: string | null) => {
  const roh = String(frage || '').trim();
  const text = normal(roh);
  const { datum: heute } = jetztBerlin();

  const offen = kontext?.offeneFahrtAktion;
  if (offen && Date.now() - Number(offen.zeit || 0) < FRIST_MS && roh.length <= 40 && !/\?/.test(roh)) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts geändert.', kontext: ohne(kontext) };
    // Endgueltig loeschen nur mit "löschen", nicht mit "ja".
    const bestaetigt = offen.art === 'loeschen' ? /^\s*(ja[,!.]?\s+)?(endgueltig\s+)?loesch\w*/.test(text) : JA_RE.test(text);
    if (bestaetigt) {
      const r = await ausfuehren(admin, offen);
      const k = ohne(kontext);
      if (r.rueckgaengig) k.rueckgaengig = { ...r.rueckgaengig, zeit: Date.now() };
      return { answer: r.text, kontext: k };
    }
    if (offen.art === 'loeschen' && JA_RE.test(text)) return { answer: 'Zum endgültigen Löschen schreib „löschen“. Mit „nein“ breche ich ab.', kontext };
  }

  // Flug direkt: "Wann landet LH2034?", "Ist LH 2034 heute verspätet?"
  const flugDirekt = roh.match(FLUG_RE);
  if (flugDirekt && /\b(landet|landung|ankunft|verspaet\w*|flug|startet|status|gelandet|puenktlich)\b/.test(text) && !/\b(buch\w*|fahrt)\b/.test(text)) {
    const nummer = `${flugDirekt[1]}${flugDirekt[2]}`.toUpperCase();
    const tag = /\b(heute|morgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b|\b[0-3]?\d\.[01]?\d\./.test(text) ? datumAusText(text, heute) : heute;
    return { answer: flugText(nummer, await flugAbfragen(nummer, tag), tagLesbar(tag, heute)), kontext };
  }

  // Flug einer Fahrt: "Ist der Flug von Herrn Engel verspätet?"
  if (/\bflug\b/.test(text) && /\b(verspaet\w*|landet|puenktlich|status|wann)\b/.test(text) && !istFahrtAuftrag(roh) && !/\bbuch\w*/.test(text)) {
    const r = await fahrtFinden(admin, text, letzteFahrtId);
    if (r.antwort) return { answer: r.antwort, kontext };
    const f = r.fahrt!;
    if (!f.flug) return { answer: `Für die Fahrt ${fahrtText(f, heute)} ist keine Flugnummer eingetragen.`, kontext };
    return { answer: flugText(f.flug, await flugAbfragen(f.flug, f.datum), tagLesbar(f.datum, heute)), kontext };
  }

  // "Welche Fahrten sind (heute) verspätet?"
  if (/\bfahrt\w*\b/.test(text) && /\b(verspaet\w*|zu spaet|ueberfaellig|hinten dran)\b/.test(text) && /^\s*(welche\w*|gibt|sind|ist|wer|zeig\w*)\b/.test(text)) {
    const tag = datumAusText(text, heute);
    const liste = (await fahrtenLaden(admin, tag, tag)).filter((f) => !['cancelled', 'done'].includes(f.status));
    const { data } = await admin.from('jobs').select('id, status, etd, original_etd, ext_flight_payload').in('id', liste.map((f) => f.id));
    const jetzt = jetztBerlin().minuten;
    const zuMin = (z: string) => Number(z.slice(0, 2)) * 60 + Number(z.slice(3, 5));
    const zeilen: string[] = [];
    for (const f of liste) {
      const j = (Array.isArray(data) ? data : []).find((x: any) => String(x.id) === f.id) || {};
      const versp = Number(j?.ext_flight_payload?.summary?.delay_minutes ?? j?.ext_flight_payload?.delay_minutes);
      if (Number.isFinite(versp) && versp >= 15) { zeilen.push(`- ${fahrtText(f, heute)}: Flug ${f.flug} ${versp} Minuten später`); continue; }
      if (j?.original_etd && hm(j.original_etd) !== f.zeit) { zeilen.push(`- ${fahrtText(f, heute)}: von ${hm(j.original_etd)} auf ${f.zeit} verschoben`); continue; }
      // Heute: Abfahrt mehr als 10 Minuten vorbei und noch nicht gestartet.
      if (tag === heute && f.zeit && zuMin(f.zeit) + 10 < jetzt && ['pending', 'assigned'].includes(f.status)) {
        zeilen.push(`- ${fahrtText(f, heute)}: Abfahrt vorbei, noch nicht gestartet`);
      }
    }
    return { answer: zeilen.length ? `Verspätet ${tagLesbar(tag, heute)} (${zeilen.length}):\n${zeilen.join('\n')}` : `${tagLesbar(tag, heute).replace(/^./, (c) => c.toUpperCase())} ist keine Fahrt verspätet.`, kontext };
  }

  // Fahrten eines Kunden (Firma der Gaeste): "Welche Fahrten hatte der Kunde BMW diesen Monat?"
  const kunde = roh.match(/\b(?:Kunden?|Firma|Auftraggeber)\s+([A-ZÄÖÜ0-9][\w&.-]*(?:\s+[A-ZÄÖÜ][\w&.-]*)?)/)?.[1];
  if (kunde && /\bfahrt\w*\b/.test(text) && (/^\s*(welche\w*|wie viele|wieviele|zeig\w*|liste\w*|hat|hatte)\b/.test(text) || /\?\s*$/.test(roh))) {
    const monat = /\b(diesen|dieser|im)\s+monat\b/.test(text);
    const vorMonat = /\b(letzten|letzter|vorigen)\s+monat\b/.test(text);
    const von = vorMonat ? plusTage(`${heute.slice(0, 8)}01`, -1).slice(0, 8) + '01' : monat ? `${heute.slice(0, 8)}01` : plusTage(heute, -30);
    const bis = vorMonat ? plusTage(`${heute.slice(0, 8)}01`, -1) : monat ? plusTage(`${heute.slice(0, 8)}01`, 40).slice(0, 8) + '01' : plusTage(heute, 60);
    const { data: g } = await admin.from('guests').select('id, company').ilike('company', `%${kunde.split(' ')[0]}%`);
    const gIds = (Array.isArray(g) ? g : []).map((x: any) => String(x.id));
    if (!gIds.length) return { answer: `Ich finde keine Gäste mit der Firma ${kunde}.`, kontext };
    const { data: jg } = await admin.from('job_guests').select('job_id').in('guest_id', gIds);
    const jobIds = new Set((Array.isArray(jg) ? jg : []).map((x: any) => String(x.job_id)));
    const liste = (await fahrtenLaden(admin, von, bis)).filter((f) => jobIds.has(f.id) && f.datum < (monat ? bis : '9999'));
    const zeitraum = monat ? 'diesen Monat' : vorMonat ? 'letzten Monat' : 'zuletzt und demnächst';
    if (!liste.length) return { answer: `${kunde}: ${zeitraum} keine Fahrten.`, kontext };
    return { answer: `${kunde}, ${zeitraum}: ${liste.length} Fahrt${liste.length === 1 ? '' : 'en'}\n${liste.slice(0, 15).map((f) => `- ${fahrtText(f, heute)}${f.status === 'cancelled' ? ' (storniert)' : ''}`).join('\n')}`, kontext };
  }

  // Auftraege an einer Fahrt
  if (!/\bfahrt\b|\bbuchung\b|\babholung\b/.test(text)) return null;
  const art = /\b(endgueltig|komplett|ganz)\b.*\bloesch\w*|\bloesch\w*\b.*\b(endgueltig|komplett|ganz)\b/.test(text) ? 'loeschen'
    : /\b(storn\w*|absag\w*|loesch\w*|streich\w*|cancel\w*)\b/.test(text) ? 'storno'
    : /\b(erledigt|abgeschlossen|beendet|fertig)\b/.test(text) && /\b(markier\w*|setz\w*|mach\w*|als|ist)\b/.test(text) ? 'erledigt'
    : /\b(kopier\w*|duplizier\w*|wiederhol\w*|nochmal)\b/.test(text) ? 'kopieren'
    : /\b(notiz|vermerk|hinweis)\b/.test(text) && /\b(gib|setz\w*|schreib\w*|trag\w*|fueg\w*|mach\w*|notier\w*|mit)\b/.test(text) ? 'notiz'
    : null;
  if (!art) return null;
  if (/\?\s*$/.test(roh)) return null;
  // Beim Kopieren ist der genannte Tag das Ziel ("auf übermorgen"), nicht der Tag der Fahrt.
  const suchText = art === 'kopieren' ? text.replace(/\b(auf|fuer|nach|zum|am)\s+(den\s+)?(heute|morgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|[0-3]?\d\.[01]?\d\.(\d{4})?)/g, ' ') : text;
  const r = await fahrtFinden(admin, suchText, letzteFahrtId, art !== 'loeschen');
  if (r.antwort) return { answer: r.antwort, kontext };
  const f = r.fahrt!;
  const titel = fahrtText(f, heute);
  const neu = (x: any, frageText: string) => ({ answer: frageText, kontext: { ...ohne(kontext), offeneFahrtAktion: { ...x, id: f.id, titel, zeit: Date.now() } } });
  if (art === 'storno') return neu({ art }, `Fahrt ${titel} stornieren? Mit „ja“ storniere ich sie, rückgängig geht danach mit „rückgängig“.`);
  if (art === 'loeschen') return neu({ art }, `Fahrt ${titel} endgültig löschen? Das geht nicht rückgängig, stornieren wäre die sanfte Variante. Schreib „löschen“, dann lösche ich sie.`);
  if (art === 'erledigt') return neu({ art }, `Fahrt ${titel} als erledigt markieren? Mit „ja“ speichere ich es.`);
  if (art === 'kopieren') {
    // Ziel ist der Tag nach "auf" ("auf den 15.11.2026", "auf Freitag"), sonst der genannte Tag.
    const aufM = text.match(/\bauf\s+(?:den\s+)?(heute|morgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|[0-3]?\d\.[01]?\d\.(?:\d{4})?)/);
    const ziel = aufM ? datumAusText(` ${aufM[1]} `, heute) : /\b(heute|morgen|uebermorgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b|\b[0-3]?\d\.[01]?\d\./.test(text.replace(/\bvon\s+(heute|gestern)\b/, ' '))
      ? datumAusText(text.replace(/\bvon\s+(heute|gestern)\b/, ' '), heute) : null;
    if (!ziel) return { answer: 'Auf welchen Tag soll ich die Fahrt kopieren? Zum Beispiel „Kopiere die Fahrt von Herrn Engel auf Freitag“.', kontext };
    return neu({ art, datum: ziel }, `Fahrt ${titel} auf ${tagLesbar(ziel, heute)} kopieren, gleiche Uhrzeit, noch ohne Fahrer? Mit „ja“ lege ich die Kopie an.`);
  }
  const nachDoppelpunkt = roh.includes(':') ? roh.slice(roh.lastIndexOf(':') + 1).trim().replace(/^["„]|["“”]$/g, '') : '';
  const notiz = nachDoppelpunkt || roh.match(/(?:notiz|vermerk|hinweis)\s*(?:[:„"]\s*)?(.+?)["“”]?\s*$/i)?.[1]?.replace(/^(geben|setzen|hinzufügen|schreiben)\s+/i, '').trim();
  if (!notiz || notiz.length < 2) return { answer: 'Was soll in der Notiz stehen? Zum Beispiel „Notiz zur Fahrt von Herrn Engel: Kindersitz“.', kontext };
  return neu({ art, notiz }, `Notiz „${notiz}“ zur Fahrt ${titel}? Mit „ja“ speichere ich sie, der Fahrer sieht sie in der App.`);
};
