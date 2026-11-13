// Alles Weitere per KI-Assistent steuern (Abdeckungs-Pruefung werkzeuge/ki-test/abdeckung.ts, 13.11.):
//   Nachricht:  "Schreib allen Fahrern: Morgen Treffpunkt 7 Uhr Halle B", "Schick Tim eine Nachricht: bitte melden" -> Push
//   Fahrer:     "Ändere die Telefonnummer von Tim auf 0151 555666", "Gib Marvin die Fahrernummer 20",
//               "Markier Tim mit Flagge 2" / "Flagge von Tim weg", "Setz das Passwort von Tim zurück"
//   Fahrzeug:   "Ändere das Kennzeichen von M-TR 101 auf M-TR 111", "Wie viel Reichweite hat M-TR 102?"
//   Tracker:    "Stell alle Tracker auf fein"
//   Gast/Ort:   "Leg den Gast Uli Hoeneß an, Telefon 0170 1234567", "Ändere die Telefonnummer von Julia Weber auf ...",
//               "Leg den Ort Messe Eingang West an, Am Messesee 2 München"
//   Stunden:    "Bestätige den Stundenzettel von Marvin", "Exportiere die Stunden vom Oktober"
//   Planung:    "Wie viele Fahrer brauche ich morgen?", "Plane die Fahrten von morgen neu"
//   Allgemein:  "Mach das rückgängig", "Was kannst du alles?"
// Aendern immer erst mit Rueckfrage, "ja" fuehrt aus (kontext.offeneSteuerung). Danach merkt sich
// kontext.rueckgaengig den alten Stand fuer "rückgängig".

// deno-lint-ignore-file no-explicit-any
import { geocode, tomtomSchluessel } from '../_shared/tomtom-routing.ts';
import { passwortErzeugen } from './anlegen.ts';
import { alleFahrer, datumAusText, genannteFahrer, jetztBerlin, normal, plusTage, tagLesbar } from './dienst.ts';
import { fahrtRueckgaengig } from './fahrtenKi.ts';
import { PLATE_RE, plateKey } from './zuordnenKi.ts';

const FRIST_MS = 15 * 60 * 1000;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|klar|genau|passt|mach(s|e)?( das)?|senden|schick(s|e)?( ab)?|speicher\w*|bestaetig\w*|in ordnung|gerne|bitte|los)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht)\b/;
const AENDERN = /\b(aender\w*|setz\w*|mach\w*|trag\w*|gib|geb\w*|neue[nrs]?|auf)\b/;
const TELEFON = /(\+?\d[\d\s/-]{5,}\d)/;

const ohne = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offeneSteuerung;
  return k;
};
const frage = (kontext: any, aktion: any, text: string) => ({ answer: text, kontext: { ...ohne(kontext), offeneSteuerung: { ...aktion, zeit: Date.now() } } });

// ---- Ausfuehren ----

const ausfuehren = async (admin: any, a: any): Promise<{ text: string; rueckgaengig?: any }> => {
  if (a.art === 'feld') {
    const { data: alt } = await admin.from(a.tabelle).select(Object.keys(a.neu).join(', ')).eq(a.schluessel || 'id', a.id).maybeSingle();
    const { error } = await admin.from(a.tabelle).update(a.neu).eq(a.schluessel || 'id', a.id);
    if (error) return { text: `Nicht gespeichert (${error.message}).` };
    return { text: `Gespeichert: ${a.titel}.`, rueckgaengig: alt ? { art: 'feld', tabelle: a.tabelle, schluessel: a.schluessel || 'id', id: a.id, alt, text: a.titel } : undefined };
  }
  if (a.art === 'nachricht') {
    let ok = 0;
    for (const id of a.ids as string[]) {
      const { error } = await admin.rpc('push_melden', { p_empfaenger: id, p_app: 'fahrer', p_art: 'nachricht', p_titel: 'Nachricht von der Dispo', p_text: a.inhalt, p_daten: { ziel: 'start' } });
      if (!error) ok += 1;
    }
    return { text: ok === a.ids.length ? `Gesendet an ${a.wer}.` : `An ${ok} von ${a.ids.length} gesendet.` };
  }
  if (a.art === 'passwort') {
    const pw = passwortErzeugen();
    const { error } = await admin.auth.admin.updateUserById(a.id, { password: pw });
    if (error) return { text: `Nicht geändert (${error.message}).` };
    await admin.rpc('konto_abmelden_jetzt', { p_user: a.id, p_grund: 'passwort' });
    return { text: `Neues Passwort für ${a.name}: ${pw}\nDas zeige ich nur einmal. ${a.name} ist auf allen Geräten abgemeldet und meldet sich mit dem neuen Passwort an.` };
  }
  if (a.art === 'tracker') {
    let q = admin.from('obd_tracker').update({ stufe: a.stufe });
    q = a.imeis?.length ? q.in('imei', a.imeis) : q.neq('imei', '');
    const { error } = await q;
    return { text: error ? `Nicht geändert (${error.message}).` : `Tracker-Stufe ${a.stufe} gesetzt. Die Tracker übernehmen sie beim nächsten Verbinden.` };
  }
  if (a.art === 'gast') {
    const { data, error } = await admin.from('guests').insert(a.daten).select('id').single();
    return error ? { text: `Nicht angelegt (${error.message}).` }
      : { text: `Gast angelegt: ${a.titel}.`, rueckgaengig: { art: 'neu', tabelle: 'guests', id: String(data?.id || ''), text: `Gast ${a.titel}` } };
  }
  if (a.art === 'ort') {
    const { data, error } = await admin.from('orte').insert(a.daten).select('id').single();
    return error ? { text: `Nicht angelegt (${error.message}).` }
      : { text: `Ort angelegt: ${a.daten.name}. Er steht jetzt beim Buchen und auf der Karte zur Verfügung.`, rueckgaengig: { art: 'neu', tabelle: 'orte', id: String(data?.id || ''), text: `Ort ${a.daten.name}` } };
  }
  if (a.art === 'stunden') {
    const jetzt = new Date().toISOString();
    const { error } = await admin.from('stundenzettel').update({ status: a.status, geprueft_am: jetzt, ...(a.dispoId ? { geprueft_von: a.dispoId } : {}) }).in('id', a.ids);
    return error ? { text: `Nicht gespeichert (${error.message}).` }
      : { text: `${a.ids.length === 1 ? 'Stundenzettel' : `${a.ids.length} Stundenzettel`} ${a.status === 'bestaetigt' ? 'bestätigt' : 'zurückgegeben'}.`,
        rueckgaengig: { art: 'feldListe', tabelle: 'stundenzettel', ids: a.ids, alt: { status: 'eingereicht', geprueft_am: null }, text: 'Stundenzettel-Prüfung' } };
  }
  return { text: 'Unbekannte Aktion.' };
};

