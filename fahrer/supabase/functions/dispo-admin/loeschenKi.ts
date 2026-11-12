// Fahrer und Fahrzeuge per KI-Assistent loeschen:
//   "Lösche den Fahrer Max Mustermann", "Entferne Fertel Garlo und Marvin Hallo", "Lösche das Fahrzeug M-TR 105"
// Endgueltig und nicht rueckgaengig: erst eine Rueckfrage mit allen Namen und Folgen, geloescht wird nur auf
// "löschen" (ein einfaches "ja" reicht nicht), "nein" verwirft. "Alle" auf einmal loescht der Assistent nie.
// Fahrer: wie aktion konto_loeschen (konto.ts kontoLoeschen). Fahrzeug: Zeile in vehicles, Zuordnungen fallen weg.
// Fahrten bleiben immer erhalten. Die offene Rueckfrage reist im Kontext (offenesLoeschen).

// deno-lint-ignore-file no-explicit-any
import { genannteFahrer, normal } from './dienst.ts';
import { kontoLoeschen } from './konto.ts';
import { PLATE_RE, plateKey } from './zuordnenKi.ts';

const FRIST_MS = 10 * 60 * 1000;
const LOESCH_RE = /\b(loesch\w*|losch\w*|entfern\w*)\b/;
const BESTAETIGT_RE = /^\s*(ja[,!.]?\s+)?(endgueltig\s+|endgultig\s+|wirklich\s+)?(loeschen|loesche|losch\w*|loesch\w*)\b/;
const JA_RE = /^\s*(ja|jo|jap|yes|ok|okay|klar|genau|passt|mach(s|e)?|bitte)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|abbruch|stopp?|lass(e|en)? (es|das)|vergiss|doch nicht|behalten)\b/;

type Eintrag = { id: string; name: string };
type Offen = { fahrer: Eintrag[]; fahrzeuge: Eintrag[]; zeit: number };

const ohneOffenes = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offenesLoeschen;
  return k;
};
const fahrzeugName = (v: any) => `${v.brand_model || 'Fahrzeug'}${v.license_plate ? ` (${v.license_plate})` : ''}`;

const FEHLER: Record<string, string> = {
  ride_running: 'hat gerade eine laufende Fahrt',
  not_a_driver: 'ist kein Fahrerkonto',
};

