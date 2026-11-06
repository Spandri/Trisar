// Stundenerfassung fuer den Fahrer: Verlauf der vergangenen Dienste mit Fahrten und Stunden,
// "Stunden erfassen" mit Vorschlag des Systems (bestaetigen oder mit Begruendung anpassen),
// und der Hinweis auf der Startseite, solange Stunden offen sind.
// Daten: Datenbank-Funktion stunden_verlauf() und Tabelle stundenzettel (gleich in iOS und Android).

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../../shared/supabase/client';

const LIME = '#E3F654';
const ROT = '#ff6f63';
const ORANGE = '#ffcd8a';
const GRUEN = '#8DFFAF';
const schrift = "font-['Space_Grotesk']";

const TEXTE = {
  verlauf: 'Verlauf',
  leer: 'Noch keine abgeschlossenen Dienste.',
  dienstbeginn: 'Dienstbeginn {zeit}',
  dienstende: 'Dienstende {zeit}',
  erfassen: 'Stunden erfassen',
  laeuft: 'Dienst läuft noch',
  eingereicht: 'Eingereicht',
  bestaetigt: 'Bestätigt',
  zurueckgegeben: 'Zurückgegeben',
  neu: 'Neu erfassen',
  arbeitszeit: 'Arbeitszeit',
  beginn: 'Beginn',
  ende: 'Ende',
  pause: 'Pause',
  pauseMin: 'Pause (Min.)',
  fahrten: 'Fahrten',
  stimmt: 'Stimmt so, bestätigen',
  anpassen: 'Anpassen',
  einreichen: 'Einreichen',
  begruendung: 'Warum weicht es ab?',
  begruendungFehlt: 'Bitte kurz begründen, warum die Zeiten abweichen.',
  geschaetzt: 'geplant',
  hinweisStart: 'Stunden erfassen: {tage}',
  vorschlag: 'Vorschlag',
  minuten: '{n} Min.',
  fehler: 'Speichern fehlgeschlagen: {meldung}',
};
const tx = (k, w = {}) => Object.entries(w).reduce((s, [a, b]) => s.replace(`{${a}}`, b), TEXTE[k] || k);

const uhr = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '--:--');
const hmm = (min) => `${Math.floor((min || 0) / 60)}:${String(Math.round((min || 0) % 60)).padStart(2, '0')}`;
const tagTitel = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString('de-DE', { weekday: 'long' })} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`.replace(/\.*$/, '.');
};
const tagKurz = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`.replace(/\.*$/, '.');
};

// Zeit HH:MM am Tag des Dienstes (Europe/Berlin) als ISO. Vor dem Beginn liegende Enden rutschen auf den Folgetag.
const zuZeitpunkt = (datum, hhmm, nachIso = null) => {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  // Versatz Europe/Berlin fuer diesen Tag ermitteln.
  const mittag = new Date(`${datum}T12:00:00Z`);
  const berlin = new Date(mittag.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const versatz = berlin.getTime() - new Date(mittag.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  let t = Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)), h, m) - versatz;
  if (nachIso && t <= new Date(nachIso).getTime()) t += 86400000;
  return new Date(t).toISOString();
};

const useStundenVerlauf = (tage = 60) => {
  const [eintraege, setEintraege] = useState(null);
  const [stand, setStand] = useState(0);
  useEffect(() => {
    let aktiv = true;
    supabase.rpc('stunden_verlauf', { p_tage: tage }).then(({ data, error }) => {
      if (aktiv) setEintraege(error ? [] : data || []);
    });
    return () => { aktiv = false; };
  }, [tage, stand]);
  const laden = useCallback(() => setStand((n) => n + 1), []);
  return { eintraege, laden };
};

const ZeitZeile = ({ label, wert, farbe = '#fff' }) => (
  <div className="flex items-center justify-between h-[44px] border-b border-white/10">
    <span className={`text-[14px] font-medium ${schrift} text-white/60`}>{label}</span>
    <span className={`text-[20px] font-bold ${schrift}`} style={{ color: farbe }}>{wert}</span>
  </div>
);

