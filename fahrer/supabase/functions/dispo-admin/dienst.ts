// Dienste per KI-Assistent: Dienststart, Pause und Dienstende fuer Fahrer.
//
// Erkennt Saetze wie
//   "schick die alle in Feierabend"              (markierte Fahrer, Dienstende jetzt)
//   "Schick Stefano heute 00:30"                 (Dienststart)
//   "Dienst fuer Stefano morgen 7 bis 15 Uhr"    (Start und Ende)
//   "Stefano Pause von 12 bis 12:30"             (Pause im Dienst des Tages)
//   "Anna und Fahrer 12 Dienstende Freitag 18 Uhr"
// Fahrer: im Text genannte Namen oder Fahrernummern, sonst die auf der Karte markierten.
// Antwort ohne Modell als Vorschlag (action.type 'dienst_vorschlag'); erst der Knopf in
// der App schickt ihn ab, mit aktion 'dienst_senden'. Geht auch, wenn das Modell aus ist.
//
// dienst_senden schreibt dasselbe wie "Dienste planen": je Fahrer und Tag eine Anfrage in
// driver_service_requests (nur was gesetzt ist), die Zeit am Profil, Pausen in dienst_pausen.
// Nur eine Pause ohne Start/Ende haengt an der juengsten Anfrage des Fahrers fuer den Tag.

// deno-lint-ignore-file no-explicit-any

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UHRZEIT = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const DISPO_ROLLEN = new Set(['dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator', 'pruefung']);

type Fahrer = { id: string; name: string };
type Pause = { von: string; bis: string };

export const normal = (text: string) => ` ${String(text || '').toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9:.\-– ]+/g, ' ')
  .replace(/\s+/g, ' ')} `;

const ENDE_RE = /feierabend|dienstende|dienst\s*(be)?enden|schicht\s*ende|nach\s*hause|heim\s*schick|heimfahren|schluss\s+machen|ausstempeln|\bende\b/;
const START_RE = /dienststart|dienstbeginn|dienst\s*(be)?ginnen|dienst\s+starten|anfangen|einstempeln|in\s+den\s+dienst|\bstart\b|\bbeginn\b|\banfang\b|\bfaengt\b|\bbeginnt\b/;
const DIENST_RE = /dienst|schicht|feierabend|pause|stempel/;
const SCHICK_RE = /\b(schick|schicke|schickt|sende|setz|setze|plan|plane)\b/;
// Ohne Dienst-Wort klingt "schick X um 10 zum Flughafen" nach einer Fahrt, nicht nach einem Dienst.
const FAHRT_RE = /fahrt|buch|abhol|flughafen|terminal|hotel|bahnhof|\bzum\b|\bzur\b|\bnach\b|gast|gaeste/;