const rueckgaengig = async (admin: any, r: any): Promise<string> => {
  const fahrt = await fahrtRueckgaengig(admin, r);
  if (fahrt) return fahrt;
  if (r.art === 'feld') {
    const { error } = await admin.from(r.tabelle).update(r.alt).eq(r.schluessel || 'id', r.id);
    return error ? `Nicht rückgängig gemacht (${error.message}).` : `Rückgängig gemacht: ${r.text}.`;
  }
  if (r.art === 'feldListe') {
    const { error } = await admin.from(r.tabelle).update(r.alt).in('id', r.ids);
    return error ? `Nicht rückgängig gemacht (${error.message}).` : `Rückgängig gemacht: ${r.text}.`;
  }
  if (r.art === 'neu' && r.id) {
    const { error } = await admin.from(r.tabelle).delete().eq('id', r.id);
    return error ? `Nicht rückgängig gemacht (${error.message}).` : `Rückgängig gemacht: ${r.text} ist wieder weg.`;
  }
  return 'Das kann ich nicht rückgängig machen.';
};

// ---- Hilfe ----

const HILFE = [
  'Das kann ich, alles erst mit Rückfrage:',
  '- Fahrten buchen, ändern, stornieren, löschen, als erledigt markieren, kopieren, Notiz setzen',
  '- Mehrere Aufträge in einer Nachricht, Standby zur Fahrt, Flugstatus („Wann landet LH2034?“)',
  '- Dienste senden, ändern und löschen, auch für eine ganze Woche oder alle Fahrer',
  '- Standby anlegen, anzeigen, verschieben, löschen',
  '- Fahrer und Fahrzeuge anlegen, löschen, zuordnen, Telefon, Nummer, Flagge, Kennzeichen ändern, Passwort neu setzen',
  '- Nachrichten an einzelne oder alle Fahrer, Tracker-Stufe stellen',
  '- Gäste und Orte anlegen, Gäste-Daten abfragen und ändern',
  '- Stundenlohn setzen, Stundenzettel bestätigen, Stunden und Dienste abfragen',
  '- Fragen: wer ist frei, wer hat Dienst, wo ist ein Fahrer, welche Fahrten sind verspätet, wie viele Fahrer brauche ich',
  '- „rückgängig“ macht den letzten Schritt rückgängig, wenn das geht',
].join('\n');

// ---- Hauptregel ----

