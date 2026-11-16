// Fahrzeug und Tracker per KI-Assistent zuordnen:
//   "Gib Tim das Fahrzeug M-TR 105", "Tim fährt heute den M-TR 105"     -> profiles.vehicle_id
//   "Tracker 3 ins Auto M-TR 105", "Steck Tracker 3 in den M-TR 105"     -> obd_tracker.vehicle_id
// Wie beim Stundenlohn erst eine Rueckfrage mit altem und neuem Stand, "ja" speichert, "nein" verwirft.
// Die offene Rueckfrage reist im Kontext (offeneZuordnung), daher ohne neuen App-Build.
// Marke oder Modell statt Kennzeichen (16.11.): "Gib Tim den BMW" fragte nach einer Fahrt. Passt das Wort auf genau
// ein Fahrzeug, gilt es. Passt es auf mehrere, fragt er, welches (offeneFahrzeugwahl), die Antwort "den X5" oder
// das Kennzeichen waehlt aus.

// deno-lint-ignore-file no-explicit-any
import { genannteFahrer, normal } from './dienst.ts';

const FRIST_MS = 15 * 60 * 1000;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|okey|klar|genau|passt|stimmt|richtig|mach(s|e)?( das)?|machen|speicher(n|e)?|bestaetig(e|en|t)?|in ordnung|gerne|bitte|los)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|abbruch|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht)\b/;
const VERB_RE = /\b(gib|gebe|geben|bekommt|bekommen|kriegt|faehrt|fahrt mit|nimmt|nehmen|zuordn\w*|zuweis\w*|zuteil\w*|steck\w*|einbau\w*|bau\w*|setz\w*|haeng\w*|gehoert|soll)\b/;
// Kennzeichen: Grossbuchstaben ("M TR 105", "MTR105") oder klein mit Strich ("m-tr 105"). Sonst waere "um 6" eins.
export const PLATE_RE = /\b(?:[A-ZÄÖÜ]{1,3}[- ]?[A-Z]{1,2}|[a-zäöü]{1,3}-[a-z]{1,2})[- ]?\d{1,4}[EHeh]?\b/g;
export const plateKey = (t: string) => String(t || '').toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');

type Offen = { art: 'fahrer' | 'tracker'; fahrerId?: string; fahrerName?: string; trackerImei?: string; trackerName?: string;
  fahrzeugId: string; fahrzeugName: string; zeit: number };

type Kandidat = { id: string; kz: string; modell: string };
type Wahl = { art: 'fahrer' | 'tracker'; fahrerId?: string; fahrerName?: string; trackerNr?: string; kandidaten: Kandidat[]; zeit: number };

const ohneOffene = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offeneZuordnung;
  delete k.offeneFahrzeugwahl;
  return k;
};

