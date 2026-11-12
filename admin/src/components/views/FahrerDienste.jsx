// "Dienste" in Fahrer bearbeiten: die Dienste dieses einen Fahrers ab heute fuer
// 14 Tage ansehen, aendern, loeschen oder einen hinzufuegen.
// Aendern und Hinzufuegen nutzen das Blatt "Dienste planen" mit genau diesem Fahrer
// und schreiben wie dort (AlleFahrer applyBulkPlanning): neue Anfrage 'pending',
// der DB-Trigger (20261111080000_ein_dienst_pro_tag) ersetzt den alten Dienst des Tages.
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import DienstePlanenBlatt from './DienstePlanenBlatt';
import { DEMO_MODE, hasSupabaseAdminConfig, supabase, supabaseAdmin } from '../../services/supabase';

const TAGE_VORAUS = 14;
// Gleiche Vorlagen wie in "Dienste planen" (AlleFahrer PLAN_TEMPLATES).
const VORLAGEN = [
  { key: 'frueh', labelKey: 'fahrer.shiftEarly', start: '06:00', end: '14:00' },
  { key: 'tag', labelKey: 'fahrer.shiftDay', start: '08:00', end: '16:00' },
  { key: 'spaet', labelKey: 'fahrer.shiftLate', start: '14:00', end: '22:00' },
  { key: 'nacht', labelKey: 'fahrer.shiftNight', start: '22:00', end: '06:00' },
];

// Hoehe des Abschnitts, damit Fahrer bearbeiten alles darunter verschieben kann.
export const DIENSTE_KOPF = 36;
export const DIENSTE_ZEILE = 64;
export const dienstAbschnittHoehe = (anzahl) =>
  DEMO_MODE ? 0 : DIENSTE_KOPF + Math.max(anzahl, 1) * DIENSTE_ZEILE + 56 + 12;

const uhr = (wert) => {
  const m = String(wert || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
};
const isoTag = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const heuteIso = () => isoTag(new Date());
const plusTage = (iso, n) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoTag(d);
};
// "Heute 11.11." / "Mi 12.11."
const tagText = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  const datum = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.`;
  if (iso === heuteIso()) return `Heute ${datum}`;
  return `${d.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', '')} ${datum}`;
};

