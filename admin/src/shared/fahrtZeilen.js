// Fahrt-Formular: Zeilen, die beim Eintragen nachwachsen (Fahrer, Zwischenstopps).
import { useRef, useState } from 'react';
import { orteZurEingabe, useOrte } from './orte';
import { DEMO_MODE, supabase } from '../services/supabase';

export const MAX_ZWISCHENSTOPPS = 8;

// Eintraege bleiben wie getippt, leere fallen weg, am Ende steht genau eine freie Zeile.
export const zeilenMitFreier = (werte = [], { mindestens = 1, hoechstens = Infinity } = {}) => {
  const gefuellt = werte.map((w) => String(w ?? '')).filter((w) => w.trim());
  const zeilen = gefuellt.slice(0, hoechstens);
  if (zeilen.length < hoechstens) zeilen.push('');
  while (zeilen.length < mindestens) zeilen.push('');
  return zeilen;
};

// Fahrer zum Speichern: alle eingetragenen, bei Kolonne mindestens so viele Plaetze wie Fahrzeuge.
export const fahrerFuersSpeichern = (namen = [], plaetze = 1) => {
  const liste = namen.map((n) => String(n ?? '').trim()).filter(Boolean);
  while (liste.length < Math.max(1, plaetze)) liste.push('');
  return liste;
};

export const gleicheZeilen = (a, b) => a.length === b.length && a.every((w, i) => w === b[i]);

const FAHRT_STOPP_MAX = MAX_ZWISCHENSTOPPS;

// Zwischenstopps: erscheinen, sobald ein Start eingetragen ist. Stopp 2 nach Stopp 1 usw.
export function useZwischenstopps({ start, anfang = [], onFetchPlaceSuggestions, t }) {
  const { orte } = useOrte();
  const [stopps, setStopps] = useState(() => zeilenMitFreier(anfang, { hoechstens: FAHRT_STOPP_MAX }));
  const [vorschlaege, setVorschlaege] = useState({});
  const [aktiv, setAktiv] = useState(null);
  const timer = useRef(null);
  const folge = useRef(0);

  const setzen = (index, wert) => setStopps((prev) => {
    const next = [...prev];
    next[index] = wert;
    return zeilenMitFreier(next, { hoechstens: FAHRT_STOPP_MAX });
  });

  const eingabe = (index, wert) => {
    setzen(index, wert);
    if (timer.current) clearTimeout(timer.current);
    const text = String(wert || '').trim();
    if (!text) {
      setVorschlaege((prev) => ({ ...prev, [index]: [] }));
      return;
    }
    setAktiv(index);
    folge.current += 1;
    const lauf = folge.current;
    timer.current = setTimeout(async () => {
      const liste = await onFetchPlaceSuggestions(text);
      if (folge.current === lauf) setVorschlaege((prev) => ({ ...prev, [index]: liste }));
    }, 250);
  };

  const waehlen = (index, adresse) => {
    setzen(index, adresse);
    setVorschlaege((prev) => ({ ...prev, [index]: [] }));
    setAktiv(null);
  };

  const sichtbar = String(start || '').trim() ? stopps : [];
  const rows = sichtbar.map((wert, index) => ({
    key: `stopp-${index}`,
    label: index === 0 ? t('fahrt.zwischenstopp') : t('fahrt.zwischenstoppNumbered', { n: index + 1 }),
    mode: 'select',
    options: vorschlaege[index] || [],
    marker: `feld-stopp-${index + 1}`,
    value: wert,
    onChange: (v) => eingabe(index, v),
    onReset: () => waehlen(index, ''),
    onFocus: () => setAktiv(index),
    onBlur: () => setTimeout(() => setAktiv((prev) => (prev === index ? null : prev)), 120),
  }));

  const panel = aktiv != null && aktiv < sichtbar.length
    ? {
      index: aktiv,
      optionen: vorschlaege[aktiv] || [],
      orte: orteZurEingabe(orte, sichtbar[aktiv]),
      waehlen: (adresse) => waehlen(aktiv, adresse),
    }
    : null;

  return {
    gefuellt: stopps.map((w) => w.trim()).filter(Boolean),
    rows,
    panel,
    zuruecksetzen: (liste = []) => setStopps(zeilenMitFreier(liste, { hoechstens: FAHRT_STOPP_MAX })),
  };
}

// Vor dem Speichern: Warntext, wenn eine Adresse fehlt oder nicht zur Fahrt passt. Sonst leer.
// Faellt die Pruefung aus, wird normal gespeichert.
export async function adressWarnung(adressen, t) {
  if (DEMO_MODE) return '';
  try {
    const anfrage = supabase.functions.invoke('places-proxy', {
      body: { aktion: 'adressen_pruefen', adressen: adressen.filter((a) => String(a || '').trim()) },
    });
    const zeitAus = new Promise((resolve) => { setTimeout(() => resolve(null), 5000); });
    const antwort = await Promise.race([anfrage, zeitAus]);
    const warnungen = Array.isArray(antwort?.data?.warnungen) ? antwort.data.warnungen : [];
    if (warnungen.length === 0) return '';
    const zeilen = warnungen.map((w) => {
      if (w.grund === 'nicht_gefunden') return t('fahrt.adresseNichtGefunden', { adresse: w.adresse });
      if (w.grund === 'weit_weg') return t('fahrt.adresseWeitWeg', { adresse: w.adresse, km: w.km });
      return t('fahrt.adresseOhneStadt', { adresse: w.adresse });
    });
    return `${zeilen.join('\n')}\n\n${t('fahrt.trotzdemSpeichern')}`;
  } catch {
    return '';
  }
}