// Nur klare Zuordnen-Woerter. "soll", "setz", "an" reichen ohne Kennzeichen nicht ("Tim soll den BMW waschen").
const MODELL_VERB_RE = /\b(gib|gebe|geben|bekommt|bekommen|kriegt|faehrt|nimmt|nehmen|zuordn\w*|zuweis\w*|zuteil\w*|steck\w*|einbau\w*)\b/;
const FRAGE_ANFANG_RE = /^\s*(wer|was|welche\w*|wo|wann|wie|warum|wieso|faehrt|hat|ist|kann|soll|darf|nimmt|bekommt|kriegt)\b/;
const woerterVon = (t: unknown) => normal(String(t || '')).split(/[^a-z0-9]+/).filter((w) => w.length >= 2);
// Fahrzeuge, deren Marke oder Modell im Satz vorkommt. Es zaehlen die mit den meisten passenden Woertern
// ("BMW" passt auf 7er und X5, "BMW X5" nur auf den X5).
const nachModell = <T extends { modell: string }>(alle: T[], satz: string): T[] => {
  const im = new Set(woerterVon(satz));
  const t = alle.map((v) => ({ v, n: woerterVon(v.modell).filter((w) => im.has(w)).length }));
  const max = Math.max(0, ...t.map((x) => x.n));
  return max ? t.filter((x) => x.n === max).map((x) => x.v) : [];
};
const kandidatName = (v: Kandidat) => `${v.modell || 'Fahrzeug'}${v.kz ? ` (${v.kz})` : ''}`;
const ORDNUNG: [RegExp, number][] = [[/\berste[nrs]?\b/, 0], [/\bzweite[nrs]?\b/, 1], [/\bdritte[nrs]?\b/, 2], [/\bvierte[nrs]?\b/, 3], [/\bletzte[nrs]?\b/, -1]];
// Antwort auf "Welches Fahrzeug meinst du": Kennzeichen, Modell oder "den zweiten". Null: keine Auswahl.
const ausWahl = (wahl: Wahl, roh: string): Kandidat[] => {
  const schluessel = plateKey(roh);
  const perKz = wahl.kandidaten.filter((v) => v.kz && schluessel.includes(plateKey(v.kz))).sort((a, b) => plateKey(b.kz).length - plateKey(a.kz).length);
  if (perKz.length) return [perKz[0]];
  const perModell = nachModell(wahl.kandidaten, roh);
  if (perModell.length) return perModell;
  const text = normal(roh);
  for (const [re, i] of ORDNUNG) if (re.test(text)) return [wahl.kandidaten[i < 0 ? wahl.kandidaten.length - 1 : i]].filter(Boolean);
  return [];
};
const wahlGilt = (wahl: Wahl | undefined): wahl is Wahl => !!wahl && Array.isArray(wahl.kandidaten) && Date.now() - Number(wahl.zeit || 0) < FRIST_MS;
/** Ist die Nachricht eine Antwort auf die offene Frage "Welches Fahrzeug"? Sonst verwirft ki.ts die Frage. */
export const fahrzeugwahlAntwort = (kontext: any, frage: string): boolean => {
  const wahl: Wahl | undefined = kontext?.offeneFahrzeugwahl;
  if (!wahlGilt(wahl) || String(frage || '').length > 60) return false;
  return NEIN_RE.test(normal(frage)) || ausWahl(wahl, frage).length > 0;
};
const welches = (kandidaten: Kandidat[], fuer: string) =>
  `Welches Fahrzeug meinst du für ${fuer}: ${kandidaten.slice(0, 6).map(kandidatName).join(' oder ')}? Nenne das Modell oder das Kennzeichen.`;

const fahrzeugFinden = async (admin: any, roh: string) => {
  const { data } = await admin.from('vehicles').select('id, license_plate, brand_model');
  const alle = Array.isArray(data) ? data : [];
  for (const m of roh.matchAll(PLATE_RE)) {
    const k = plateKey(m[0]);
    const v = alle.find((x: any) => x.license_plate && plateKey(x.license_plate) === k);
    if (v) return v;
  }
  return null;
};
const fahrzeugName = (v: any) => `${v.brand_model || 'Fahrzeug'}${v.license_plate ? ` (${v.license_plate})` : ''}`;

const trackerVorschlag = async (admin: any, t: string, fahrzeug: any, kontext: any) => {
  const { data } = await admin.from('obd_tracker').select('imei, nummer, vehicle_id');
  const tracker = (Array.isArray(data) ? data : []).find((x: any) => String(x.nummer) === t || String(x.imei) === t);
  if (!tracker) return { answer: `Tracker ${t} finde ich nicht.`, kontext };
  const trackerName = `Tracker ${tracker.nummer ?? tracker.imei}`;
  const { data: alt } = tracker.vehicle_id ? await admin.from('vehicles').select('id, license_plate, brand_model').eq('id', tracker.vehicle_id).maybeSingle() : { data: null };
  if (tracker.vehicle_id === fahrzeug.id) return { answer: `${trackerName} steckt schon in ${fahrzeugName(fahrzeug)}.`, kontext };
  const o: Offen = { art: 'tracker', trackerImei: String(tracker.imei), trackerName, fahrzeugId: fahrzeug.id, fahrzeugName: fahrzeugName(fahrzeug), zeit: Date.now() };
  return {
    answer: `${trackerName} in ${fahrzeugName(fahrzeug)} setzen?${alt ? ` Bisher steckt er in ${fahrzeugName(alt)}.` : ''} Mit „ja“ speichere ich es.`,
    kontext: { ...ohneOffene(kontext), offeneZuordnung: o },
  };
};