export const loeschenVorschlag = async (admin: any, frage: string, kontext: any, dispoId: string | null) => {
  const roh = String(frage || '').trim();
  const text = normal(roh);
  const offen: Offen | undefined = kontext?.offenesLoeschen;

  if (offen && Date.now() - Number(offen.zeit || 0) < FRIST_MS && roh.length <= 60) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts gelöscht.', kontext: ohneOffenes(kontext) };
    if (BESTAETIGT_RE.test(text) && !/\?/.test(roh)) {
      const zeilen: string[] = [];
      for (const f of offen.fahrer) {
        if (f.id === dispoId) { zeilen.push(`${f.name}: dein eigenes Konto lösche ich nicht.`); continue; }
        const r = await kontoLoeschen(admin, f.id);
        zeilen.push('fehler' in r ? `${f.name} nicht gelöscht, ${FEHLER[r.fehler] || r.fehler}.` : `${f.name} gelöscht.`);
      }
      for (const v of offen.fahrzeuge) {
        await admin.from('profiles').update({ vehicle_id: null }).eq('vehicle_id', v.id);
        await admin.from('obd_tracker').update({ vehicle_id: null }).eq('vehicle_id', v.id);
        const { data, error } = await admin.from('vehicles').delete().eq('id', v.id).select('id');
        zeilen.push(error ? `${v.name} nicht gelöscht (${error.message}).` : data?.length ? `${v.name} gelöscht.` : `${v.name} war schon gelöscht.`);
      }
      return { answer: zeilen.join('\n'), kontext: ohneOffenes(kontext) };
    }
    if (JA_RE.test(text) && !/\?/.test(roh)) {
      return { answer: 'Löschen geht nicht rückgängig. Schreib zur Sicherheit „löschen“, dann lösche ich es. Mit „nein“ breche ich ab.', kontext };
    }
  }

  if (!LOESCH_RE.test(text)) return null;
  // Fahrten loeschen bleibt an der Fahrt selbst (kiKern antwortet darauf).
  if (/\b(fahrt\w*|buchung\w*|standby|dienst\w*|pause\w*|notiz\w*|nachricht\w*|gast|gaeste)\b/.test(text)) return null;
  if (/^\s*(wie|kann|darf|wer|warum|wieso)\b/.test(text) && /\?\s*$/.test(roh)) return null;
  const istFahrzeug = /\b(fahrzeug\w*|auto\w*|wagen|kfz|pkw|kennzeichen)\b/.test(text) || [...roh.matchAll(PLATE_RE)].length > 0;
  const istFahrer = /\b(fahrer\w*|konto|konten|benutzer\w*|mitarbeiter\w*)\b/.test(text) || !istFahrzeug;
  if (/\b(alle|allen|saemtliche|samtliche|jeden|jedes)\b/.test(text)) {
    return { answer: 'Alle auf einmal lösche ich nicht. Nenne mir die Fahrer oder Fahrzeuge einzeln, z. B. „Lösche Fahrer Max Mustermann und das Fahrzeug M-TR 105“.', kontext };
  }

  const fahrer: Eintrag[] = istFahrer ? (await genannteFahrer(admin, text)).slice(0, 10) : [];
  const fahrzeuge: Eintrag[] = [];
  if (istFahrzeug) {
    const { data } = await admin.from('vehicles').select('id, license_plate, brand_model');
    const alle = Array.isArray(data) ? data : [];
    const gesehen = new Set<string>();
    for (const m of roh.matchAll(PLATE_RE)) {
      const v = alle.find((x: any) => x.license_plate && plateKey(x.license_plate) === plateKey(m[0]));
      if (v && !gesehen.has(v.id)) { gesehen.add(v.id); fahrzeuge.push({ id: v.id, name: fahrzeugName(v) }); }
    }
    // Ohne Kennzeichen: Marke und Modell, nur wenn genau ein Fahrzeug passt.
    if (!fahrzeuge.length) {
      const passend = alle.filter((x: any) => x.brand_model && normal(roh).includes(normal(x.brand_model).trim()));
      if (passend.length === 1) fahrzeuge.push({ id: passend[0].id, name: fahrzeugName(passend[0]) });
      else if (passend.length > 1) {
        return { answer: `Mehrere Fahrzeuge passen: ${passend.map(fahrzeugName).join(', ')}. Sag mir das Kennzeichen.`, kontext };
      }
    }
  }
  if (!fahrer.length && !fahrzeuge.length) {
    return {
      answer: istFahrzeug && !istFahrer
        ? 'Welches Fahrzeug soll ich löschen? Sag mir das Kennzeichen genau so, wie es in TRISAR steht.'
        : 'Welchen Fahrer soll ich löschen? Sag mir den vollen Namen oder die Fahrernummer.',
      kontext,
    };
  }
  const teile: string[] = [];
  if (fahrer.length) {
    teile.push(`Fahrer endgültig löschen: ${fahrer.map((f) => f.name).join(', ')}.`
      + ' Konto, Login, Standorte, Dienste und Stundenzettel sind danach weg, offene Fahrten werden wieder frei. Die Fahrten selbst bleiben.');
  }
  if (fahrzeuge.length) {
    teile.push(`Fahrzeug endgültig löschen: ${fahrzeuge.map((v) => v.name).join(', ')}.`
      + ' Fahrer- und Tracker-Zuordnung fallen weg, Fahrten bleiben.');
  }
  teile.push('Das geht nicht rückgängig. Schreib „löschen“, dann lösche ich es. Mit „nein“ breche ich ab.');
  return { answer: teile.join('\n'), kontext: { ...ohneOffenes(kontext), offenesLoeschen: { fahrer, fahrzeuge, zeit: Date.now() } } };
};