// nachrichtFelder: Empfaenger und Text, vom Modell gelesen (verstehen.ts). absicht: was das Modell erkannt hat.
export const steuern = async (admin: any, roh0: string, kontext: any, dispoId: string | null,
  nachrichtFelder: { empfaenger: string[]; text: string } | null = null, absicht: string | null = null) => {
  const roh = String(roh0 || '').trim();
  const text = normal(roh);
  const { datum: heute } = jetztBerlin();

  // Offene Rueckfrage
  const offen = kontext?.offeneSteuerung;
  if (offen && Date.now() - Number(offen.zeit || 0) < FRIST_MS && roh.length <= 40 && !/\?/.test(roh)) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts geändert.', kontext: ohne(kontext) };
    if (JA_RE.test(text)) {
      const r = await ausfuehren(admin, offen);
      const k = ohne(kontext);
      if (r.rueckgaengig) k.rueckgaengig = { ...r.rueckgaengig, zeit: Date.now() };
      return { answer: r.text, kontext: k };
    }
  }

  // Rueckgaengig
  if (/^\s*(mach\w*\s+(das|es|den letzten schritt)\s+)?rueckgaengig\b|^\s*(undo|zurueck nehmen|nimm das zurueck)\b/.test(text) || /\brueckgaengig\b/.test(text) && roh.length < 40) {
    const r = kontext?.rueckgaengig;
    if (!r || Date.now() - Number(r.zeit || 0) > 60 * 60 * 1000) return { answer: 'Ich habe in diesem Gespräch nichts geändert, was ich rückgängig machen kann.', kontext };
    const k = { ...(kontext || {}) };
    delete k.rueckgaengig;
    return { answer: await rueckgaengig(admin, r), kontext: k };
  }

  // Hilfe
  if (/^\s*(was kannst du|was geht|hilfe|help|was kann ich (dich )?fragen|wobei kannst du)\b/.test(text)) return { answer: HILFE, kontext };

  // Nachricht an Fahrer. Fehlt Empfaenger oder Text, fragt er nach und merkt sich den Rest (kontext.offeneNachricht).
  const empfaenger = async (wemText: string) => {
    const w = normal(wemText);
    const alle = /\b(alle[nm]?|jede[nmr]?)\b/.test(w);
    const f = alle ? await alleFahrer(admin) : await genannteFahrer(admin, w);
    return { fahrer: f, wer: alle && f.length > 3 ? `alle ${f.length} Fahrer` : f.map((x) => x.name).join(', ') };
  };
  const inhaltGlaetten = (t: string) => {
    let i = t.trim().replace(/^["„]|["“”]$/g, '');
    // "dass er sich melden soll" als direkte Bitte: "Bitte melden."
    const dass = i.match(/^(?:,\s*)?dass\s+(?:er|sie|ihr|du)\s+(?:sich\s+)?(.+?)\s+(?:soll|sollen|muss|muessen|müssen)\.?$/i);
    if (dass) i = `Bitte ${dass[1]}.`;
    return i.replace(/^(?:,\s*)?dass\s+/i, '');
  };
  const nachrichtFrage = (fahrer: { id: string; name: string }[], wer: string, inhalt: string) => {
    const k = { ...(kontext || {}) };
    delete k.offeneNachricht;
    return frage(k, { art: 'nachricht', ids: fahrer.map((f) => f.id), inhalt, wer }, `Push an ${wer}: „${inhalt}“\nMit „ja“ sende ich sie.`);
  };
  const on = kontext?.offeneNachricht;
  if (on && Date.now() - Number(on.zeit || 0) < FRIST_MS && !NEIN_RE.test(text)) {
    if (on.inhalt && roh.length <= 60) {
      const e = await empfaenger(roh);
      if (e.fahrer.length) return nachrichtFrage(e.fahrer, e.wer, on.inhalt);
    } else if (on.ids?.length && roh.length >= 2) {
      return nachrichtFrage(on.ids.map((id: string, i: number) => ({ id, name: on.namen?.[i] || '' })), on.wer, inhaltGlaetten(roh));
    }
  }
  // Vom Modell gelesen: Empfaenger und Text direkt nehmen, nichts zerlegen.
  if (absicht === 'nachricht' && nachrichtFelder) {
    const alleGemeint = nachrichtFelder.empfaenger.some((x) => /^(alle|allen|alle fahrer)$/i.test(x));
    const e = alleGemeint ? await empfaenger('alle') : nachrichtFelder.empfaenger.length ? await empfaenger(nachrichtFelder.empfaenger.join(' und ')) : { fahrer: [], wer: '' };
    const genannt = nachrichtFelder.empfaenger.filter((x) => !/^(alle|allen|alle fahrer)$/i.test(x));
    const inhalt = nachrichtFelder.text ? inhaltGlaetten(nachrichtFelder.text) : '';
    // Genannte Namen, die es nicht gibt, nicht still weglassen.
    const fehlt = alleGemeint ? [] : genannt.filter((n) => !e.fahrer.some((f) => normal(f.name).includes(normal(n).trim())));
    if (fehlt.length) return { answer: `${fehlt.join(', ')} finde ich nicht unter den Fahrern. Nenne den Namen so, wie er in TRISAR steht.`, kontext };
    if (e.fahrer.length && inhalt.length >= 2) return nachrichtFrage(e.fahrer, e.wer, inhalt);
    if (e.fahrer.length) {
      return { answer: `Was soll in der Nachricht an ${e.wer} stehen?`, kontext: { ...(kontext || {}), offeneNachricht: { ids: e.fahrer.map((f) => f.id), namen: e.fahrer.map((f) => f.name), wer: e.wer, zeit: Date.now() } } };
    }
    if (inhalt.length >= 2) {
      return { answer: `An wen soll „${inhalt}“ gehen? Nenne den Fahrer oder „alle“.`, kontext: { ...(kontext || {}), offeneNachricht: { inhalt, zeit: Date.now() } } };
    }
  }
  const istNachricht = absicht === 'nachricht' || /\b(nachricht|push|mitteil\w*|benachrichtig\w*|informier\w*)\b/i.test(roh)
    || (/^\s*(?:bitte\s+)?(?:schreib\w*|schick\w*|sende\w*|sag\w*)\b/i.test(roh) && (/(?<!\d):(?!\d)/.test(roh) || /\bdass\b/i.test(roh)));
  if (istNachricht && !/\b(fahrt|buch\w*|abhol\w*|dienst\w*|standby|feierabend)\b/.test(text)) {
    let wemText = '';
    let inhaltText = '';
    // "Nachricht an Stefano: beeil dich", "Schick eine Push an alle Fahrer, dass ..."
    const m1 = roh.match(/\b(?:push(?:-?nachricht)?|nachricht)\s+(?:an|für|fuer)\s+(.+?)\s*(?:(?<!\d):(?!\d)|,|\s+dass\s+|\s+mit\s+(?:dem\s+)?(?:text|inhalt)\s*:?)\s*(.+)$/i);
    // "Schreib Tim: ...", "Schick Tim eine Nachricht, dass ...", "Sag allen Fahrern, dass ..."
    const m2 = roh.match(/^\s*(?:bitte\s+)?(?:schreib\w*|schick\w*|sende\w*|sag\w*|teil\w*\s+mit|benachrichtig\w*|informier\w*)\s+(.+?)(?:(?<!\d)\s*:\s*(?!\d)|\s+(?:eine\s+)?(?:push|nachricht)\s*(?::|,|dass)?\s*|,\s*dass\s+|\s+dass\s+)(.+)$/i);
    // "Schick Tim eine Nachricht" ohne Text, "Nachricht an Tim"
    const m3 = roh.match(/\b(?:nachricht|push)\s+(?:an|für|fuer)\s+(.+?)\s*$/i) || roh.match(/^\s*(?:schick\w*|schreib\w*|sende\w*)\s+(.+?)\s+(?:eine\s+)?(?:nachricht|push)\s*$/i);
    if (m1) { wemText = m1[1]; inhaltText = m1[2]; }
    else if (m2 && !/^(eine|ne|die|der)$/i.test(m2[1].trim())) { wemText = m2[1]; inhaltText = m2[2]; }
    else if (m3) { wemText = m3[1]; }
    else if (m2) { inhaltText = m2[2].replace(/^(an|für|fuer)\s+\S+\s*[:,]?\s*/i, ''); }
    const e = wemText ? await empfaenger(wemText) : { fahrer: [], wer: '' };
    const inhalt = inhaltText ? inhaltGlaetten(inhaltText) : '';
    if (e.fahrer.length && inhalt.length >= 2) return nachrichtFrage(e.fahrer, e.wer, inhalt);
    if (e.fahrer.length) {
      return { answer: `Was soll in der Nachricht an ${e.wer} stehen?`, kontext: { ...(kontext || {}), offeneNachricht: { ids: e.fahrer.map((f) => f.id), namen: e.fahrer.map((f) => f.name), wer: e.wer, zeit: Date.now() } } };
    }
    if (inhalt.length >= 2) {
      return { answer: `An wen soll „${inhalt}“ gehen? Nenne den Fahrer oder „alle“.`, kontext: { ...(kontext || {}), offeneNachricht: { inhalt, zeit: Date.now() } } };
    }
    return { answer: 'An wen und was? Zum Beispiel „Nachricht an Tim: bitte melden“ oder „Schreib allen Fahrern: Treffpunkt 7 Uhr“.', kontext };
  }

  // Passwort neu setzen
  if (/\b(passwort|kennwort)\b/.test(text) && /\b(zurueck\w*|neu\w*|aender\w*|reset\w*|vergessen)\b/.test(text)) {
    const fahrer = await genannteFahrer(admin, text);
    if (/\b(alle[nm]?|jede[nmr]?)\b/.test(text)) return { answer: 'Passwörter setze ich nur einzeln neu. Nenne den Fahrer.', kontext };
    if (fahrer.length !== 1) return { answer: 'Bei welchem Fahrer? Zum Beispiel „Setz das Passwort von Tim zurück“.', kontext };
    return frage(kontext, { art: 'passwort', id: fahrer[0].id, name: fahrer[0].name },
      `Für ${fahrer[0].name} ein neues Passwort erzeugen? ${fahrer[0].name.split(' ')[0]} wird dann auf allen Geräten abgemeldet. Mit „ja“ setze ich es.`);
  }

  // Tracker-Stufe
  const stufe = text.match(/\b(sparsam|mittel|fein)\b/)?.[1];
  if (stufe && /\btracker\b/.test(text) && /\b(stell\w*|setz\w*|mach\w*|auf|stufe)\b/.test(text)) {
    const nummern = [...text.matchAll(/\btracker\s*(\d{1,4})\b/g)].map((m) => m[1]);
    const { data } = await admin.from('obd_tracker').select('imei, nummer');
    const alle = Array.isArray(data) ? data : [];
    const ziel = nummern.length ? alle.filter((t: any) => nummern.includes(String(t.nummer))) : alle;
    if (!ziel.length) return { answer: 'Diese Tracker finde ich nicht.', kontext };
    return frage(kontext, { art: 'tracker', stufe, imeis: nummern.length ? ziel.map((t: any) => String(t.imei)) : [] },
      `${nummern.length ? ziel.map((t: any) => `Tracker ${t.nummer}`).join(', ') : `Alle ${ziel.length} Tracker`} auf Stufe ${stufe} stellen? ${stufe === 'fein' ? 'Fein braucht mehr Datenvolumen. ' : ''}Mit „ja“ stelle ich es um.`);
  }

  // Reichweite
  if (/\b(reichweite|tank\w*|akku|batterie|ladestand|sprit)\b/.test(text) && /^\s*(wie|was|hat|welche\w*|zeig\w*|wieviel)\b|\?\s*$/.test(roh)) {
    const { data } = await admin.from('vehicles').select('id, license_plate, brand_model, range_km, battery_fuel_percent');
    const alle = Array.isArray(data) ? data : [];
    const plates = [...roh.matchAll(PLATE_RE)].map((m) => plateKey(m[0]));
    let ziel = plates.length ? alle.filter((v: any) => plates.includes(plateKey(v.license_plate || ''))) : [];
    if (!ziel.length) {
      const fahrer = await genannteFahrer(admin, text);
      if (fahrer.length) {
        const { data: p } = await admin.from('profiles').select('vehicle_id').in('id', fahrer.map((f) => f.id));
        const ids = (Array.isArray(p) ? p : []).map((x: any) => x.vehicle_id).filter(Boolean);
        ziel = alle.filter((v: any) => ids.includes(v.id));
      }
    }
    if (!ziel.length && /\b(alle|welche|flotte)\b/.test(text)) ziel = alle;
    if (!ziel.length) return { answer: 'Welches Fahrzeug? Nenne das Kennzeichen oder den Fahrer.', kontext };
    return {
      answer: ziel.slice(0, 15).map((v: any) => `${v.brand_model || 'Fahrzeug'}${v.license_plate ? ` (${v.license_plate})` : ''}: ${
        v.range_km != null ? `${Math.round(Number(v.range_km))} km` : 'Reichweite unbekannt'}${v.battery_fuel_percent != null ? `, ${Math.round(Number(v.battery_fuel_percent))} %` : ''}`).join('\n'),
      kontext,
    };
  }

  // Freie Fahrzeuge: keinem Fahrer zugeordnet.
  if (/\b(fahrzeug\w*|auto\w*|wagen)\b/.test(text) && /\b(frei|unbenutzt|uebrig|ohne fahrer|nicht zugeordnet)\b/.test(text) && /^\s*(welche\w*|gibt|ist|sind|wie viele|zeig\w*)\b|\?\s*$/.test(roh)) {
    const { data: v } = await admin.from('vehicles').select('id, license_plate, brand_model');
    const { data: p } = await admin.from('profiles').select('vehicle_id');
    const belegt = new Set((Array.isArray(p) ? p : []).map((x: any) => x.vehicle_id).filter(Boolean).map(String));
    const frei = (Array.isArray(v) ? v : []).filter((x: any) => !belegt.has(String(x.id)));
    return { answer: frei.length ? `Keinem Fahrer zugeordnet (${frei.length}):\n${frei.slice(0, 20).map((x: any) => `- ${x.brand_model || 'Fahrzeug'}${x.license_plate ? ` (${x.license_plate})` : ''}`).join('\n')}`
      : 'Alle Fahrzeuge sind einem Fahrer zugeordnet.', kontext };
  }

  // Fahrzeug aendern: Kennzeichen, Farbe, Sitze
  const plates = [...roh.matchAll(PLATE_RE)];
  if (plates.length && /\b(aender\w*|setz\w*|mach\w*)\b/.test(text) && /\b(kennzeichen|farbe|sitze|sitzplaetze)\b/.test(text)) {
    const { data } = await admin.from('vehicles').select('id, license_plate, brand_model, color, seat_count');
    const v = (Array.isArray(data) ? data : []).find((x: any) => plateKey(x.license_plate || '') === plateKey(plates[0][0]));
    if (!v) return { answer: `Das Fahrzeug ${plates[0][0]} finde ich nicht.`, kontext };
    const name = `${v.brand_model || 'Fahrzeug'} (${v.license_plate})`;
    if (/\bkennzeichen\b/.test(text)) {
      if (plates.length < 2) return { answer: 'Auf welches Kennzeichen? Zum Beispiel „Ändere das Kennzeichen von M-TR 101 auf M-TR 111“.', kontext };
      const k = plates[1][0].toUpperCase().replace(/^([A-ZÄÖÜ]{1,3})[- ]?([A-Z]{1,2})[- ]?(\d{1,4}[EH]?)$/, '$1-$2 $3');
      return frage(kontext, { art: 'feld', tabelle: 'vehicles', id: v.id, neu: { license_plate: k }, titel: `Kennzeichen ${v.license_plate} → ${k}` }, `${name}: Kennzeichen auf ${k} ändern? Mit „ja“ speichere ich es.`);
    }
    if (/\bfarbe\b/.test(text)) {
      const farbe = roh.match(/\bfarbe\s*(?:auf|zu|in|:)?\s*([A-Za-zäöüß-]+)\s*$/i)?.[1] || roh.match(/\bauf\s+([A-Za-zäöüß-]+)\s*$/i)?.[1];
      if (!farbe) return { answer: 'Welche Farbe?', kontext };
      return frage(kontext, { art: 'feld', tabelle: 'vehicles', id: v.id, neu: { color: farbe.toLowerCase() }, titel: `Farbe von ${name} → ${farbe}` }, `${name}: Farbe auf ${farbe.toLowerCase()} ändern? Mit „ja“ speichere ich es.`);
    }
    const sitze = text.match(/\b(\d{1,2})\s*(sitz\w*|plaetze)?\s*$/)?.[1] || text.match(/\bauf\s+(\d{1,2})\b/)?.[1];
    if (!sitze) return { answer: 'Wie viele Sitze?', kontext };
    return frage(kontext, { art: 'feld', tabelle: 'vehicles', id: v.id, neu: { seat_count: Number(sitze) }, titel: `Sitze von ${name} → ${sitze}` }, `${name}: ${sitze} Sitze eintragen? Mit „ja“ speichere ich es.`);
  }

  // Flagge
  if (/\bflagge\w*\b|\bmarkier\w*\b.*\b(rot|pink|blau|cyan|tuerkis|hellblau|koenigsblau)\b/.test(text)) {
    const fahrer = await genannteFahrer(admin, text);
    if (!fahrer.length) return null;
    const weg = /\b(weg|entfern\w*|loesch\w*|ohne|keine|raus)\b/.test(text);
    const nr = text.match(/\bflagge\s*(\d)\b/)?.[1];
    const flagge = weg ? null
      : nr && ['1', '2', '3'].includes(nr) ? `flagge${nr}`
      : /\b(cyan|tuerkis\w*|hellblau\w*)\b/.test(text) ? 'flagge1'
      : /\b(pink\w*|rot\w*|rosa\w*|magenta\w*)\b/.test(text) ? 'flagge2'
      : /\b(blau\w*|koenigsblau\w*|dunkelblau\w*)\b/.test(text) ? 'flagge3'
      : undefined;
    if (flagge === undefined) return { answer: 'Welche Flagge? Es gibt Flagge 1 (Cyan), Flagge 2 (Pink) und Flagge 3 (Königsblau).', kontext };
    const name = flagge ? { flagge1: 'Flagge 1 (Cyan)', flagge2: 'Flagge 2 (Pink)', flagge3: 'Flagge 3 (Königsblau)' }[flagge] : 'keine Flagge';
    if (fahrer.length > 1) return { answer: 'Flaggen setze ich im Chat einzeln. Nenne einen Fahrer, für mehrere geht es auf der Karte mit den Kästchen.', kontext };
    return frage(kontext, { art: 'feld', tabelle: 'profiles', id: fahrer[0].id, neu: { flagge }, titel: `${fahrer[0].name}: ${name}` }, `${fahrer[0].name} ${flagge ? `mit ${name} markieren` : 'ohne Flagge'}? Mit „ja“ speichere ich es.`);
  }

  // Gast anlegen
  if (/\b(leg\w*|anleg\w*|erstell\w*|hinzufueg\w*|neue[nrs]?)\b/.test(text) && /\b(gast|fahrgast|passagier)\b/.test(text) && !/\b(fahrt|buch\w*)\b/.test(text)) {
    const name = roh.match(/\b(?:[Gg]ast|[Ff]ahrgast|[Pp]assagier(?:in)?)\s+(?:namens\s+)?((?:(?:Herr|Frau|Dr\.?)\s+)?[A-ZÄÖÜ][\wäöüß'-]+(?:\s+[A-ZÄÖÜ][\wäöüß'-]+)?)/)?.[1];
    if (!name) return { answer: 'Wie heißt der Gast? Zum Beispiel „Leg den Gast Uli Hoeneß an, Telefon 0170 1234567“.', kontext };
    const teile = name.replace(/^(Herr|Frau|Dr\.?)\s+/, '').split(/\s+/);
    const daten: any = { first_name: teile.length > 1 ? teile[0] : null, last_name: teile[teile.length - 1] };
    const tel = roh.match(/\b(?:tel\w*|handy|mobil|nummer)\s*:?\s*(\+?\d[\d\s/-]{5,}\d)/i)?.[1] || roh.match(TELEFON)?.[1];
    const mail = roh.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
    const firma = roh.match(/\b(?:firma|von der|von)\s+([A-ZÄÖÜ][\w&.-]+(?:\s+[A-ZÄÖÜ][\w&.-]+)?)/)?.[1];
    if (tel) daten.phone = tel.trim();
    if (mail) daten.email = mail.toLowerCase();
    if (firma && !/^(Herr|Frau)$/.test(firma)) daten.company = firma;
    if (/\bvip\b/.test(text)) daten.is_vip = true;
    if (/\bkindersitz\b/.test(text)) daten.needs_child_seat = true;
    const { data: gleich } = await admin.from('guests').select('id').ilike('last_name', daten.last_name).limit(20);
    const titel = [daten.first_name, daten.last_name].filter(Boolean).join(' ');
    const extra = [daten.phone && `Telefon ${daten.phone}`, daten.email, daten.company, daten.is_vip && 'VIP', daten.needs_child_seat && 'Kindersitz'].filter(Boolean).join(', ');
    return frage(kontext, { art: 'gast', daten, titel },
      `Neuer Gast: ${titel}${extra ? `, ${extra}` : ''}.${Array.isArray(gleich) && gleich.length ? ` Hinweis: Es gibt schon ${gleich.length === 1 ? 'einen Gast' : `${gleich.length} Gäste`} mit Nachnamen ${daten.last_name}.` : ''} Mit „ja“ lege ich ihn an.`);
  }

  // Gast aendern: Telefon, E-Mail, Firma
  if (/\b(aender\w*|setz\w*|neue)\b/.test(text) && /\b(telefon\w*|nummer|handy|e-?mail|firma)\b/.test(text)) {
    const fahrer = await genannteFahrer(admin, text);
    const istTel = /\b(telefon\w*|nummer|handy)\b/.test(text);
    const istMail = /\be-?mail\b/.test(text);
    const wert = istTel ? roh.match(/\bauf\s+(\+?\d[\d\s/-]{5,}\d)/)?.[1] || roh.match(TELEFON)?.[1]
      : istMail ? roh.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] : roh.match(/\bauf\s+(.+)$/)?.[1];
    if (!wert) return { answer: istTel ? 'Auf welche Nummer?' : istMail ? 'Auf welche E-Mail?' : 'Auf welche Firma?', kontext };
    if (fahrer.length === 1) {
      if (!istTel) return { answer: 'Bei Fahrern ändere ich im Chat nur die Telefonnummer. E-Mail und Login unter Fahrer bearbeiten.', kontext };
      return frage(kontext, { art: 'feld', tabelle: 'profiles', id: fahrer[0].id, neu: { phone: wert.trim() }, titel: `Telefon von ${fahrer[0].name} → ${wert.trim()}` },
        `Telefonnummer von ${fahrer[0].name} auf ${wert.trim()} ändern? Mit „ja“ speichere ich es.`);
    }
    const { data } = await admin.from('guests').select('id, first_name, last_name');
    const treffer = (Array.isArray(data) ? data : []).filter((g: any) => {
      const voll = normal(`${g.first_name || ''} ${g.last_name || ''}`).trim();
      return voll && new RegExp(`\\b${voll}s?\\b`).test(text);
    });
    if (treffer.length !== 1) return treffer.length ? { answer: 'Mehrere Gäste passen, nenne Vor- und Nachnamen.', kontext } : null;
    const g = treffer[0];
    const name = `${g.first_name || ''} ${g.last_name || ''}`.trim();
    const feld = istTel ? 'phone' : istMail ? 'email' : 'company';
    return frage(kontext, { art: 'feld', tabelle: 'guests', id: g.id, neu: { [feld]: wert.trim() }, titel: `${istTel ? 'Telefon' : istMail ? 'E-Mail' : 'Firma'} von ${name} → ${wert.trim()}` },
      `${istTel ? 'Telefonnummer' : istMail ? 'E-Mail' : 'Firma'} von ${name} auf ${wert.trim()} ändern? Mit „ja“ speichere ich es.`);
  }

  // Fahrernummer
  const nummer = text.match(/\bfahrernummer\s*(?:auf|zu)?\s*(\d{1,4})\b|\b(?:nummer|nr)\s*(\d{1,4})\b/);
  if (nummer && /\b(fahrernummer|gib\w*|setz\w*|aender\w*)\b/.test(text) && !/\b(fahrt|tracker|telefon)\b/.test(text)) {
    const n = nummer[1] || nummer[2];
    const fahrer = (await genannteFahrer(admin, text.replace(/\b(fahrer)?nummer\s*\d+/, ' '))).filter(Boolean);
    if (fahrer.length !== 1) return null;
    const { data: belegt } = await admin.from('profiles').select('id, first_name, last_name').eq('driver_number', Number(n)).maybeSingle();
    if (belegt && String(belegt.id) !== fahrer[0].id) return { answer: `Die Nummer ${n} hat schon ${[belegt.first_name, belegt.last_name].filter(Boolean).join(' ')}.`, kontext };
    return frage(kontext, { art: 'feld', tabelle: 'profiles', id: fahrer[0].id, neu: { driver_number: Number(n) }, titel: `${fahrer[0].name}: Fahrernummer ${n}` },
      `${fahrer[0].name} bekommt die Fahrernummer ${n}? Mit „ja“ speichere ich es.`);
  }

  // Ort anlegen
  if (/\b(leg\w*|anleg\w*|erstell\w*|neue[nrs]?|speicher\w*)\b/.test(text) && /\bort\b/.test(text) && !/\b(fahrt|standby|fahrzeug)\b/.test(text)) {
    const m = roh.match(/\bOrt\s+(?:namens\s+)?(.+?)(?:\s+an)?(?:,\s*|\s+(?:adresse|in|bei)\s*:?\s*)(.+?)(?:\s+an)?\s*$/i);
    const name = m?.[1]?.replace(/["„“”]/g, '').trim();
    const adresse = m?.[2]?.replace(/\s+an$/i, '').trim();
    if (!name || !adresse) return { answer: 'Wie heißt der Ort und wo ist er? Zum Beispiel „Leg den Ort Messe Eingang West an, Am Messesee 2 München“.', kontext };
    const schluessel = await tomtomSchluessel(admin).catch(() => '');
    const p = schluessel ? await geocode(admin, schluessel, adresse).catch(() => null) : null;
    if (!p) return { answer: `Die Adresse „${adresse}“ finde ich nicht. Schreib sie genauer, mit Straße und Stadt.`, kontext };
    return frage(kontext, { art: 'ort', daten: { name, adresse, lat: p.lat, lng: p.lon, radius_rein_m: 150, radius_raus_m: 300 } },
      `Neuer Ort: ${name}, ${adresse}. Mit „ja“ lege ich ihn an, den Punkt kannst du danach auf der Karte verschieben.`);
  }

  // Stundenzettel bestaetigen / zurueckgeben
  if (/\bstunden\w*|\bzettel\b/.test(text) && /\b(bestaetig\w*|freigeb\w*|annehm\w*|zurueck\w*|ablehn\w*)\b/.test(text)) {
    const zurueck = /\b(zurueck\w*|ablehn\w*)\b/.test(text);
    const alle = /\b(alle[nm]?)\b/.test(text);
    const fahrer = alle ? [] : await genannteFahrer(admin, text);
    if (!alle && !fahrer.length) return { answer: 'Von welchem Fahrer? Oder „Bestätige alle offenen Stundenzettel“.', kontext };
    let q = admin.from('stundenzettel').select('id, driver_id, datum, arbeits_min, status').eq('status', 'eingereicht');
    if (fahrer.length) q = q.in('driver_id', fahrer.map((f) => f.id));
    const hatTag = /\b(heute|gestern|morgen|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\b|\b[0-3]?\d\.[01]?\d\./.test(text);
    if (hatTag) q = q.eq('datum', /\bgestern\b/.test(text) ? plusTage(heute, -1) : datumAusText(text, heute));
    const { data } = await q;
    const zettel = Array.isArray(data) ? data : [];
    if (!zettel.length) return { answer: 'Es gibt keinen offenen Stundenzettel dazu.', kontext };
    const namen = new Map((await alleFahrer(admin)).map((f) => [f.id, f.name]));
    const h = (m: number) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, '0')} h`;
    return frage(kontext, { art: 'stunden', ids: zettel.map((z: any) => String(z.id)), status: zurueck ? 'zurueckgewiesen' : 'bestaetigt', dispoId },
      `${zurueck ? 'Zurückgeben' : 'Bestätigen'}:\n${zettel.slice(0, 12).map((z: any) => `- ${namen.get(String(z.driver_id)) || 'Fahrer'}, ${tagLesbar(String(z.datum), heute)}, ${h(Number(z.arbeits_min || 0))}`).join('\n')}${zettel.length > 12 ? `\n… und ${zettel.length - 12} weitere` : ''}\nMit „ja“ ${zurueck ? 'gebe ich sie zurück' : 'bestätige ich sie'}.`);
  }

  // Stunden-Export: Datei geht im Chat nicht, also den Weg zeigen.
  if (/\b(export\w*|excel|abrechnung|auswert\w*)\b/.test(text) && /\bstunden\b/.test(text)) {
    return { answer: 'Die Excel-Datei erstelle ich im Chat nicht. Unter Fahrer, Stunden, Export wählst du den Zeitraum und lädst sie herunter.', kontext };
  }

  // Planung: grobe Schaetzung, wie viele Fahrer gleichzeitig unterwegs sind.
  if (/\b(wie viele|wieviele|wieviel)\s+fahrer\b.*\b(brauch\w*|noetig|benoetig\w*)\b/.test(text)) {
    const tag = datumAusText(text, heute);
    const { data } = await admin.from('jobs').select('etd, ext_route_duration_mins, status, ride_date').eq('ride_date', tag);
    const fahrten = (Array.isArray(data) ? data : []).filter((j: any) => !['cancelled', 'refused'].includes(String(j.status)) && j.etd);
    if (!fahrten.length) return { answer: `${tagLesbar(tag, heute).replace(/^./, (c) => c.toUpperCase())} gibt es keine Fahrten.`, kontext };
    const z = (t: string) => Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5));
    // Je Fahrt: Abfahrt bis Ankunft plus 30 Minuten Anfahrt und Puffer.
    const spannen = fahrten.map((j: any) => [z(j.etd) - 15, z(j.etd) + Number(j.ext_route_duration_mins || 45) + 15]);
    let max = 0;
    let wann = 0;
    for (const [a] of spannen) {
      const n = spannen.filter(([x, y]) => x <= a && y > a).length;
      if (n > max) { max = n; wann = a; }
    }
    const uhr = `${String(Math.floor(Math.max(0, wann) / 60)).padStart(2, '0')}:${String(Math.max(0, wann) % 60).padStart(2, '0')}`;
    return { answer: `${tagLesbar(tag, heute).replace(/^./, (c) => c.toUpperCase())}: ${fahrten.length} Fahrten, höchstens ${max} gleichzeitig (gegen ${uhr}). Du brauchst also mindestens ${max} Fahrer, mit Pausen und Rückwegen eher ${Math.ceil(max * 1.3)}. Das ist eine grobe Schätzung, genau rechnet der KI-Planer.`, kontext };
  }
  if (/\b(plan\w*|verteil\w*|optimier\w*)\b/.test(text) && /\bfahrten\b/.test(text) && /\b(neu|alle|optimal|automatisch)\b/.test(text)) {
    return { answer: 'Das Neuplanen mit der Engine starte ich im Chat noch nicht. Öffne Planung, KI-Planer, dort siehst du den Vorschlag und übernimmst ihn. Einzelne Fahrer setze ich dir gern hier, z. B. „Setze Tim auf die Fahrt von Herrn Engel“.', kontext };
  }

  return null;
};