const fahrerVorschlag = async (admin: any, f: { id: string; name: string }, fahrzeug: any, kontext: any) => {
  const { data: profil } = await admin.from('profiles').select('vehicle_id').eq('id', f.id).maybeSingle();
  const { data: alt } = profil?.vehicle_id ? await admin.from('vehicles').select('id, license_plate, brand_model').eq('id', profil.vehicle_id).maybeSingle() : { data: null };
  if (profil?.vehicle_id === fahrzeug.id) return { answer: `${f.name} fährt schon ${fahrzeugName(fahrzeug)}.`, kontext };
  const { data: andere } = await admin.from('profiles').select('first_name, last_name').eq('vehicle_id', fahrzeug.id);
  const auch = (Array.isArray(andere) ? andere : []).map((p: any) => [p.first_name, p.last_name].filter(Boolean).join(' ')).filter(Boolean);
  const o: Offen = { art: 'fahrer', fahrerId: f.id, fahrerName: f.name, fahrzeugId: fahrzeug.id, fahrzeugName: fahrzeugName(fahrzeug), zeit: Date.now() };
  return {
    answer: `${f.name} bekommt ${fahrzeugName(fahrzeug)}?${alt ? ` Bisher fährt ${f.name.split(' ')[0]} ${fahrzeugName(alt)}.` : ''}`
      + `${auch.length ? ` ${auch.join(', ')} ${auch.length === 1 ? 'fährt' : 'fahren'} es auch.` : ''} Mit „ja“ speichere ich es.`,
    kontext: { ...ohneOffene(kontext), offeneZuordnung: o },
  };
};

