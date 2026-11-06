// Excel-/CSV-Import fuer die Web-Dispo.
//
// Live laeuft alles ueber die Funktion dispo-admin (Aktionen import_*): Datei lesen, Blatt waehlen,
// Spalten erkennen (Vorlage, Regeln, Llama), Dubletten, Adressen pruefen, Import als Stapel mit
// Rueckgaengig. In der Demo gibt es keinen Server: dort dieselbe Erkennung (importKern.js) im
// Browser, ohne Llama, Adresspruefung und Rueckgaengig.

import * as XLSX from 'xlsx';
import { supabase } from './supabase';
import { DEMO_MODE } from '../datenquelle';
import * as K from './importKern';

const aufruf = async (body) => {
  const antwort = await supabase.functions.invoke('dispo-admin', { body });
  if (!antwort.error) return antwort.data;
  const inhalt = await antwort.error.context?.json?.().catch(() => null);
  const fehler = new Error(String(inhalt?.error || antwort.error.message || 'unknown'));
  fehler.code = inhalt?.error || '';
  throw fehler;
};

export const dateiAlsBase64 = (datei) => new Promise((fertig, abbruch) => {
  const leser = new FileReader();
  leser.onload = () => fertig(String(leser.result).replace(/^data:[^,]*,/, ''));
  leser.onerror = () => abbruch(leser.error);
  leser.readAsDataURL(datei);
});

const textAlsBase64 = (inhalt) => btoa(unescape(encodeURIComponent(inhalt)));

// --- Demo: dieselbe Auswertung wie auf dem Server, ohne Datenbank -----------------

const trennzeichen = (inhalt) => {
  const zeilen = String(inhalt || '').split(/\r?\n/).filter((z) => z.trim()).slice(0, 8);
  const zaehle = (sep) => zeilen.reduce((summe, z) => summe + (z.split(sep).length - 1), 0);
  const [bestes] = [';', ',', '\t', '|'].map((sep) => [sep, zaehle(sep)]).sort((a, b) => b[1] - a[1]);
  return bestes[1] > 0 ? bestes[0] : ';';
};

