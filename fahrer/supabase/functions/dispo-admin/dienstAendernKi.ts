// Dienste per KI-Assistent loeschen oder teilweise leeren, und mehrere Dienste auf einmal senden.
//
//   "Lösch das Dienstende für Samstag Stefano"   -> service_end_time leer
//   "Dienststart von Tim morgen streichen"       -> service_start_time leer (ohne Ende: ganzer Dienst weg)
//   "Pause von Anna morgen löschen"              -> dienst_pausen leer
//   "Dienst von Marvin am Freitag absagen"       -> Dienst geloescht (wie in Fahrer > Dienste)
// Immer erst Rueckfrage mit dem heutigen Stand, "ja" fuehrt aus, "nein" verwirft. Die offene Rueckfrage
// reist im Kontext (offeneDienstLoeschung), daher ohne neuen App-Build.
//
// offeneDienste: mehrere Dienste aus einer Nachricht ("heute 22:00 und Samstag 7:30"), siehe dienst.ts.

// deno-lint-ignore-file no-explicit-any
import { TAG_RE, alleFahrer, datumAusText, dienstSenden, genannteFahrer, jetztBerlin, normal, tagLesbar, wocheBereich } from './dienst.ts';

type Fahrer = { id: string; name: string };
const FRIST_MS = 15 * 60 * 1000;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|okey|klar|genau|passt|stimmt|richtig|mach(s|e)?( das)?|machen|senden|schick(s|e)?( ab)?|loesch(e|en)?|bestaetig(e|en|t)?|in ordnung|gerne|bitte|los)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|abbruch|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht)\b/;
// Nicht "sag ... ab": "Sag Tim Dienststart ab 8" ist ein Start.
const WEG_RE = /\b(loesch\w*|losch\w*|entfern\w*|streich\w*|absag\w*|storn\w*|aufheb\w*|weg|rausnehm\w*|zuruecknehm\w*|rueckgaengig)\b/;

type Art = 'ende' | 'start' | 'pausen' | 'dienst';
type Eintrag = { id: string; fahrerId: string; name: string; datum: string; start: string | null; ende: string | null; status: string };

const ohne = (kontext: any, ...felder: string[]) => {
  const k = { ...(kontext || {}) };
  for (const f of felder) delete k[f];
  return k;
};
const hm = (t: unknown) => (t ? String(t).slice(0, 5) : null);
const zeitText = (e: Eintrag) => (e.start && e.ende ? `${e.start}–${e.ende}` : e.start ? `ab ${e.start}` : e.ende ? `bis ${e.ende}` : 'ohne Zeiten');
const ART_FERTIG: Record<Art, string> = { ende: 'Dienstende entfernt', start: 'Dienststart entfernt', pausen: 'Pausen entfernt', dienst: 'Dienst gelöscht' };
const ART_TEXT: Record<Art, string> = { ende: 'das Dienstende entfernen', start: 'den Dienststart entfernen', pausen: 'alle Pausen entfernen', dienst: 'den ganzen Dienst löschen' };

// Offene Rueckfragen: mehrere Dienste senden oder eine Loeschung ausfuehren.
export const dienstOffenAntwort = async (admin: any, frage: string, kontext: any) => {
  const roh = String(frage || '').trim();
  const text = normal(roh);
  if (roh.length > 60 || /\?/.test(roh)) return null;

  const mehrere = kontext?.offeneDienste;
  if (mehrere && Date.now() - Number(mehrere.zeit || 0) < FRIST_MS) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts gesendet.', kontext: ohne(kontext, 'offeneDienste') };
    if (JA_RE.test(text)) {
      const { datum: heute } = jetztBerlin();
      const zeilen: string[] = [];
      for (const v of Array.isArray(mehrere.liste) ? mehrere.liste : []) {
        const r: any = await dienstSenden(admin, { datum: v.datum, start: v.start, ende: v.ende, pausen: v.pausen, fahrerIds: v.fahrerIds });
        const tag = tagLesbar(v.datum, heute);
        zeilen.push(r?.daten?.ok ? `${tag}: gesendet` : `${tag}: nicht gesendet (${r?.daten?.error || 'Fehler'})`);
      }
      return { answer: `${zeilen.join('\n')}\nDie Fahrer müssen die Dienste bestätigen.`, kontext: ohne(kontext, 'offeneDienste') };
    }
  }

  const offen = kontext?.offeneDienstLoeschung;
  if (offen && Date.now() - Number(offen.zeit || 0) < FRIST_MS) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts geändert.', kontext: ohne(kontext, 'offeneDienstLoeschung') };
    if (JA_RE.test(text)) {
      const fertig: string[] = [];
      for (const e of (offen.dienste || []) as Eintrag[]) {
        const f = await ausfuehren(admin, offen.art as Art, e);
        fertig.push(f ? `${e.name}, ${tagLesbar(e.datum, jetztBerlin().datum)}: nicht geändert (${f})` : `${e.name}, ${tagLesbar(e.datum, jetztBerlin().datum)}: erledigt`);
      }
      return { answer: `${ART_FERTIG[offen.art as Art]}:\n${fertig.join('\n')}`, kontext: ohne(kontext, 'offeneDienstLoeschung') };
    }
  }
  return null;
};