export const zuordnenVorschlag = async (admin: any, frage: string, kontext: any) => {
  const roh = String(frage || '').trim();
  const text = normal(roh);
  const offen: Offen | undefined = kontext?.offeneZuordnung;
  if (offen && Date.now() - Number(offen.zeit || 0) < FRIST_MS && roh.length <= 60) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts geändert.', kontext: ohneOffene(kontext) };
    if (JA_RE.test(text) && !/\?/.test(roh)) {
      if (offen.art === 'fahrer') {
        const { error } = await admin.from('profiles').update({ vehicle_id: offen.fahrzeugId }).eq('id', offen.fahrerId);
        return { answer: error ? `Nicht gespeichert (${error.message}).` : `Gespeichert: ${offen.fahrerName} fährt ${offen.fahrzeugName}.`, kontext: ohneOffene(kontext) };
      }
      // Ein Auto hat einen Tracker: ein anderer im selben Auto wird geloest, wie in Fahrzeug bearbeiten.
      await admin.from('obd_tracker').update({ vehicle_id: null }).eq('vehicle_id', offen.fahrzeugId);
      const { error } = await admin.from('obd_tracker').update({ vehicle_id: offen.fahrzeugId }).eq('imei', offen.trackerImei);
      return { answer: error ? `Nicht gespeichert (${error.message}).` : `Gespeichert: ${offen.trackerName} steckt jetzt in ${offen.fahrzeugName}.`, kontext: ohneOffene(kontext) };
    }
  }

  // Offene Frage "Welches Fahrzeug": die Antwort waehlt aus den genannten Fahrzeugen.
  const wahl: Wahl | undefined = kontext?.offeneFahrzeugwahl;
  if (wahlGilt(wahl) && roh.length <= 60) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts geändert.', kontext: ohneOffene(kontext) };
    const treffer = ausWahl(wahl, roh);
    if (treffer.length > 1) {
      return { answer: welches(treffer, wahl.art === 'fahrer' ? String(wahl.fahrerName) : `Tracker ${wahl.trackerNr}`), kontext: { ...ohneOffene(kontext), offeneFahrzeugwahl: { ...wahl, kandidaten: treffer, zeit: Date.now() } } };
    }
    if (treffer.length === 1) {
      const { data } = await admin.from('vehicles').select('id, license_plate, brand_model').eq('id', treffer[0].id).maybeSingle();
      if (!data) return { answer: 'Dieses Fahrzeug finde ich nicht mehr. Ich habe nichts geändert.', kontext: ohneOffene(kontext) };
      return wahl.art === 'tracker'
        ? await trackerVorschlag(admin, String(wahl.trackerNr), data, ohneOffene(kontext))
        : await fahrerVorschlag(admin, { id: String(wahl.fahrerId), name: String(wahl.fahrerName) }, data, ohneOffene(kontext));
    }
  }

  if (!VERB_RE.test(text) && !/\b(in den|ins|in das|an)\b/.test(text)) return null;
  if (/\b(buch\w*|fahrt|abhol\w*|nach|zum|zur|vom)\b/.test(text) || /\?\s*$/.test(roh)) return null;
  const trackerM = text.match(/\btracker\s*(?:nr\.?|nummer)?\s*(\d{1,4}|\d{15})\b/);
  const hatPlate = [...roh.matchAll(PLATE_RE)].length > 0;
  let fahrzeug = hatPlate ? await fahrzeugFinden(admin, roh) : null;
  if (!hatPlate) {
    // Kein Kennzeichen: Marke oder Modell ("den BMW", "den X5"), nur bei klarem Zuordnen-Wort und keiner Frage.
    if (!MODELL_VERB_RE.test(text) || FRAGE_ANFANG_RE.test(text)) return null;
    const { data } = await admin.from('vehicles').select('id, license_plate, brand_model');
    const alle: Kandidat[] = (Array.isArray(data) ? data : []).filter((v: any) => v?.id && v?.brand_model)
      .map((v: any) => ({ id: String(v.id), kz: String(v.license_plate || ''), modell: String(v.brand_model) }));
    const passt = nachModell(alle, text);
    if (!passt.length) return null;
    const fahrer = trackerM ? [] : await genannteFahrer(admin, text);
    if (!trackerM && fahrer.length !== 1) return null;
    if (passt.length > 1) {
      const o: Wahl = trackerM
        ? { art: 'tracker', trackerNr: trackerM[1], kandidaten: passt, zeit: Date.now() }
        : { art: 'fahrer', fahrerId: fahrer[0].id, fahrerName: fahrer[0].name, kandidaten: passt, zeit: Date.now() };
      return { answer: welches(passt, trackerM ? `Tracker ${trackerM[1]}` : fahrer[0].name), kontext: { ...ohneOffene(kontext), offeneFahrzeugwahl: o } };
    }
    fahrzeug = (Array.isArray(data) ? data : []).find((v: any) => String(v.id) === passt[0].id) || null;
  }

  if (trackerM) {
    if (!fahrzeug) return { answer: 'Das Fahrzeug mit diesem Kennzeichen finde ich nicht. Sag mir das Kennzeichen genau so, wie es in TRISAR steht.', kontext };
    return await trackerVorschlag(admin, trackerM[1], fahrzeug, kontext);
  }

  const fahrer = await genannteFahrer(admin, text);
  if (!fahrer.length) return null;
  if (!fahrzeug) return { answer: 'Das Fahrzeug mit diesem Kennzeichen finde ich nicht. Sag mir das Kennzeichen genau so, wie es in TRISAR steht.', kontext };
  if (fahrer.length > 1) return { answer: `Ein Fahrzeug ordne ich immer einem Fahrer zu. Wem soll ${fahrzeugName(fahrzeug)} gehören: ${fahrer.map((f) => f.name).join(' oder ')}?`, kontext };
  return await fahrerVorschlag(admin, fahrer[0], fahrzeug, kontext);
};