export default function FahrerDienste({ t, fahrerId, fahrerName, top, onAnzahl }) {
  const [dienste, setDienste] = useState([]);
  const [laedt, setLaedt] = useState(false);
  const [meldung, setMeldung] = useState('');
  // Blatt: null = zu, sonst { alt: Zeile oder null }
  const [blatt, setBlatt] = useState(null);
  const [daten, setDaten] = useState([]);
  const [start, setStart] = useState('');
  const [ende, setEnde] = useState('');
  const [pausen, setPausen] = useState([]);
  const [altePausen, setAltePausen] = useState(false);
  const [fehler, setFehler] = useState('');
  const [speichert, setSpeichert] = useState(false);

  const client = hasSupabaseAdminConfig ? supabaseAdmin : supabase;

  const laden = useCallback(async () => {
    if (!fahrerId || DEMO_MODE) return;
    setLaedt(true);
    const heute = heuteIso();
    const { data, error } = await client
      .from('driver_service_requests')
      .select('id,service_date,service_start_time,service_end_time,status,created_at')
      .eq('driver_id', fahrerId)
      .gte('service_date', heute)
      .lte('service_date', plusTage(heute, TAGE_VORAUS))
      .order('service_date', { ascending: true })
      .order('created_at', { ascending: false });
    setLaedt(false);
    if (error) {
      setMeldung(`Dienste nicht geladen: ${error.message}`);
      return;
    }
    // Ein Dienst pro Tag (der neueste), abgelehnte nicht.
    const proTag = new Map();
    (data || []).forEach((z) => {
      if (String(z.status || '').toLowerCase() === 'refused') return;
      if (!proTag.has(z.service_date)) proTag.set(z.service_date, z);
    });
    setDienste([...proTag.values()]);
  }, [fahrerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { laden(); }, [laden]);
  useEffect(() => { onAnzahl?.(dienste.length); }, [dienste.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (DEMO_MODE) return null;

  const oeffnen = async (zeile) => {
    setFehler('');
    setMeldung('');
    setDaten(zeile ? [zeile.service_date] : []);
    setStart(zeile ? uhr(zeile.service_start_time) : '');
    setEnde(zeile ? uhr(zeile.service_end_time) : '');
    setPausen([]);
    setAltePausen(false);
    setBlatt({ alt: zeile || null });
    if (zeile) {
      const { data } = await client.from('dienst_pausen').select('pausen').eq('dienst_id', zeile.id).maybeSingle();
      const liste = (data?.pausen || [])
        .map((p) => ({ von: uhr(p.von), bis: uhr(p.bis) }))
        .filter((p) => p.von && p.bis);
      setPausen(liste);
      setAltePausen(liste.length > 0);
    }
  };

  const senden = async () => {
    const tage = [...new Set(daten.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
    if (!tage.length) { setFehler('Bitte einen Tag im Kalender wählen.'); return; }
    const s = uhr(start);
    const e = uhr(ende);
    if (!s && !e) { setFehler('Bitte Start oder Ende setzen.'); return; }
    setSpeichert(true);
    setFehler('');
    try {
      const { data: neu, error } = await client
        .from('driver_service_requests')
        .insert(tage.map((tag) => ({
          driver_id: fahrerId,
          service_date: tag,
          service_start_time: s || null,
          service_end_time: e || null,
          status: 'pending',
          requested_by: 'admin-app',
        })))
        .select('id');
      if (error) { setFehler(error.message || 'Dienst nicht gespeichert.'); return; }
      const feste = pausen
        .map((p) => ({ art: 'fest', von: uhr(p.von), bis: uhr(p.bis) }))
        .filter((p) => p.von && p.bis && p.von !== p.bis);
      const ids = (neu || []).map((d) => d.id);
      if (feste.length && ids.length) {
        const jetzt = new Date().toISOString();
        const { error: pf } = await client
          .from('dienst_pausen')
          .upsert(ids.map((id) => ({ dienst_id: id, pausen: feste, aktualisiert: jetzt })));
        if (pf) { setFehler(`Dienst gesendet, Pausen nicht gespeichert: ${pf.message}`); return; }
      } else if (!feste.length && altePausen && ids.length) {
        // Alle Pausen entfernt: der Trigger hat die alten zur neuen Zeile gelegt, also weg damit.
        await client.from('dienst_pausen').delete().in('dienst_id', ids);
      }
      // Profil wie bei "Dienste planen": Start/Ende mit dem (ersten) Tag.
      const tag = tage[0];
      const mitDatum = {
        ...(s ? { service_start_time: s, service_start_date: tag } : {}),
        ...(e ? { service_end_time: e, service_end_date: tag } : {}),
      };
      const p1 = await client.from('profiles').update(mitDatum).eq('id', fahrerId);
      if (p1.error) {
        await client.from('profiles').update({
          ...(s ? { service_start_time: s } : {}),
          ...(e ? { service_end_time: e } : {}),
        }).eq('id', fahrerId);
      }
      setBlatt(null);
      setMeldung('Dienst gesendet, der Fahrer muss ihn bestätigen.');
      await laden();
    } finally {
      setSpeichert(false);
    }
  };

  const loeschen = async (zeile) => {
    if (!window.confirm(`Dienst ${tagText(zeile.service_date)} von ${fahrerName || 'diesem Fahrer'} löschen?`)) return;
    setMeldung('');
    const { error } = await client.from('driver_service_requests').delete().eq('id', zeile.id);
    if (error) { setMeldung(`Löschen fehlgeschlagen: ${error.message}`); return; }
    if (zeile.service_date === heuteIso()) {
      // Heute geloescht: Dienstzeit im Profil fuer heute leeren.
      const { data: profil } = await client
        .from('profiles')
        .select('service_start_date,service_end_date')
        .eq('id', fahrerId)
        .maybeSingle();
      const heute = heuteIso();
      const leer = {};
      if (!profil || !profil.service_start_date || profil.service_start_date === heute) {
        Object.assign(leer, { service_start_time: null, service_start_date: null });
      }
      if (!profil || !profil.service_end_date || profil.service_end_date === heute) {
        Object.assign(leer, { service_end_time: null, service_end_date: null });
      }
      if (Object.keys(leer).length) await client.from('profiles').update(leer).eq('id', fahrerId);
    }
    setMeldung('Dienst gelöscht.');
    await laden();
  };

  return (
    <>
      <div className="absolute left-5 w-[362px]" style={{ top: `${top}px` }}>
        <div className="h-[28px] flex items-center justify-between">
          <span className="text-[#e2f754] text-[20px] leading-6 font-bold tracking-[-0.5px]">Dienste</span>
          <span className="text-[#c8d85d] text-[12px] truncate ml-3">{meldung || (laedt ? 'Lädt …' : 'nächste 14 Tage')}</span>
        </div>
        <div className="mt-[8px]">
          {dienste.length === 0 ? (
            <div className="h-14 mb-2 border-2 border-[#7f8a2b] flex items-center px-4 text-[#8a9728] text-[16px]">
              {laedt ? 'Lädt …' : 'Keine Dienste geplant'}
            </div>
          ) : dienste.map((z) => {
            const offen = String(z.status || '').toLowerCase() !== 'accepted';
            return (
              <div key={z.id} className="relative h-14 mb-2 border-2 border-[#e3f654]">
                <button type="button" onClick={() => oeffnen(z)} className="absolute left-0 top-0 bottom-0 right-[92px] text-left px-4">
                  <span className="block text-[#e3f654] text-[15px] leading-5 font-bold whitespace-nowrap">
                    {tagText(z.service_date)}
                    <span className="ml-2 font-medium" style={{ color: offen ? '#FF9500' : '#59BE80' }}>{offen ? 'offen' : 'bestätigt'}</span>
                  </span>
                  <span className="block text-[#8a9728] text-[15px] leading-5 font-medium tabular-nums">
                    {`${uhr(z.service_start_time) || '--:--'} – ${uhr(z.service_end_time) || '--:--'}`}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => loeschen(z)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-9 px-3 border-2 border-[#ff3b30] text-[#ff3b30] text-[13px] font-medium"
                  aria-label={`Dienst ${tagText(z.service_date)} löschen`}
                >
                  Löschen
                </button>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => oeffnen(null)}
          className="w-full h-12 mt-[2px] border-2 border-[#e3f654] text-[#e3f654] text-[16px] font-medium"
        >
          Dienst hinzufügen
        </button>
      </div>
      {/* Blatt ausserhalb des skalierten Inhalts, sonst richtet sich fixed am transform aus. */}
      {blatt ? createPortal(
        <div className="fixed inset-0 z-[120]">
          <button type="button" onClick={() => setBlatt(null)} className="absolute inset-0 bg-black/55" aria-label="Schließen" />
          <DienstePlanenBlatt
            t={t}
            anzahl={1}
            tage={[]}
            datum={daten[0] || ''}
            daten={daten}
            onDaten={(liste) => { setDaten(liste); setFehler(''); }}
            onDatum={() => {}}
            start={start}
            onStart={(w) => { setStart(w); setFehler(''); }}
            ende={ende}
            onEnde={(w) => { setEnde(w); setFehler(''); }}
            pausen={pausen}
            onPausen={(l) => { setPausen(l); setFehler(''); }}
            vorlagen={VORLAGEN}
            fehler={fehler}
            speichert={speichert}
            onAnwenden={senden}
            onSchliessen={() => setBlatt(null)}
          />
        </div>,
        document.body,
      ) : null}
    </>
  );
}