const Eingabe = ({ label, value, onChange, typ = 'time' }) => (
  <label className="flex flex-col gap-[4px] flex-1">
    <span className={`text-[11px] font-medium ${schrift} text-white/50`}>{label}</span>
    <input
      type={typ}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-[44px] bg-black border border-white/30 px-3 text-[18px] font-bold ${schrift} text-white outline-none focus:border-[#E3F654]`}
    />
  </label>
);

// Vollbild: Vorschlag ansehen, bestaetigen oder anpassen.
export function StundenErfassen({ eintrag, fahrerId, schliessen, fertig }) {
  const v = eintrag.vorschlag || {};
  const datum = eintrag.dienst.datum;
  const [anpassen, setAnpassen] = useState(false);
  const [beginn, setBeginn] = useState(uhr(eintrag.zettel?.beginn || v.beginn));
  const [ende, setEnde] = useState(uhr(eintrag.zettel?.ende || v.ende));
  const [pause, setPause] = useState(String(eintrag.zettel?.pause_min ?? v.pause_min ?? 0));
  const [begruendung, setBegruendung] = useState(eintrag.zettel?.begruendung || '');
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);

  const beginnIso = anpassen ? zuZeitpunkt(datum, beginn) : v.beginn;
  const endeIso = anpassen ? zuZeitpunkt(datum, ende, beginnIso) : v.ende;
  const pauseMin = anpassen ? Math.max(0, Number(pause) || 0) : (v.pause_min || 0);
  const arbeitsMin = beginnIso && endeIso ? Math.max(0, Math.round((new Date(endeIso) - new Date(beginnIso)) / 60000) - pauseMin) : 0;
  const geaendert = anpassen && (uhr(beginnIso) !== uhr(v.beginn) || uhr(endeIso) !== uhr(v.ende) || pauseMin !== (v.pause_min || 0));

  const speichern = async () => {
    if (geaendert && !begruendung.trim()) { setFehler(tx('begruendungFehlt')); return; }
    if (!beginnIso || !endeIso) return;
    setBusy(true); setFehler('');
    const fahrer = fahrerId || (await supabase.auth.getUser()).data?.user?.id;
    const zeile = {
      driver_id: fahrer,
      dienst_id: eintrag.dienst.id,
      datum,
      beginn: beginnIso,
      ende: endeIso,
      pausen: geaendert ? [] : (v.pausen || []),
      pause_min: pauseMin,
      arbeits_min: arbeitsMin,
      vorschlag: v,
      angepasst: geaendert,
      begruendung: geaendert ? begruendung.trim() : null,
      status: 'eingereicht',
      eingereicht_am: new Date().toISOString(),
      aktualisiert: new Date().toISOString(),
    };
    const { error } = eintrag.zettel
      ? await supabase.from('stundenzettel').update(zeile).eq('id', eintrag.zettel.id)
      : await supabase.from('stundenzettel').insert(zeile);
    setBusy(false);
    if (error) { setFehler(tx('fehler', { meldung: error.message })); return; }
    fertig();
  };

  return (
    <div className="fixed inset-0 z-40 bg-black overflow-y-auto" style={{ backgroundImage: 'radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%)' }}>
      <div className="w-[min(402px,100vw)] mx-auto px-[20px] pt-[60px] pb-[120px]">
        <button type="button" onClick={schliessen} aria-label="Zurück" className="w-[50px] h-[50px] rounded-full border border-[#747474] flex items-center justify-center">
          <img src="/icon/_Icon_Grau/Arrow_Trisar_Icons_01_grau.svg" alt="" className="w-[26px] h-[16px] rotate-180" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        </button>
        <h1 className={`mt-[30px] text-[42px] leading-[42px] font-bold ${schrift}`} style={{ color: LIME }}>{tx('erfassen')}</h1>
        <div className={`mt-[10px] text-[18px] font-bold ${schrift} text-white/80`}>{tagTitel(datum)}</div>

        {/* Arbeitszeit gross */}
        <div className="mt-[20px] h-[96px] px-4 flex flex-col justify-center" style={{ background: LIME }}>
          <span className={`text-[44px] leading-[46px] font-bold ${schrift} text-black`}>{hmm(arbeitsMin)} h</span>
          <span className={`text-[12px] font-medium ${schrift} text-black/70`}>{tx('arbeitszeit')}{anpassen ? '' : ` · ${tx('vorschlag')}`}</span>
        </div>

        {anpassen ? (
          <div className="mt-[16px] flex flex-col gap-[12px]">
            <div className="flex gap-[10px]">
              <Eingabe label={tx('beginn')} value={beginn} onChange={setBeginn} />
              <Eingabe label={tx('ende')} value={ende} onChange={setEnde} />
            </div>
            <Eingabe label={tx('pauseMin')} value={pause} onChange={setPause} typ="number" />
            <label className="flex flex-col gap-[4px]">
              <span className={`text-[11px] font-medium ${schrift}`} style={{ color: geaendert ? ORANGE : 'rgba(255,255,255,0.5)' }}>{tx('begruendung')}</span>
              <textarea
                value={begruendung}
                onChange={(e) => setBegruendung(e.target.value)}
                rows={3}
                className={`bg-black border px-3 py-2 text-[15px] font-medium ${schrift} text-white outline-none`}
                style={{ borderColor: geaendert ? ORANGE : 'rgba(255,255,255,0.3)' }}
              />
            </label>
          </div>
        ) : (
          <div className="mt-[16px]">
            <ZeitZeile label={tx('beginn')} wert={uhr(v.beginn)} />
            <ZeitZeile label={tx('ende')} wert={uhr(v.ende)} />
            <ZeitZeile label={tx('pause')} wert={tx('minuten', { n: v.pause_min || 0 })} />
            {(v.pausen || []).map((p, i) => (
              <div key={i} className={`text-[12px] font-medium ${schrift} text-white/45 mt-[4px]`}>{uhr(p.von)} – {uhr(p.bis)}</div>
            ))}
          </div>
        )}

        {/* Fahrten des Dienstes */}
        {(v.fahrten || []).length ? (
          <div className="mt-[22px]">
            <div className={`text-[13px] font-bold ${schrift}`} style={{ color: LIME }}>{tx('fahrten')} · {(v.fahrten || []).length}</div>
            <div className="mt-[8px] flex flex-col gap-[6px]">
              {v.fahrten.map((f) => (
                <div key={f.id} className="bg-white px-4 py-3">
                  <div className={`text-[12px] font-medium ${schrift} text-zinc-900/70`}>
                    {uhr(f.start)} – {uhr(f.ende)}{f.genau ? '' : ` · ${tx('geschaetzt')}`}
                  </div>
                  <div className={`text-[16px] font-bold ${schrift} text-zinc-900 truncate`}>{f.gaeste || `${f.von || ''} → ${f.nach || ''}`}</div>
                  {f.gaeste ? <div className={`text-[12px] font-medium ${schrift} text-zinc-900/70 truncate`}>{f.von} → {f.nach}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {fehler ? <div className={`mt-[14px] text-[13px] font-medium ${schrift}`} style={{ color: ORANGE }}>{fehler}</div> : null}
      </div>

      <div className="fixed left-0 right-0 bottom-0 z-50 bg-gradient-to-t from-black via-black to-transparent pt-[20px] pb-[16px]">
        <div className="w-[min(402px,100vw)] mx-auto px-[20px] flex flex-col gap-[8px]">
          <button type="button" disabled={busy || !arbeitsMin} onClick={speichern} className="w-full h-14 px-4 flex items-center justify-between disabled:opacity-40" style={{ background: LIME }}>
            <span className={`text-[16px] font-medium ${schrift} text-[#1d1c1d]`}>{anpassen ? tx('einreichen') : tx('stimmt')}</span>
            <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
          </button>
          {!anpassen ? (
            <button type="button" onClick={() => setAnpassen(true)} className="w-full h-12 border-2 px-4 text-left" style={{ borderColor: LIME }}>
              <span className={`text-[15px] font-medium ${schrift}`} style={{ color: LIME }}>{tx('anpassen')}</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const StatusZeile = ({ label, farbe }) => (
  <div className="w-full h-12 px-4 flex items-center" style={{ outline: `1px solid ${farbe}`, outlineOffset: '-1px' }}>
    <span className={`text-[22px] font-bold ${schrift}`} style={{ color: farbe }}>{label}</span>
  </div>
);

const StundenStatus = ({ eintrag, oeffnen }) => {
  const z = eintrag.zettel;
  if (z) {
    const farbe = z.status === 'bestaetigt' ? GRUEN : z.status === 'zurueckgewiesen' ? ROT : ORANGE;
    const label = z.status === 'bestaetigt' ? tx('bestaetigt') : z.status === 'zurueckgewiesen' ? tx('zurueckgegeben') : tx('eingereicht');
    return (
      <div className="w-full">
        <button type="button" onClick={z.status === 'bestaetigt' ? undefined : oeffnen} className="w-full h-14 px-4 flex items-center justify-between border-2" style={{ borderColor: farbe }}>
          <span className={`text-[16px] font-bold ${schrift}`} style={{ color: farbe }}>{label}</span>
          <span className={`text-[20px] font-bold ${schrift}`} style={{ color: farbe }}>{hmm(z.arbeits_min)} h</span>
        </button>
        {z.status === 'zurueckgewiesen' && z.dispo_notiz ? <div className={`mt-[6px] text-[13px] font-medium ${schrift}`} style={{ color: ROT }}>{z.dispo_notiz}</div> : null}
        {z.status === 'zurueckgewiesen' ? (
          <button type="button" onClick={oeffnen} className={`mt-[6px] text-[13px] font-medium underline ${schrift}`} style={{ color: LIME }}>{tx('neu')}</button>
        ) : null}
      </div>
    );
  }
  if (!eintrag.vorbei) return <div className={`text-[13px] font-medium ${schrift} text-white/45`}>{tx('laeuft')}</div>;
  return (
    <button type="button" onClick={oeffnen} className="w-full h-14 px-4 flex items-center justify-between" style={{ background: LIME }}>
      <span className={`text-[16px] font-medium ${schrift} text-[#1d1c1d]`}>{tx('erfassen')}</span>
      <span className={`text-[16px] font-bold ${schrift} text-[#1d1c1d]`}>{hmm(eintrag.vorschlag?.arbeits_min)} h</span>
    </button>
  );
};

// Liste der Dienste im Verlauf (live).
export function StundenVerlauf({ fahrerId }) {
  const { eintraege, laden } = useStundenVerlauf(60);
  const [offen, setOffen] = useState(null);
  if (eintraege === null) return null;
  if (!eintraege.length) {
    return <p className={`text-white/70 text-[16px] font-medium leading-6 ${schrift}`}>{tx('leer')}</p>;
  }
  return (
    <div className="flex flex-col gap-[28px]">
      {eintraege.map((e) => (
        <div key={e.dienst.id} className="flex flex-col gap-[10px]">
          <div className="flex items-center justify-between">
            <span className="w-[44px] h-[2px]" style={{ background: LIME }} />
            <span className={`text-[24px] font-bold ${schrift}`} style={{ color: LIME }}>{tagTitel(e.dienst.datum)}</span>
            <span className="w-[44px] h-[2px]" style={{ background: LIME }} />
          </div>
          <StatusZeile label={tx('dienstbeginn', { zeit: e.dienst.beginn })} farbe={LIME} />
          {(e.vorschlag?.fahrten || []).map((f) => (
            <div key={f.id} className="bg-white px-4 py-3">
              <div className={`text-[13px] font-medium ${schrift} text-zinc-900/70`}>{uhr(f.start)} – {uhr(f.ende)}</div>
              <div className={`text-[20px] font-bold ${schrift} text-zinc-900 leading-6`}>{f.gaeste || `${f.von} → ${f.nach}`}</div>
              {f.gaeste ? <div className={`text-[12px] font-medium ${schrift} text-zinc-900/70`}>{f.von} → {f.nach}</div> : null}
            </div>
          ))}
          <StatusZeile label={tx('dienstende', { zeit: e.dienst.ende })} farbe={ROT} />
          <StundenStatus eintrag={e} oeffnen={() => setOffen(e)} />
        </div>
      ))}
      {offen ? (
        <StundenErfassen
          eintrag={offen}
          fahrerId={fahrerId}
          schliessen={() => setOffen(null)}
          fertig={() => { setOffen(null); laden(); }}
        />
      ) : null}
    </div>
  );
}

// Hinweis auf der Startseite (mit und ohne Fahrten): offene Stunden der letzten zwei Wochen.
// Antippen oeffnet direkt das Erfassen des aeltesten offenen Dienstes.
export function StundenHinweis({ className = '' }) {
  const { eintraege, laden } = useStundenVerlauf(14);
  const [offen, setOffen] = useState(null);
  const liste = (eintraege || []).filter((e) => e.vorbei && (!e.zettel || e.zettel.status === 'zurueckgewiesen'));
  if (!liste.length && !offen) return null;
  const aeltester = liste[liste.length - 1];
  return (
    <>
      {aeltester ? (
        <button type="button" onClick={() => setOffen(aeltester)} className={`h-14 px-4 flex items-center justify-between ${className}`} style={{ background: LIME }}>
          <span className={`text-[16px] font-medium ${schrift} text-[#1d1c1d] truncate pr-3`}>
            {tx('hinweisStart', { tage: liste.slice(0, 3).map((e) => tagKurz(e.dienst.datum)).join(', ') })}
          </span>
          <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px] shrink-0" />
        </button>
      ) : null}
      {offen ? (
        <StundenErfassen eintrag={offen} schliessen={() => setOffen(null)} fertig={() => { setOffen(null); laden(); }} />
      ) : null}
    </>
  );
}
