/* eslint-disable react-refresh/only-export-components -- Exportfunktion und Fenster gehoeren zusammen. */
// Stunden als Excel exportieren (dispo-admin, Aktion stunden_export).
// - ExportKnopf: Knopf oben rechts (Fahrer-Ansicht und Alle Fahrer).
// - stundenExportieren: holt die Datei und gibt sie zum Teilen oder Herunterladen.
// - StundenExportFenster: Zeitraum und Fahrer waehlen (alle oder einzelne).

import { useEffect, useState } from 'react';
import { supabase } from '../../services/supabase';

const LIME = '#E3F654';
const schrift = "font-['Space_Grotesk']";
const isoTag = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const KEIN_FAHRER = ['dispo', 'dispatcher', 'admin', 'koordinator', 'pruefung'];

export async function stundenExportieren({ von, bis, fahrer = null }) {
  const { data, error } = await supabase.functions.invoke('dispo-admin', { body: { aktion: 'stunden_export', von, bis, fahrer } });
  if (error || !data?.datei) return { ok: false, meldung: 'Export fehlgeschlagen.' };
  const bytes = Uint8Array.from(atob(data.datei), (c) => c.charCodeAt(0));
  const datei = new File([bytes], data.dateiname, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  if (navigator.canShare?.({ files: [datei] })) {
    try { await navigator.share({ files: [datei], title: data.dateiname }); return { ok: true, dienste: data.dienste }; } catch { /* abgebrochen: herunterladen */ }
  }
  const url = URL.createObjectURL(datei);
  const a = document.createElement('a');
  a.href = url; a.download = data.dateiname; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return { ok: true, dienste: data.dienste };
}

// Alle Stunden eines Fahrers: ab 2020 bis heute.
export const alleStundenExportieren = (fahrerId) => stundenExportieren({ von: '2020-01-01', bis: isoTag(new Date()), fahrer: [fahrerId] });

// Kreis wie der Zurueck-Knopf (50 px, grauer Rand), darin das Export-Zeichen aus Figma (1429-9895).
export const ExportKnopf = ({ onClick, busy = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    aria-label="Stunden exportieren"
    className={`block w-[50px] h-[50px] relative ${busy ? 'animate-pulse' : ''}`}
  >
    <div className="absolute inset-0 rounded-full border border-[#747474]" />
    <img
      src="/icon/_Icon_Lime/Import_Trisar_Icons_01_Lime.svg"
      alt=""
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6"
    />
  </button>
);

const Eingabe = ({ label, value, onChange }) => (
  <label className="flex flex-col gap-[3px] flex-1">
    <span className={`text-[10px] font-medium ${schrift} text-white/50`}>{label}</span>
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-[38px] bg-black border border-white/30 px-2 text-[14px] font-medium ${schrift} text-white outline-none focus:border-[#E3F654]`}
    />
  </label>
);

// Fenster fuer Alle Fahrer: Zeitraum (Standard dieser Monat) und Fahrer (Standard alle).
export function StundenExportFenster({ schliessen }) {
  const heute = new Date();
  const [von, setVon] = useState(isoTag(new Date(heute.getFullYear(), heute.getMonth(), 1)));
  const [bis, setBis] = useState(isoTag(new Date(heute.getFullYear(), heute.getMonth() + 1, 0)));
  const [fahrer, setFahrer] = useState([]);
  const [auswahl, setAuswahl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState('');

  useEffect(() => {
    let aktiv = true;
    supabase.from('profiles').select('id, first_name, last_name, role, is_dispo').order('first_name').then(({ data }) => {
      if (!aktiv) return;
      setFahrer((data || []).filter((x) => !x.is_dispo && !KEIN_FAHRER.includes(String(x.role || '').toLowerCase()))
        .map((x) => ({ id: x.id, name: `${x.first_name || ''} ${x.last_name || ''}`.trim() || 'Fahrer' })));
    });
    return () => { aktiv = false; };
  }, []);

  // auswahl null = alle Fahrer.
  const alle = auswahl === null;
  const umschalten = (id) => setAuswahl((a) => {
    const jetzt = a ?? [];
    const neu = jetzt.includes(id) ? jetzt.filter((x) => x !== id) : [...jetzt, id];
    return neu.length ? neu : null;
  });
  const exportieren = async () => {
    setBusy(true); setMeldung('');
    const r = await stundenExportieren({ von, bis, fahrer: alle ? null : auswahl });
    setBusy(false);
    setMeldung(r.ok ? `${r.dienste ?? 0} Dienste exportiert.` : r.meldung);
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/70 flex items-end justify-center" onClick={schliessen}>
      <div className="w-[min(402px,100vw)] max-h-[calc(var(--app-h,100dvh)*0.85)] overflow-y-auto bg-[#0f0f0f] border-t-2 border-[#E3F654] px-5 pt-5 pb-[60px]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className={`text-[26px] font-bold ${schrift}`} style={{ color: LIME }}>Stunden exportieren</span>
          <button type="button" onClick={schliessen} aria-label="Schließen" className={`text-[28px] leading-none text-white/60 ${schrift}`}>×</button>
        </div>
        <div className="mt-4 flex gap-2">
          <Eingabe label="Von" value={von} onChange={setVon} />
          <Eingabe label="Bis" value={bis} onChange={setBis} />
        </div>
        <div className="mt-4 flex flex-wrap gap-[6px]">
          <button
            type="button"
            onClick={() => setAuswahl(null)}
            className={`h-[30px] px-3 text-[12px] font-bold ${schrift}`}
            style={alle ? { background: LIME, color: '#000' } : { border: `1px solid ${LIME}`, color: LIME }}
          >
            Alle Fahrer
          </button>
          {fahrer.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => umschalten(f.id)}
              className={`h-[30px] px-3 text-[12px] font-medium ${schrift}`}
              style={!alle && auswahl.includes(f.id) ? { background: LIME, color: '#000' } : { border: '1px solid rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.75)' }}
            >
              {f.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !von || !bis}
          onClick={exportieren}
          className={`mt-5 w-full h-[56px] px-6 flex items-center justify-between disabled:opacity-50 ${schrift}`}
          style={{ background: LIME }}
        >
          <span className="text-black text-[16px] font-bold tracking-[-0.5px]">{busy ? 'Excel wird erstellt …' : 'Excel herunterladen'}</span>
          <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
        </button>
        {meldung ? <div className={`mt-3 text-[13px] ${schrift} text-white/60`}>{meldung}</div> : null}
      </div>
    </div>
  );
}