const profilLeeren = async (admin: any, fahrerId: string, datum: string, felder: ('start' | 'ende')[]) => {
  const { data: p } = await admin.from('profiles').select('service_start_date, service_end_date').eq('id', fahrerId).maybeSingle();
  const leer: Record<string, null> = {};
  if (felder.includes('start') && (!p?.service_start_date || p.service_start_date === datum)) Object.assign(leer, { service_start_time: null, service_start_date: null });
  if (felder.includes('ende') && (!p?.service_end_date || p.service_end_date === datum)) Object.assign(leer, { service_end_time: null, service_end_date: null });
  if (Object.keys(leer).length) await admin.from('profiles').update(leer).eq('id', fahrerId);
};

// Fuehrt eine Loeschung aus. Liefert Fehlertext oder ''.
const ausfuehren = async (admin: any, art: Art, e: Eintrag): Promise<string> => {
  const jetzt = new Date().toISOString();
  // Start weg, aber kein Ende: dann bleibt kein Dienst uebrig, also ganz loeschen. Gleiches fuer Ende ohne Start.
  const ganz = art === 'dienst' || (art === 'start' && !e.ende) || (art === 'ende' && !e.start);
  if (ganz) {
    await admin.from('dienst_pausen').delete().eq('dienst_id', e.id);
    const { error } = await admin.from('driver_service_requests').delete().eq('id', e.id);
    if (error) return error.message;
    await profilLeeren(admin, e.fahrerId, e.datum, ['start', 'ende']);
    return '';
  }
  if (art === 'pausen') {
    const { error } = await admin.from('dienst_pausen').delete().eq('dienst_id', e.id);
    return error ? error.message : '';
  }
  const feld = art === 'ende' ? 'service_end_time' : 'service_start_time';
  const { error } = await admin.from('driver_service_requests').update({ [feld]: null, updated_at: jetzt }).eq('id', e.id);
  if (error) return error.message;
  await profilLeeren(admin, e.fahrerId, e.datum, [art]);
  return '';
};

