// Dienststart automatisch vor der ersten Fahrt (15.11., Pilotkunde). Vorlauf in Minuten, null = aus,
// Standard 60 min.
// Gespeichert in dispo_einstellungen 'dienststart_vorlauf_min', der DB-Trigger trg_jobs_dienststart
// schickt damit beim Zuteilen einer Fahrt den Dienststart (Migration 20261115140000).
import { useEffect, useState } from 'react';
import { supabase } from '../services/supabase';

export const DIENSTSTART_SCHLUESSEL = 'dienststart_vorlauf_min';
export const DIENSTSTART_OPTIONEN = [15, 30, 45, 60, 90, 120];

// verfuegbar = false, wenn die Tabelle fehlt (Demo, Migration noch nicht da): Abschnitt bleibt weg.
export function useDienststartVorlauf() {
  const [minuten, setMinuten] = useState(null);
  const [verfuegbar, setVerfuegbar] = useState(false);
  const [fehler, setFehler] = useState('');

  useEffect(() => {
    let aktiv = true;
    supabase.from('dispo_einstellungen').select('wert').eq('schluessel', DIENSTSTART_SCHLUESSEL).maybeSingle()
      .then(({ data, error }) => {
        if (!aktiv || error) return;
        const wert = Number(data?.wert);
        setMinuten(Number.isFinite(wert) && wert > 0 ? wert : null);
        setVerfuegbar(true);
      }, () => {});
    return () => { aktiv = false; };
  }, []);

  const setzen = async (neu) => {
    const alt = minuten;
    const wert = Number(neu) > 0 ? Number(neu) : null;
    setMinuten(wert);
    setFehler('');
    // Aus = wert null (Zeile bleibt). Fehlt die Zeile ganz, setzt die Migration den Standard 60 min.
    const { error } = await supabase.from('dispo_einstellungen')
      .upsert({ schluessel: DIENSTSTART_SCHLUESSEL, wert, aktualisiert: new Date().toISOString() });
    if (error) {
      setMinuten(alt);
      setFehler(error.message || 'Fehler');
    }
  };

  return { minuten, verfuegbar, fehler, setzen };
}