// Datum und Uhrzeit in Deutschland.
export const jetztBerlin = () => {
  const teile = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((t) => [t.type, t.value]));
  return { datum: `${teile.year}-${teile.month}-${teile.day}`, minuten: Number(teile.hour) * 60 + Number(teile.minute) };
};
export const plusTage = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const uhr = (min: number) => {
  const x = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
const zuMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const tagLesbar = (iso: string, heute: string) => {
  if (iso === heute) return 'heute';
  if (iso === plusTage(heute, 1)) return 'morgen';
  const d = new Date(`${iso}T12:00:00Z`);
  return `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][d.getUTCDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
};

const WOCHENTAGE = ['sonntag', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag'];
// heute, morgen, uebermorgen, Wochentag (naechster, heute eingeschlossen), 14.11. / 14.11.2026
export const datumAusText = (text: string, heute: string) => {
  if (/\buebermorgen\b/.test(text)) return plusTage(heute, 2);
  if (/\bmorgen\b/.test(text)) return plusTage(heute, 1);
  const tagMonat = text.match(/\b([0-3]?\d)\.([01]?\d)\.(\d{4})?/);
  if (tagMonat) {
    const jahr = tagMonat[3] ? Number(tagMonat[3]) : Number(heute.slice(0, 4));
    let iso = `${jahr}-${String(tagMonat[2]).padStart(2, '0')}-${String(tagMonat[1]).padStart(2, '0')}`;
    if (!tagMonat[3] && iso < heute) iso = `${jahr + 1}${iso.slice(4)}`;
    if (DATUM.test(iso)) return iso;
  }
  const heuteTag = new Date(`${heute}T12:00:00Z`).getUTCDay();
  for (let i = 0; i < 7; i += 1) {
    if (new RegExp(`\\b${WOCHENTAGE[i]}\\b`).test(text)) return plusTage(heute, (i - heuteTag + 7) % 7);
  }
  return heute;
};

// Alle Uhrzeiten mit Position: "12:30", "12.30", "12 uhr", "um 7", "halb 8".
// Datumsangaben wie "14.11." werden vorher entfernt.
export const zeitenAusText = (text: string) => {
  const ohneDatum = text.replace(/\b[0-3]?\d\.[01]?\d\.(\d{4})?/g, (m) => ' '.repeat(m.length));
  const treffer: { pos: number; zeit: string }[] = [];
  const H = '([01]?\\d|2[0-3])';
  const M = '(?:[:.]([0-5]\\d))?';
  // Bereich zuerst: "7-15", "07:00 bis 15:30", "von 8 bis 16 uhr"
  const bereich = new RegExp(`\\b${H}${M}\\s*(?:uhr\\s*)?(?:-|–|bis)\\s*${H}${M}\\b`, 'g');
  const belegt: [number, number][] = [];
  let m: RegExpExecArray | null;
  while ((m = bereich.exec(ohneDatum))) {
    treffer.push({ pos: m.index, zeit: uhr(Number(m[1]) * 60 + Number(m[2] || 0)) });
    treffer.push({ pos: m.index + 1, zeit: uhr(Number(m[3]) * 60 + Number(m[4] || 0)) });
    belegt.push([m.index, m.index + m[0].length]);
  }
  const frei = (von: number, bis: number) => !belegt.some(([a, b]) => von < b && bis > a);
  // "morgen frueh 7": Zahl nach frueh/vormittags zaehlt als Uhrzeit.
  const einzel = new RegExp(`\\bhalb\\s+${H}\\b|\\b${H}[:.]([0-5]\\d)\\b|\\b${H}\\s*uhr\\b|\\b(?:um|ab|von|bis|gegen|frueh|vormittags)\\s+${H}${M}\\b`, 'g');
  while ((m = einzel.exec(ohneDatum))) {
    if (!frei(m.index, m.index + m[0].length)) continue;
    let min: number;
    if (m[1]) min = (Number(m[1]) - 1) * 60 + 30;
    else if (m[2]) min = Number(m[2]) * 60 + Number(m[3]);
    else if (m[4]) min = Number(m[4]) * 60;
    else min = Number(m[5]) * 60 + Number(m[6] || 0);
    treffer.push({ pos: m.index, zeit: uhr(min) });
  }
  return treffer.sort((x, y) => x.pos - y.pos);
};
// "in 30 min", "in einer stunde" relativ zu jetzt.
const relativeZeit = (text: string, jetzt: number) => {
  const inMin = text.match(/\bin\s+(\d{1,3})\s*(min|minuten)\b/);
  if (inMin) return uhr(jetzt + Number(inMin[1]));
  const inStd = text.match(/\bin\s+(einer|\d{1,2})\s*(std|stunde|stunden)\b/);
  if (inStd) return uhr(jetzt + (inStd[1] === 'einer' ? 1 : Number(inStd[1])) * 60);
  return null;
};

export const markierteFahrer = (body: any): Fahrer[] => (Array.isArray(body?.markierteFahrer) ? body.markierteFahrer : [])
  .slice(0, 100)
  .map((f: any) => ({ id: String(f?.id || '').trim().toLowerCase(), name: String(f?.name || '').trim().slice(0, 80) }))
  .filter((f: any) => UUID.test(f.id));

// Fahrer, die im Text mit Namen oder Nummer genannt sind.
export const genannteFahrer = async (admin: any, text: string): Promise<Fahrer[]> => {
  const { data, error } = await admin.from('profiles').select('id, first_name, last_name, driver_number, role');
  if (error || !Array.isArray(data)) return [];
  const fahrer = data
    .filter((p: any) => !DISPO_ROLLEN.has(String(p?.role || '').toLowerCase()))
    .map((p: any) => ({
      id: String(p.id),
      name: [p.first_name, p.last_name].filter(Boolean).join(' ').trim(),
      vor: normal(p.first_name).trim(),
      nach: normal(p.last_name).trim(),
      nr: p.driver_number == null ? '' : String(p.driver_number).trim(),
    }));
  const enthaelt = (wort: string) => wort.length >= 2 && new RegExp(`\\b${wort.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text);
  const gefunden = new Map<string, Fahrer>();
  for (const f of fahrer) {
    const voll = `${f.vor} ${f.nach}`.trim();
    if (voll.includes(' ') && enthaelt(voll)) gefunden.set(f.id, { id: f.id, name: f.name });
  }
  // Vor- oder Nachname allein nur, wenn er eindeutig ist.
  for (const feld of ['vor', 'nach'] as const) {
    const zaehler = new Map<string, number>();
    fahrer.forEach((f: any) => f[feld] && zaehler.set(f[feld], (zaehler.get(f[feld]) || 0) + 1));
    for (const f of fahrer) {
      if (gefunden.has(f.id) || !f[feld] || zaehler.get(f[feld]) !== 1) continue;
      if (enthaelt(f[feld])) gefunden.set(f.id, { id: f.id, name: f.name });
    }
  }
  for (const m of text.matchAll(/\b(?:fahrer|nr|nummer)\s*(\d{1,4})\b/g)) {
    const f = fahrer.find((x: any) => x.nr === m[1]);
    if (f) gefunden.set(f.id, { id: f.id, name: f.name });
  }
  return [...gefunden.values()];
};

type Bestehend = { id: string; start: string | null; ende: string | null; status: string };

// Juengster Dienst je Fahrer an dem Tag, der noch gilt (offen oder angenommen).
const bestehendeDienste = async (admin: any, ids: string[], datum: string) => {
  const ergebnis = new Map<string, Bestehend>();
  if (!ids.length) return ergebnis;
  const { data, error } = await admin.from('driver_service_requests')
    .select('id, driver_id, service_start_time, service_end_time, status, created_at')
    .in('driver_id', ids).eq('service_date', datum).in('status', ['pending', 'accepted'])
    .order('created_at', { ascending: false });
  if (error || !Array.isArray(data)) return ergebnis;
  for (const d of data) {
    const id = String(d.driver_id);
    if (ergebnis.has(id)) continue;
    ergebnis.set(id, {
      id: String(d.id),
      start: d.service_start_time ? String(d.service_start_time).slice(0, 5) : null,
      ende: d.service_end_time ? String(d.service_end_time).slice(0, 5) : null,
      status: String(d.status),
    });
  }
  return ergebnis;
};

const dienstText = (b: Bestehend) => {
  const zeit = b.start && b.ende ? `${b.start}–${b.ende}` : (b.start ? `ab ${b.start}` : `bis ${b.ende}`);
  return `${zeit}${b.status === 'accepted' ? ', angenommen' : ', noch nicht bestätigt'}`;
};

// Was eine Angabe bei schon vorhandenem Dienst bedeutet. Ein einzelner "Start" nach dem
// Dienstbeginn ist meist das Ende, in der Nacht (vor 06:00) ebenso; mitten im Dienst eine Pause.
const aufVorhandenen = (b: Bestehend, start: string | null, ende: string | null, pausen: Pause[]) => {
  if (!start || ende || pausen.length) return { start, ende, pausen, frage: '' };
  const t = zuMin(start);
  if (b.start && t === zuMin(b.start)) return null; // gleicher Start: nichts zu tun
  if (b.start && !b.ende) {
    if (t > zuMin(b.start) || t < 6 * 60) return { start: null, ende: start, pausen, frage: `${start} als Dienstende?` };
    return { start, ende: null, pausen, frage: `Dienststart von ${b.start} auf ${start} vorverlegen?` };
  }
  if (b.start && b.ende) {
    if (t < zuMin(b.start) && t >= 6 * 60) return { start, ende: null, pausen, frage: `Dienststart von ${b.start} auf ${start} vorverlegen?` };
    if (t > zuMin(b.ende) || t < 6 * 60) return { start: null, ende: start, pausen, frage: `Dienstende von ${b.ende} auf ${start} verschieben?` };
    const bis = uhr(t + 30);
    return { start: null, ende: null, pausen: [{ von: start, bis }], frage: `${start}–${bis} als Pause?` };
  }
  // nur Ende vorhanden
  if (b.ende && t < zuMin(b.ende)) return { start, ende: null, pausen, frage: `${start} als Dienststart?` };
  return { start: null, ende: start, pausen, frage: `Dienstende von ${b.ende} auf ${start} verschieben?` };
};

// Vorschlag, wenn die Frage einen Dienst (Start, Pause, Ende) fuer Fahrer meint. Sonst null.
export const dienstVorschlag = async (admin: any, frage: string, markiert: Fahrer[]) => {
  const text = normal(frage);
  // Fragen ("Wann faengt Tim an?") sind keine Dienst-Auftraege.
  if (/^(wann|wer|wie|was|welche|welcher|welches|wo|ob|hat|ist|sind)\b/.test(text.trim())) return null;
  const hatDienstWort = DIENST_RE.test(text) || ENDE_RE.test(text) || START_RE.test(text);
  // "Tim und Marvin morgen 6 bis 14": Zeitspanne mit Fahrernamen ohne Fahrt-Woerter ist ein Dienst.
  const nurSpanne = !hatDienstWort && !SCHICK_RE.test(text) && !FAHRT_RE.test(text)
    && /\b\d{1,2}([:.]\d{2})?\s*(uhr\s*)?(-|–|bis)\s*\d{1,2}/.test(text);
  if (!hatDienstWort && !SCHICK_RE.test(text) && !nurSpanne) return null;
  if (!hatDienstWort && FAHRT_RE.test(text)) return null;

  const genannt = await genannteFahrer(admin, text);
  if (nurSpanne && !genannt.length) return null;
  const fahrer = genannt.length ? genannt : markiert;
  if (!fahrer.length) return null;

  const { datum: heute, minuten: jetzt } = jetztBerlin();
  const datum = datumAusText(text, heute);
  const zeiten = zeitenAusText(text);

  // Pause: Zeiten nach dem Wort "pause" (bis zum naechsten Dienst-Wort).
  const pausen: Pause[] = [];
  const pausenPos = text.search(/\bpause/);
  let restZeiten = zeiten;
  if (pausenPos >= 0) {
    const naechstes = text.slice(pausenPos + 5).search(/dienst|start|beginn|ende|feierabend|anfang/);
    const pausenEnde = naechstes >= 0 ? pausenPos + 5 + naechstes : text.length;
    const inPause = zeiten.filter((z) => z.pos > pausenPos && z.pos < pausenEnde);
    restZeiten = zeiten.filter((z) => !(z.pos > pausenPos && z.pos < pausenEnde));
    if (inPause.length) {
      const von = inPause[0].zeit;
      const dauer = text.slice(pausenPos).match(/\b(\d{1,3})\s*(min|minuten)\b/);
      const bis = inPause[1]?.zeit || uhr(zuMin(von) + (dauer ? Number(dauer[1]) : 30));
      pausen.push({ von, bis });
    }
  }

  let start: string | null = null;
  let ende: string | null = null;
  const relativ = relativeZeit(text, jetzt);
  const bereich = /\d\s*(?:-|–|bis)\s*\d|\bvon\b.*\bbis\b/.test(text) && restZeiten.length >= 2;
  if (bereich) {
    start = restZeiten[0].zeit;
    ende = restZeiten[1].zeit;
  } else {
    const einzel = restZeiten[0]?.zeit || relativ;
    const jetztGerundet = uhr(Math.ceil(jetzt / 5) * 5);
    if (ENDE_RE.test(text) && !START_RE.test(text)) ende = einzel || jetztGerundet;
    else if (START_RE.test(text) || (einzel && !pausen.length)) start = einzel || jetztGerundet;
    if (ENDE_RE.test(text) && START_RE.test(text) && restZeiten.length >= 2) {
      start = restZeiten[0].zeit;
      ende = restZeiten[1].zeit;
    }
  }
  if (!start && !ende && !pausen.length) return null;

  // Vorhandene Dienste des Tages beachten: kein zweiter Dienststart, sondern den Dienst aendern.
  const tag = tagLesbar(datum, heute);
  const bestehend = await bestehendeDienste(admin, fahrer.map((f) => f.id), datum);
  const mit = fahrer.filter((f) => bestehend.has(f.id));
  const ohne = fahrer.filter((f) => !bestehend.has(f.id));
  let hinweis = '';
  let rueckfrage = '';
  if (mit.length && ohne.length && !(pausen.length && !start && !ende)) {
    return {
      answer: `${mit.map((f) => `${f.name} hat ${tag} schon Dienst (${dienstText(bestehend.get(f.id)!)})`).join(', ')}, ${ohne.map((f) => f.name).join(', ')} noch nicht. Bitte für beide Gruppen getrennt schicken, dann kann ich den vorhandenen Dienst ändern und den neuen anlegen.`,
    };
  }
  if (mit.length && !ohne.length) {
    const ergebnisse = mit.map((f) => aufVorhandenen(bestehend.get(f.id)!, start, ende, pausen));
    const vorhandenText = mit.map((f) => `${f.name} hat ${tag} schon Dienst (${dienstText(bestehend.get(f.id)!)})`).join(', ');
    if (ergebnisse.some((e) => e === null)) {
      return { answer: `${vorhandenText}. Der Dienststart ${start} ist schon eingetragen, ich ändere nichts.` };
    }
    const schluessel = (e: any) => JSON.stringify([e.start, e.ende, e.pausen]);
    if (new Set(ergebnisse.map(schluessel)).size > 1) {
      return { answer: `${vorhandenText}. Die Dienste sind verschieden, bitte jeden Fahrer einzeln schicken.` };
    }
    ({ start, ende } = ergebnisse[0]!);
    pausen.splice(0, pausen.length, ...ergebnisse[0]!.pausen);
    hinweis = `${vorhandenText}. `;
    rueckfrage = ergebnisse[0]!.frage;
  }

  const namen = fahrer.map((f) => f.name).filter(Boolean);
  const wer = genannt.length
    ? namen.join(', ')
    : `${fahrer.length === 1 ? 'den markierten Fahrer' : `die ${fahrer.length} markierten Fahrer`} (${namen.join(', ')})`;
  const teile = [
    start ? `Dienststart ${start}` : '',
    ...pausen.map((p) => `Pause ${p.von}–${p.bis}`),
    ende ? `Dienstende ${ende}` : '',
  ].filter(Boolean);
  // art/zeit fuer aeltere App-Versionen, die nur Start oder Ende kennen.
  const art = start && !ende && !pausen.length ? 'start' : (ende && !start && !pausen.length ? 'ende' : 'dienst');
  return {
    answer: hinweis
      ? `${hinweis}${rueckfrage || `${teile.join(', ')}?`} Ich ändere dann den vorhandenen Dienst.`
      : `${teile.join(', ')} ${tag} für ${wer}. Soll ich das senden?`,
    action: {
      type: 'dienst_vorschlag',
      vorschlag: { art, zeit: ende || start || '', datum, start, ende, pausen, fahrer },
    },
  };
};

// aktion 'dienst_senden': { datum, start?, ende?, pausen?: [{von,bis}], fahrerIds: [] }
// Aeltere Apps schicken { art: 'start'|'ende', zeit } statt start/ende.
export const dienstSenden = async (admin: any, body: any) => {
  const zeitOderNull = (wert: unknown) => (UHRZEIT.test(String(wert || '')) ? String(wert) : null);
  let start = zeitOderNull(body?.start);
  let ende = zeitOderNull(body?.ende);
  if (!start && !ende && body?.art === 'start') start = zeitOderNull(body?.zeit);
  if (!start && !ende && body?.art === 'ende') ende = zeitOderNull(body?.zeit);
  const pausen = (Array.isArray(body?.pausen) ? body.pausen : [])
    .map((p: any) => ({ art: 'fest', von: zeitOderNull(p?.von), bis: zeitOderNull(p?.bis) }))
    .filter((p: any) => p.von && p.bis && p.von !== p.bis)
    .slice(0, 4);
  const datum = DATUM.test(String(body?.datum || '')) ? String(body.datum) : jetztBerlin().datum;
  const ids = Array.from(new Set((Array.isArray(body?.fahrerIds) ? body.fahrerIds : [])
    .map((id: unknown) => String(id || '').trim().toLowerCase())
    .filter((id: string) => UUID.test(id)))).slice(0, 100) as string[];
  if ((!start && !ende && !pausen.length) || !ids.length) return { status: 400, daten: { error: 'eingabe_ungueltig' } };

  const { data: profile, error: profilFehler } = await admin.from('profiles').select('id').in('id', ids);
  if (profilFehler) return { status: 500, daten: { error: profilFehler.message } };
  const gueltig = (profile || []).map((p: any) => String(p.id));
  if (!gueltig.length) return { status: 400, daten: { error: 'keine_fahrer' } };

  const jetzt = new Date().toISOString();
  let dienstIds: string[] = [];
  let ohneDienst = 0;
  let geaendert = 0;

  if (start || ende) {
    // Hat ein Fahrer an dem Tag schon einen Dienst, wird der geaendert, sonst neu angelegt.
    const vorhanden = await bestehendeDienste(admin, gueltig, datum);
    for (const [fahrerId, b] of vorhanden) {
      const { error: aenderFehler } = await admin.from('driver_service_requests').update({
        ...(start ? { service_start_time: start } : {}),
        ...(ende ? { service_end_time: ende } : {}),
        updated_at: jetzt,
      }).eq('id', b.id);
      if (aenderFehler) return { status: 500, daten: { error: aenderFehler.message } };
      dienstIds.push(b.id);
      void fahrerId;
    }
    const neuIds = gueltig.filter((id: string) => !vorhanden.has(id));
    const { data: neu, error: anfrageFehler } = neuIds.length ? await admin.from('driver_service_requests').insert(neuIds.map((id: string) => ({
      driver_id: id,
      service_date: datum,
      service_start_time: start,
      service_end_time: ende,
      status: 'pending',
      requested_by: 'ki-assistent',
    }))).select('id') : { data: [], error: null };
    if (anfrageFehler) return { status: 500, daten: { error: anfrageFehler.message } };
    dienstIds = [...dienstIds, ...(neu || []).map((d: any) => String(d.id))];
    geaendert = vorhanden.size;

    const profilFelder = {
      ...(start ? { service_start_time: start, service_start_date: datum } : {}),
      ...(ende ? { service_end_time: ende, service_end_date: datum } : {}),
    };
    const { error: updateFehler } = await admin.from('profiles').update(profilFelder).in('id', gueltig);
    if (updateFehler) return { status: 500, daten: { error: updateFehler.message } };
  } else {
    // Nur Pause: an den juengsten Dienst des Fahrers an diesem Tag haengen (nicht abgelehnt).
    const { data: dienste, error } = await admin.from('driver_service_requests')
      .select('id, driver_id, created_at, status')
      .in('driver_id', gueltig).eq('service_date', datum).neq('status', 'refused')
      .order('created_at', { ascending: false });
    if (error) return { status: 500, daten: { error: error.message } };
    const juengster = new Map<string, string>();
    (dienste || []).forEach((d: any) => { if (!juengster.has(String(d.driver_id))) juengster.set(String(d.driver_id), String(d.id)); });
    dienstIds = [...juengster.values()];
    ohneDienst = gueltig.length - dienstIds.length;
    if (!dienstIds.length) return { status: 200, daten: { ok: false, error: 'An diesem Tag hat keiner der Fahrer einen Dienst. Erst Dienststart oder Dienstende senden.' } };
  }

  if (pausen.length && dienstIds.length) {
    // Vorhandene Pausen eines Dienstes bleiben, neue kommen dazu.
    const { data: alt } = await admin.from('dienst_pausen').select('dienst_id, pausen').in('dienst_id', dienstIds);
    const altNachId = new Map<string, any[]>((alt || []).map((r: any) => [String(r.dienst_id), Array.isArray(r.pausen) ? r.pausen : []]));
    const { error: pausenFehler } = await admin.from('dienst_pausen').upsert(dienstIds.map((id) => ({
      dienst_id: id,
      pausen: [...(altNachId.get(id) || []), ...pausen],
      aktualisiert: jetzt,
    })));
    if (pausenFehler) return { status: 500, daten: { error: `Pause nicht gespeichert: ${pausenFehler.message}` } };
  }

  return { status: 200, daten: { ok: true, anzahl: dienstIds.length || gueltig.length, geaendert, ohneDienst, datum, start, ende, pausen } };
};
