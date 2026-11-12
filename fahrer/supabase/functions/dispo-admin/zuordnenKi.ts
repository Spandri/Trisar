// Fahrzeug und Tracker per KI-Assistent zuordnen:
//   "Gib Tim das Fahrzeug M-TR 105", "Tim fährt heute den M-TR 105"     -> profiles.vehicle_id
//   "Tracker 3 ins Auto M-TR 105", "Steck Tracker 3 in den M-TR 105"     -> obd_tracker.vehicle_id
// Wie beim Stundenlohn erst eine Rueckfrage mit altem und neuem Stand, "ja" speichert, "nein" verwirft.
// Die offene Rueckfrage reist im Kontext (offeneZuordnung), daher ohne neuen App-Build.

// deno-lint-ignore-file no-explicit-any
import { genannteFahrer, normal } from './dienst.ts';

const FRIST_MS = 15 * 60 * 1000;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|okey|klar|genau|passt|stimmt|richtig|mach(s|e)?( das)?|machen|speicher(n|e)?|bestaetig(e|en|t)?|in ordnung|gerne|bitte|los)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|abbruch|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht)\b/;
const VERB_RE = /\b(gib|gebe|geben|bekommt|bekommen|kriegt|faehrt|fahrt mit|nimmt|nehmen|zuordn\w*|zuweis\w*|zuteil\w*|steck\w*|einbau\w*|bau\w*|setz\w*|haeng\w*|gehoert|soll)\b/;
// Kennzeichen: Grossbuchstaben ("M TR 105", "MTR105") oder klein mit Strich ("m-tr 105"). Sonst waere "um 6" eins.
const PLATE_RE = /\b(?:[A-ZÄÖÜ]{1,3}[- ]?[A-Z]{1,2}|[a-zäöü]{1,3}-[a-z]{1,2})[- ]?\d{1,4}[EHeh]?\b/g;
const plateKey = (t: string) => String(t || '').toUpperCase().replace(/[^A-Z0-9ÄÖÜ]/g, '');

type Offen = { art: 'fahrer' | 'tracker'; fahrerId?: string; fahrerName?: string; trackerImei?: string; trackerName?: string;
  fahrzeugId: string; fahrzeugName: string; zeit: number };

const ohneOffene = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offeneZuordnung;
  return k;
};

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

  if (!VERB_RE.test(text) && !/\b(in den|ins|in das|an)\b/.test(text)) return null;
  if (/\b(buch\w*|fahrt|abhol\w*|nach|zum|zur|vom)\b/.test(text) || /\?\s*$/.test(roh)) return null;
  const trackerM = text.match(/\btracker\s*(?:nr\.?|nummer)?\s*(\d{1,4}|\d{15})\b/);
  const hatPlate = [...roh.matchAll(PLATE_RE)].length > 0;
  if (!hatPlate) return null;
  const fahrzeug = await fahrzeugFinden(admin, roh);

  if (trackerM) {
    if (!fahrzeug) return { answer: 'Das Fahrzeug mit diesem Kennzeichen finde ich nicht. Sag mir das Kennzeichen genau so, wie es in TRISAR steht.', kontext };
    const t = trackerM[1];
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
  }

  const fahrer = await genannteFahrer(admin, text);
  if (!fahrer.length) return null;
  if (!fahrzeug) return { answer: 'Das Fahrzeug mit diesem Kennzeichen finde ich nicht. Sag mir das Kennzeichen genau so, wie es in TRISAR steht.', kontext };
  if (fahrer.length > 1) return { answer: `Ein Fahrzeug ordne ich immer einem Fahrer zu. Wem soll ${fahrzeugName(fahrzeug)} gehören: ${fahrer.map((f) => f.name).join(' oder ')}?`, kontext };
  const f = fahrer[0];
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