// Rueckfrage zum Loeschen. fuerFahrer: markierte Fahrer oder der aus dem Gespraech, wenn keiner genannt ist.
export const dienstLoeschenVorschlag = async (admin: any, frage: string, kontext: any, fuerFahrer: Fahrer[]) => {
  const roh = String(frage || '').trim();
  const text = normal(roh);
  if (!WEG_RE.test(text)) return null;
  if (!/\b(dienst\w*|dienstart|schicht\w*|feierabend|pause\w*)\b/.test(text)) return null;
  if (/\b(fahrt|fahrten|buchung|standby)\b/.test(text)) return null;
  if (/^\s*(wie|kann|darf|wer|warum|wieso)\b/.test(text) && /\?\s*$/.test(roh)) return null;

  const art: Art = /pause/.test(text) ? 'pausen'
    : /dienstende|feierabend|schichtende|\bende\b/.test(text) ? 'ende'
    : /dienststart|dienstart|dienstbeginn|\bstart\b|\bbeginn\b|\banfang\b/.test(text) ? 'start'
    : 'dienst';

  const alle = /\b(alle[nm]?|saemtliche[n]?)\s+fahrer(n)?\b/.test(text);
  let fahrer: Fahrer[] = alle ? await alleFahrer(admin) : await genannteFahrer(admin, text);
  if (!fahrer.length) fahrer = fuerFahrer;
  if (!fahrer.length) return { answer: 'Bei welchem Fahrer? Nenne mir den Namen, z. B. „Lösch das Dienstende von Tim am Samstag“.', kontext };

  // Datum genannt: dieser Tag. Sonst der naechste Dienst ab heute.
  const { datum: heute } = jetztBerlin();
  const hatTag = TAG_RE.test(text);
  // "alle Dienste von Tim nächste Woche": jeder Dienst in der Woche, nicht nur der erste.
  const woche = wocheBereich(text, heute);
  const datum = !woche && hatTag ? datumAusText(text, heute) : null;
  let q = admin.from('driver_service_requests')
    .select('id, driver_id, service_date, service_start_time, service_end_time, status, created_at')
    .in('driver_id', fahrer.map((f) => f.id)).in('status', ['pending', 'accepted']);
  q = woche ? q.gte('service_date', woche.von < heute ? heute : woche.von).lte('service_date', woche.bis)
    : datum ? q.eq('service_date', datum) : q.gte('service_date', heute);
  const { data } = await q.order('service_date', { ascending: true });
  const zeilen = Array.isArray(data) ? data : [];
  // Je Fahrer der erste passende (juengste Anfrage des Tages).
  const dienste: Eintrag[] = [];
  for (const f of fahrer) {
    const eigene = zeilen.filter((d: any) => String(d.driver_id) === f.id);
    if (!eigene.length) continue;
    if (woche) {
      // Je Tag die juengste Anfrage.
      for (const tag of [...new Set(eigene.map((d: any) => String(d.service_date)))]) {
        const d = eigene.filter((x: any) => String(x.service_date) === tag).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];
        dienste.push({ id: String(d.id), fahrerId: f.id, name: f.name, datum: tag, start: hm(d.service_start_time), ende: hm(d.service_end_time), status: String(d.status) });
      }
      continue;
    }
    const tag = eigene[0].service_date;
    const d = eigene.filter((x: any) => x.service_date === tag).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    dienste.push({ id: String(d.id), fahrerId: f.id, name: f.name, datum: String(d.service_date), start: hm(d.service_start_time), ende: hm(d.service_end_time), status: String(d.status) });
  }
  const tagWort = woche ? 'in der Woche' : datum ? tagLesbar(datum, heute) : 'ab heute';
  if (!dienste.length) {
    return { answer: `${fahrer.length === 1 ? `${fahrer[0].name} hat` : 'Keiner der Fahrer hat'} ${tagWort} keinen Dienst. Es gibt nichts zu löschen.`, kontext };
  }
  const ohneDienst = fahrer.filter((f) => !dienste.some((d) => d.fahrerId === f.id));
  // Pruefen, ob es das Feld ueberhaupt gibt.
  const leer = dienste.filter((d) => (art === 'ende' && !d.ende) || (art === 'start' && !d.start));
  if (leer.length === dienste.length) {
    return { answer: `${dienste.map((d) => `${d.name} ${tagLesbar(d.datum, heute)} (${zeitText(d)})`).join(', ')}: ${art === 'ende' ? 'kein Dienstende' : 'kein Dienststart'} eingetragen, nichts zu löschen.`, kontext };
  }
  const zeilenText = dienste.map((d) => `${d.name}, ${tagLesbar(d.datum, heute)} (${zeitText(d)}${d.status === 'accepted' ? ', angenommen' : ', noch nicht bestätigt'})`);
  const folge = dienste.some((d) => (art === 'start' && !d.ende) || (art === 'ende' && !d.start))
    ? ' Ohne Start und Ende bleibt kein Dienst übrig, dann lösche ich ihn ganz.' : '';
  return {
    answer: `Bei ${zeilenText.join(' und ')} ${ART_TEXT[art]}?${folge}`
      + `${ohneDienst.length ? ` ${ohneDienst.map((f) => f.name).join(', ')} ${ohneDienst.length === 1 ? 'hat' : 'haben'} ${tagWort} keinen Dienst.` : ''}`
      + ' Mit „ja“ ändere ich es, mit „nein“ breche ich ab.',
    kontext: { ...ohne(kontext, 'offeneDienste'), offeneDienstLoeschung: { art, dienste, zeit: Date.now() } },
  };
};
