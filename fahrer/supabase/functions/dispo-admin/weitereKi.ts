// Fehlgriffe aus der Abdeckungs-Pruefung (werkzeuge/ki-test/abdeckung.ts, 13.11.):
//   - Gaeste: "Welche Telefonnummer hat Julia Weber?" wurde als Fahrer gelesen -> gastFrage
//   - "Leg den Kunden BMW Group an" wurde eine Fahrzeug-Karte -> nochNichtAnlegen
//   - "Lösch/Verschieb den Standby von Tim morgen" legte einen neuen Standby an -> standbyAendern
// Aenderungen wie immer erst mit Rueckfrage, "ja" fuehrt aus (kontext.offeneStandbyAenderung).

// deno-lint-ignore-file no-explicit-any
import { TAG_RE, datumAusText, genannteFahrer, jetztBerlin, normal, tagLesbar, zeitenAusText } from './dienst.ts';

const FRIST_MS = 15 * 60 * 1000;
const JA_RE = /^\s*(ja|jo|jap|japp|yes|ok|okay|klar|genau|passt|mach(s|e)?( das)?|loesch(e|en)?|speicher(n|e)?|bestaetig\w*|in ordnung|gerne|bitte|los)\b/;
const NEIN_RE = /^\s*(nein|ne|nee|nope|nicht|abbrechen|stopp?|lass(e|en)? (es|das)|vergiss|verwerfen|doch nicht)\b/;
const hm = (t: unknown) => (t ? String(t).slice(0, 5) : '');

// ---- Kunden, Orte, Gaeste anlegen: gibt es im Chat noch nicht, also ehrlich sagen statt falsch anlegen ----

export const nochNichtAnlegen = (frage: string) => {
  const text = normal(frage);
  if (!/\b(leg\w*|anleg\w*|erstell\w*|hinzufueg\w*|fueg\w*|neue[nrs]?)\b/.test(text)) return null;
  if (/\b(fahrt|fahrten|buch\w*|fahrer|dienst\w*|standby)\b/.test(text)) return null;
  if (/\b(kunde[n]?|kundin|firma|auftraggeber)\b/.test(text)) {
    return 'Kunden lege ich im Chat noch nicht an. Die Firma eines Gastes trägst du beim Gast unter Fahrgäste ein.';
  }
  return null;
};

// ---- Gaeste: Telefon, E-Mail, Adresse, Firma, Hinweise ----