const blaetterLesen = (b64, dateiname) => {
  const roh = atob(b64);
  const bytes = Uint8Array.from(roh, (c) => c.charCodeAt(0));
  const istTabelle = (bytes[0] === 0x50 && bytes[1] === 0x4b) || (bytes[0] === 0xd0 && bytes[1] === 0xcf) || /\.(xlsx|xlsm|xls|ods)$/i.test(dateiname);
  const lesen = (mappe) => mappe.SheetNames.map((n) => ({
    name: n,
    zeilen: XLSX.utils.sheet_to_json(mappe.Sheets[n], { header: 1, blankrows: false, defval: '', raw: true }),
  })).filter((b) => b.zeilen.length);
  if (istTabelle) return lesen(XLSX.read(bytes, { type: 'array', cellDates: true, UTC: true }));
  let inhalt;
  try { inhalt = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { inhalt = new TextDecoder('windows-1252').decode(bytes); }
  inhalt = inhalt.replace(/^﻿/, '');
  return lesen(XLSX.read(inhalt, { type: 'string', raw: true, FS: trennzeichen(inhalt) }));
};

const demoAnalysieren = ({ modus, datei, dateiname, blatt, zuordnung }) => {
  const blaetter = blaetterLesen(datei, dateiname);
  if (!blaetter.length) throw Object.assign(new Error('datei_leer'), { code: 'datei_leer' });
  const nr = Number.isInteger(blatt) && blaetter[blatt] ? blatt : K.blattWaehlen(blaetter, modus);
  const erkennung = K.spaltenErkennen(blaetter[nr].zeilen, modus);
  if (!erkennung.spalten.length || !erkennung.datenzeilen.length) throw Object.assign(new Error('datei_leer'), { code: 'datei_leer' });
  const zu = zuordnung || K.zuordnungAus(erkennung.spalten);
  const kontext = K.kontextAus(blaetter, nr, erkennung.kopfzeile);
  const { datensaetze } = K.bauen(modus, erkennung.datenzeilen, zu, kontext);
  ['datumAusDatei', 'zielAusDatei'].forEach((h) => {
    if (datensaetze.length && datensaetze.every((d) => d.hinweise.includes(h))) datensaetze.forEach((d) => { d.hinweise = d.hinweise.filter((x) => x !== h); });
  });
  return {
    modus,
    dateiname,
    blaetter: blaetter.map((b, i) => ({ index: i, name: b.name, zeilen: b.zeilen.length, fahrten: Math.floor(K.blattBewerten(blaetter, i, modus) / 10) })),
    blatt: nr,
    signatur: erkennung.signatur,
    vorlage: null,
    felder: K.feldNamen(modus),
    spalten: erkennung.spalten.map((s) => ({
      index: s.index, titel: s.titel, ohneTitel: s.ohneTitel, beispiele: s.beispiele.slice(0, 4),
      vorschlag: zu[s.index] || null,
      sicherheit: zu[s.index] === s.vorschlag ? s.sicherheit : (zu[s.index] ? 0.6 : 0),
      grund: s.grund,
    })),
    zuordnung: zu,
    fehlendeZuordnung: K.fehlendeZuordnung(zu, modus).filter((f) => datensaetze.some((d) => d.fehlt.includes(f))),
    datensaetze,
    kontext: {
      datum: !Object.values(zu).some((f) => f === 'datum' || f === 'datumUhrzeit') && datensaetze.some((d) => d.daten?.ride_date === kontext.datum) ? kontext.datum : null,
      ziel: modus === 'rides' && !Object.values(zu).includes('zielort') ? kontext.ziel || null : null,
    },
    llama: { genutzt: false, erreichbar: null },
  };
};

// --- Oeffentlich -------------------------------------------------------------

export const importAnalysieren = async ({ modus, datei, dateiname, blatt = null, zuordnung = null }) => {
  if (DEMO_MODE) return demoAnalysieren({ modus, datei, dateiname, blatt, zuordnung });
  return aufruf({ aktion: 'import_analysieren', modus, datei, dateiname, blatt, zuordnung });
};

export const beispielAlsDatei = (inhalt) => textAlsBase64(inhalt);

export const adressenPruefen = async (adressen) => {
  if (DEMO_MODE || !adressen.length) return {};
  const { adressen: ergebnis } = await aufruf({ aktion: 'import_adressen', adressen, stadt: 'München' });
  return ergebnis || {};
};

export const importAusfuehren = async ({ modus, datensaetze, dateiname, signatur, vorlage }) => {
  if (!DEMO_MODE) {
    return aufruf({ aktion: 'import_ausfuehren', modus, datensaetze, dateiname, signatur, vorlage });
  }
  // Demo: direkt in den Demo-Datenbestand.
  if (modus === 'rides') {
    const zeilen = datensaetze.map((d) => K.fahrtZeile(d));
    const { data, error } = await supabase.from('jobs').insert(zeilen).select('id');
    if (error) throw error;
    const notizen = datensaetze.map((d, i) => ({ job_id: data?.[i]?.id, note_text: K.text(d.note) })).filter((n) => n.job_id && n.note_text);
    if (notizen.length) await supabase.from('job_notes').insert(notizen);
  } else {
    const { error } = await supabase.from('guests').insert(datensaetze);
    if (error) throw error;
  }
  return { import_id: null, anzahl: datensaetze.length };
};

export const importListe = async (modus) => {
  if (DEMO_MODE) return [];
  const { importe } = await aufruf({ aktion: 'import_liste', modus });
  return importe || [];
};

export const importRueckgaengig = async (importId) => aufruf({ aktion: 'import_rueckgaengig', import_id: importId });

export { K as importKern };