export const gastFrage = async (admin: any, frage: string) => {
  const text = normal(frage);
  const was = /\b(telefon\w*|nummer|handy\w*|mobil\w*|anruf\w*)\b/.test(text) ? 'telefon'
    : /\b(e-?mail|mail)\b/.test(text) ? 'email'
    : /\b(adresse|wohnt|anschrift)\b/.test(text) ? 'adresse'
    : /\b(firma|kunde|arbeitet bei)\b/.test(text) ? 'firma'
    : /\b(kindersitz|rollstuhl|vip|gepaeck|besonder\w*|hinweis\w*|notiz\w*)\b/.test(text) ? 'hinweise'
    : null;
  if (!was) return null;
  // Nur Fragen. "Gib der Fahrt von Herrn Engel die Notiz Kindersitz" ist ein Auftrag an der Fahrt.
  if (/\b(aender\w*|setz\w*|trag\w*|neue|gib|geb\w*|mach\w*|schreib\w*|fueg\w*|fahrt|fahrten)\b/.test(text)) return null;
  // "Braucht Frau Weber einen Kindersitz" ist auch ohne Fragezeichen eine Frage (15.11.).
  if (!/^\s*(wie|was|welche\w*|wo|wer|hat|ist|gibt|zeig\w*|sag\w*|nenn\w*|bei|braucht|benoetigt|bekommt|muss|sitzt)\b/.test(text) && !/\?\s*$/.test(String(frage || ''))) return null;
  // Fahrer gehen vor ("Welche Telefonnummer hat Tim?"): Telefon und E-Mail direkt aus dem Profil.
  const fahrer = await genannteFahrer(admin, text);
  if (fahrer.length === 1 && (was === 'telefon' || was === 'email')) {
    const { data: p } = await admin.from('profiles').select('phone, email').eq('id', fahrer[0].id).maybeSingle();
    const wert = was === 'telefon' ? p?.phone : p?.email;
    const art = was === 'telefon' ? 'Telefonnummer' : 'E-Mail';
    return wert ? `Die ${art} von ${fahrer[0].name} ist ${wert}.` : `Für ${fahrer[0].name} ist keine ${art} hinterlegt.`;
  }
  if (fahrer.length) return null;
  const { data } = await admin.from('guests').select('id, first_name, last_name, phone, email, company, street, street_number, zip, city, notes, note_text, is_vip, needs_child_seat, needs_accessibility, needs_luggage');
  const gaeste = Array.isArray(data) ? data : [];
  const wort = (w: string) => w && w.length >= 2 && new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(text);
  let treffer = gaeste.filter((g: any) => wort(normal(`${g.first_name || ''} ${g.last_name || ''}`).trim()));
  if (!treffer.length) {
    const nach = gaeste.filter((g: any) => wort(normal(g.last_name || '').trim()));
    treffer = nach;
  }
  if (!treffer.length) return null;
  if (treffer.length > 1) return `Mehrere Gäste passen: ${treffer.slice(0, 5).map((g: any) => `${g.first_name || ''} ${g.last_name || ''}`.trim()).join(', ')}. Nenne Vor- und Nachnamen.`;
  const g = treffer[0];
  const name = `${g.first_name || ''} ${g.last_name || ''}`.trim();
  if (was === 'telefon') return g.phone ? `Die Telefonnummer von ${name} ist ${g.phone}.` : `Für ${name} ist keine Telefonnummer hinterlegt.`;
  if (was === 'email') return g.email ? `Die E-Mail von ${name} ist ${g.email}.` : `Für ${name} ist keine E-Mail hinterlegt.`;
  if (was === 'firma') return g.company ? `${name} gehört zu ${g.company}.` : `Für ${name} ist keine Firma hinterlegt.`;
  if (was === 'adresse') {
    const a = [[g.street, g.street_number].filter(Boolean).join(' '), [g.zip, g.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return a ? `Die Adresse von ${name} ist ${a}.` : `Für ${name} ist keine Adresse hinterlegt.`;
  }
  const h = [g.is_vip ? 'VIP' : '', g.needs_child_seat ? 'Kindersitz' : '', g.needs_accessibility ? 'barrierefrei' : '', g.needs_luggage ? 'viel Gepäck' : '',
    g.note_text || g.notes || ''].filter(Boolean);
  return h.length ? `${name}: ${h.join(', ')}.` : `Für ${name} sind keine besonderen Hinweise hinterlegt.`;
};

// ---- Standby: anzeigen, loeschen, verschieben ----

const STANDBY_RE = /\bstand[\s-]?by\w*\b/;
const LOESCH_RE = /\b(loesch\w*|losch\w*|entfern\w*|streich\w*|absag\w*|storn\w*|weg|rausnehm\w*|nimm\w*)\b/;
const AENDER_RE = /\b(verschieb\w*|verleg\w*|aender\w*|setz\w*|mach\w*|auf)\b/;

type StandbyZeile = { id: string; datum: string; von: string; bis: string; ort: string; fahrer: { id: string; name: string }[] };

const standbysLaden = async (admin: any, datum: string | null, ab: string) => {
  let q = admin.from('standby').select('id, datum, von, bis, ort_name');
  q = datum ? q.eq('datum', datum) : q.gte('datum', ab);
  const { data } = await q.order('datum', { ascending: true });
  const liste = Array.isArray(data) ? data : [];
  if (!liste.length) return [] as StandbyZeile[];
  const { data: sf } = await admin.from('standby_fahrer').select('standby_id, driver_id').in('standby_id', liste.map((s: any) => s.id));
  const ids = [...new Set((Array.isArray(sf) ? sf : []).map((x: any) => String(x.driver_id)))];
  const { data: p } = ids.length ? await admin.from('profiles').select('id, first_name, last_name').in('id', ids) : { data: [] };
  const namen = new Map((Array.isArray(p) ? p : []).map((x: any) => [String(x.id), [x.first_name, x.last_name].filter(Boolean).join(' ')]));
  return liste.map((s: any) => ({
    id: String(s.id), datum: String(s.datum), von: hm(s.von), bis: hm(s.bis), ort: String(s.ort_name || 'ohne Ort'),
    fahrer: (Array.isArray(sf) ? sf : []).filter((x: any) => String(x.standby_id) === String(s.id))
      .map((x: any) => ({ id: String(x.driver_id), name: namen.get(String(x.driver_id)) || 'Fahrer' })),
  })) as StandbyZeile[];
};
const zeile = (s: StandbyZeile, heute: string) => `${tagLesbar(s.datum, heute)} ${s.von}–${s.bis}, ${s.ort}${s.fahrer.length ? `, ${s.fahrer.map((f) => f.name).join(', ')}` : ''}`;
const ohne = (kontext: any) => {
  const k = { ...(kontext || {}) };
  delete k.offeneStandbyAenderung;
  return k;
};

export const standbyAendern = async (admin: any, frage: string, kontext: any) => {
  const roh = String(frage || '').trim();
  const text = normal(roh);
  const { datum: heute } = jetztBerlin();

  // Offene Rueckfrage
  const offen = kontext?.offeneStandbyAenderung;
  if (offen && Date.now() - Number(offen.zeit || 0) < FRIST_MS && roh.length <= 40 && !/\?/.test(roh)) {
    if (NEIN_RE.test(text)) return { answer: 'Okay, ich habe nichts geändert.', kontext: ohne(kontext) };
    if (JA_RE.test(text)) {
      if (offen.art === 'loeschen') {
        // Nur die genannten Fahrer raus. Bleibt keiner, ist der ganze Standby weg.
        if (offen.fahrerIds?.length && offen.rest > 0) {
          const { error } = await admin.from('standby_fahrer').delete().eq('standby_id', offen.id).in('driver_id', offen.fahrerIds);
          return { answer: error ? `Nicht geändert (${error.message}).` : 'Erledigt, der Fahrer ist aus dem Standby raus. Die anderen bleiben.', kontext: ohne(kontext) };
        }
        await admin.from('standby_fahrer').delete().eq('standby_id', offen.id);
        const { error } = await admin.from('standby').delete().eq('id', offen.id);
        return { answer: error ? `Nicht gelöscht (${error.message}).` : 'Standby gelöscht.', kontext: ohne(kontext) };
      }
      const { error } = await admin.from('standby').update({ von: offen.von, bis: offen.bis, geaendert: new Date().toISOString() }).eq('id', offen.id);
      return { answer: error ? `Nicht geändert (${error.message}).` : `Standby jetzt ${offen.von}–${offen.bis}.`, kontext: ohne(kontext) };
    }
  }

  if (!STANDBY_RE.test(text)) return null;
  const istFrage = /^\s*(welche\w*|wer|wann|gibt|hat|haben|ist|sind|zeig\w*|liste\w*|wo)\b/.test(text) || /\?\s*$/.test(roh);
  const loeschen = LOESCH_RE.test(text);
  const aendern = !loeschen && AENDER_RE.test(text) && /\b(verschieb\w*|verleg\w*|aender\w*)\b|\bauf\s+\d/.test(text);
  if (!istFrage && !loeschen && !aendern) return null;

  const hatTag = TAG_RE.test(text);
  const datum = hatTag ? datumAusText(text, heute) : null;
  const fahrer = await genannteFahrer(admin, text);
  let liste = await standbysLaden(admin, datum, heute);
  if (fahrer.length) liste = liste.filter((s) => s.fahrer.some((f) => fahrer.some((x) => x.id === f.id)));
  const wann = datum ? tagLesbar(datum, heute) : 'ab heute';
  const wer = fahrer.length ? ` für ${fahrer.map((f) => f.name).join(', ')}` : '';

  if (istFrage && !loeschen && !aendern) {
    if (!liste.length) return { answer: `${wann.replace(/^./, (c) => c.toUpperCase())} gibt es keinen Standby${wer}.`, kontext };
    return { answer: `Standby ${wann}${wer}:\n${liste.slice(0, 15).map((s) => `- ${zeile(s, heute)}`).join('\n')}`, kontext };
  }
  if (!liste.length) return { answer: `${wann.replace(/^./, (c) => c.toUpperCase())} gibt es keinen Standby${wer}, also nichts zu ${loeschen ? 'löschen' : 'ändern'}.`, kontext };
  if (liste.length > 1) {
    return { answer: `Mehrere passen:\n${liste.slice(0, 8).map((s) => `- ${zeile(s, heute)}`).join('\n')}\nNenne Tag und Fahrer, z. B. „Lösch den Standby von Tim morgen“.`, kontext };
  }
  const s = liste[0];
  if (loeschen) {
    const nurDie = fahrer.filter((f) => s.fahrer.some((x) => x.id === f.id));
    const rest = s.fahrer.length - nurDie.length;
    const teil = fahrer.length && rest > 0;
    return {
      answer: teil
        ? `${nurDie.map((f) => f.name).join(', ')} aus dem Standby ${zeile(s, heute)} nehmen? Die anderen bleiben. Mit „ja“ ändere ich es.`
        : `Standby ${zeile(s, heute)} ganz löschen? Mit „ja“ lösche ich ihn.`,
      kontext: { ...ohne(kontext), offeneStandbyAenderung: { art: 'loeschen', id: s.id, fahrerIds: nurDie.map((f) => f.id), rest, zeit: Date.now() } },
    };
  }
  const z = zeitenAusText(text);
  if (z.length < 2) return { answer: `Auf welche Zeit? Zum Beispiel „Verschieb den Standby von ${fahrer[0]?.name.split(' ')[0] || 'Tim'} ${wann} auf 12 bis 20 Uhr“.`, kontext };
  const von = z[z.length - 2].zeit;
  const bis = z[z.length - 1].zeit;
  return {
    answer: `Standby ${zeile(s, heute)} auf ${von}–${bis} ändern? Die Fahrer sehen die neue Zeit in der App. Mit „ja“ speichere ich es.`,
    kontext: { ...ohne(kontext), offeneStandbyAenderung: { art: 'zeit', id: s.id, von, bis, zeit: Date.now() } },
  };
};
