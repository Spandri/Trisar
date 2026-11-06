// Stunden eines Fahrers fuer die Dispo: eingereichte Stunden pruefen, Pausen der Dienste planen,
// Excel-Export (Zeitraum und Fahrer frei waehlbar). Daten: stunden_verlauf(), stundenzettel,
// dienst_pausen, driver_service_requests, Export ueber dispo-admin (stunden_export).

import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabase';

const LIME = '#E3F654';
const ORANGE = '#ffcd8a';
const ROT = '#ff6f63';
const GRUEN = '#8DFFAF';
const schrift = "font-['Space_Grotesk']";

const uhr = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '--:--');
const hmm = (min) => `${Math.floor((min || 0) / 60)}:${String(Math.round((min || 0) % 60)).padStart(2, '0')}`;
const tagKurz = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`.replace(/\.*$/, '.');
};
const isoTag = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const Ueberschrift = ({ children, zahl }) => (
  <div className={`mt-[28px] flex items-baseline justify-between ${schrift}`}>
    <span className="text-[22px] font-bold" style={{ color: LIME }}>{children}</span>
    {zahl != null ? <span className="text-[13px] font-medium text-white/50">{zahl}</span> : null}
  </div>
);

const Knopf = ({ children, onClick, hell = false, farbe = LIME, disabled = false }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`h-[44px] px-4 text-[14px] font-bold ${schrift} disabled:opacity-40`}
    style={hell ? { background: farbe, color: '#000' } : { border: `2px solid ${farbe}`, color: farbe }}
  >
    {children}
  </button>
);

const Eingabe = ({ label, value, onChange, typ = 'text', breite = 'flex-1' }) => (
  <label className={`flex flex-col gap-[3px] ${breite}`}>
    <span className={`text-[10px] font-medium ${schrift} text-white/50`}>{label}</span>
    <input
      type={typ}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`h-[38px] bg-black border border-white/30 px-2 text-[14px] font-medium ${schrift} text-white outline-none focus:border-[#E3F654]`}
    />
  </label>
);

// Eingereichte Stunden: Vergleich mit dem Vorschlag, bestaetigen oder zurueckgeben.
const ZettelKarte = ({ eintrag, neuLaden }) => {
  const z = eintrag.zettel;
  const v = z.vorschlag || eintrag.vorschlag || {};
  const [notiz, setNotiz] = useState(z.dispo_notiz || '');
  const [zurueck, setZurueck] = useState(false);
  const [busy, setBusy] = useState(false);
  const farbe = z.status === 'bestaetigt' ? GRUEN : z.status === 'zurueckgewiesen' ? ROT : ORANGE;
  const setzen = async (status) => {
    setBusy(true);
    const { data: nutzer } = await supabase.auth.getUser();
    await supabase.from('stundenzettel').update({
      status, dispo_notiz: notiz.trim() || null, geprueft_von: nutzer?.user?.id || null,
      geprueft_am: new Date().toISOString(), aktualisiert: new Date().toISOString(),
    }).eq('id', z.id);
    setBusy(false);
    neuLaden();
  };
  const abweichung = (a, b) => (uhr(a) !== uhr(b) ? ORANGE : '#fff');
  return (
    <div className="bg-[#0f0f0f] border-2 p-4" style={{ borderColor: farbe }}>
      <div className={`flex items-center justify-between ${schrift}`}>
        <span className="text-[18px] font-bold text-white">{tagKurz(eintrag.dienst.datum)}</span>
        <span className="text-[24px] font-bold" style={{ color: farbe }}>{hmm(z.arbeits_min)} h</span>
      </div>
      <div className={`mt-[6px] grid grid-cols-3 gap-2 ${schrift}`}>
        <div><div className="text-[10px] text-white/50">Beginn</div><div className="text-[16px] font-bold" style={{ color: abweichung(z.beginn, v.beginn) }}>{uhr(z.beginn)}</div></div>
        <div><div className="text-[10px] text-white/50">Ende</div><div className="text-[16px] font-bold" style={{ color: abweichung(z.ende, v.ende) }}>{uhr(z.ende)}</div></div>
        <div><div className="text-[10px] text-white/50">Pause</div><div className="text-[16px] font-bold" style={{ color: z.pause_min !== (v.pause_min || 0) ? ORANGE : '#fff' }}>{z.pause_min} Min.</div></div>
      </div>
      {z.angepasst ? (
        <div className={`mt-[8px] text-[12px] font-medium ${schrift}`} style={{ color: ORANGE }}>
          Angepasst · Vorschlag {uhr(v.beginn)}–{uhr(v.ende)}, {hmm(v.arbeits_min)} h
          {z.begruendung ? <div className="mt-[2px] text-white/80">„{z.begruendung}“</div> : null}
        </div>
      ) : (
        <div className={`mt-[8px] text-[12px] font-medium ${schrift} text-white/45`}>Wie vorgeschlagen · {(v.fahrten || []).length} Fahrten</div>
      )}
      {z.status === 'eingereicht' ? (
        zurueck ? (
          <div className="mt-[10px] flex flex-col gap-2">
            <Eingabe label="Hinweis an den Fahrer" value={notiz} onChange={setNotiz} />
            <div className="flex gap-2">
              <Knopf hell farbe={ROT} disabled={busy || !notiz.trim()} onClick={() => setzen('zurueckgewiesen')}>Zurückgeben</Knopf>
              <Knopf onClick={() => setZurueck(false)}>Abbrechen</Knopf>
            </div>
          </div>
        ) : (
          <div className="mt-[10px] flex gap-2">
            <Knopf hell disabled={busy} onClick={() => setzen('bestaetigt')}>Bestätigen</Knopf>
            <Knopf farbe={ROT} onClick={() => setZurueck(true)}>Zurückgeben</Knopf>
          </div>
        )
      ) : (
        <div className={`mt-[8px] text-[12px] font-bold ${schrift}`} style={{ color: farbe }}>
          {z.status === 'bestaetigt' ? 'Bestätigt' : 'Zurückgegeben'}{z.dispo_notiz ? ` · ${z.dispo_notiz}` : ''}
        </div>
      )}
    </div>
  );
};

// Pausen eines Dienstes planen: fest (von–bis) oder nach einer Fahrt (Abstand, Dauer).
const DienstPausen = ({ dienst, pausen, fahrten, speichern }) => {
  const [neu, setNeu] = useState(null);
  const fahrtText = (id) => {
    const f = fahrten.find((x) => x.id === id);
    return f ? `${String(f.etd || '').slice(0, 5)} ${f.pickup_name || ''}` : 'Fahrt';
  };
  const hinzufuegen = () => {
    if (!neu) return;
    const p = neu.art === 'fest'
      ? { art: 'fest', von: neu.von, bis: neu.bis }
      : { art: 'nach_fahrt', job_id: neu.job_id, nach_min: Number(neu.nach_min) || 0, dauer_min: Number(neu.dauer_min) || 0 };
    speichern([...pausen, p]);
    setNeu(null);
  };
  const gueltig = neu && (neu.art === 'fest' ? /^\d{2}:\d{2}$/.test(neu.von) && /^\d{2}:\d{2}$/.test(neu.bis) : neu.job_id && Number(neu.dauer_min) > 0);
  return (
    <div className="bg-white p-4">
      <div className={`flex items-center justify-between ${schrift}`}>
        <span className="text-[18px] font-bold text-zinc-900">{tagKurz(dienst.service_date)}</span>
        <span className="text-[16px] font-bold text-zinc-900">{String(dienst.service_start_time || '').slice(0, 5)}–{String(dienst.service_end_time || '').slice(0, 5)}</span>
      </div>
      <div className={`text-[12px] font-medium ${schrift} text-zinc-500`}>{fahrten.length} Fahrten · {dienst.status === 'accepted' ? 'angenommen' : 'angefragt'}</div>
      <div className="mt-[8px] flex flex-wrap gap-[6px]">
        {pausen.map((p, i) => (
          <span key={i} className={`h-[28px] px-2 inline-flex items-center gap-2 bg-zinc-900 text-[12px] font-medium ${schrift}`} style={{ color: LIME }}>
            {p.art === 'fest' ? `Pause ${p.von}–${p.bis}` : `Pause ${p.dauer_min} Min. ${p.nach_min ? `${p.nach_min} Min. ` : ''}nach ${fahrtText(p.job_id)}`}
            <button type="button" aria-label="Pause entfernen" onClick={() => speichern(pausen.filter((_, j) => j !== i))} className="text-white/60">✕</button>
          </span>
        ))}
        {!neu ? (
          <button type="button" onClick={() => setNeu({ art: 'fest', von: '', bis: '' })} className={`h-[28px] px-2 border border-zinc-900 text-[12px] font-bold ${schrift} text-zinc-900`}>+ Pause</button>
        ) : null}
      </div>
      {neu ? (
        <div className="mt-[10px] flex flex-col gap-2 bg-zinc-900 p-3">
          <div className="flex gap-2">
            {[['fest', 'Feste Zeit'], ['nach_fahrt', 'Nach einer Fahrt']].map(([art, text]) => (
              <button key={art} type="button" onClick={() => setNeu({ ...neu, art })} className={`h-[32px] px-3 text-[12px] font-bold ${schrift}`}
                style={neu.art === art ? { background: LIME, color: '#000' } : { border: '1px solid rgba(255,255,255,0.3)', color: '#fff' }}>{text}</button>
            ))}
          </div>
          {neu.art === 'fest' ? (
            <div className="flex gap-2">
              <Eingabe label="Von" typ="time" value={neu.von} onChange={(von) => setNeu({ ...neu, von })} />
              <Eingabe label="Bis" typ="time" value={neu.bis} onChange={(bis) => setNeu({ ...neu, bis })} />
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-[3px]">
                <span className={`text-[10px] font-medium ${schrift} text-white/50`}>Nach Ende der Fahrt</span>
                <select value={neu.job_id || ''} onChange={(e) => setNeu({ ...neu, job_id: e.target.value })}
                  className={`h-[38px] bg-black border border-white/30 px-2 text-[14px] ${schrift} text-white`}>
                  <option value="">Fahrt wählen</option>
                  {fahrten.map((f) => <option key={f.id} value={f.id}>{fahrtText(f.id)}</option>)}
                </select>
              </label>
              <div className="flex gap-2">
                <Eingabe label="Abstand (Min.)" typ="number" value={neu.nach_min ?? ''} onChange={(nach_min) => setNeu({ ...neu, nach_min })} />
                <Eingabe label="Dauer (Min.)" typ="number" value={neu.dauer_min ?? ''} onChange={(dauer_min) => setNeu({ ...neu, dauer_min })} />
              </div>
            </>
          )}
          <div className="flex gap-2">
            <Knopf hell disabled={!gueltig} onClick={hinzufuegen}>Pause speichern</Knopf>
            <Knopf onClick={() => setNeu(null)}>Abbrechen</Knopf>
          </div>
        </div>
      ) : null}
    </div>
  );
};

// Excel-Export: Zeitraum und Fahrer frei waehlbar.
const Export = ({ fahrer, alleFahrer }) => {
  const heute = new Date();
  const [von, setVon] = useState(isoTag(new Date(heute.getFullYear(), heute.getMonth(), 1)));
  const [bis, setBis] = useState(isoTag(new Date(heute.getFullYear(), heute.getMonth() + 1, 0)));
  const [auswahl, setAuswahl] = useState([fahrer.id]);
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState('');
  const umschalten = (id) => setAuswahl((a) => (a.includes(id) ? a.filter((x) => x !== id) : [...a, id]));
  const alle = auswahl.length === alleFahrer.length;
  const exportieren = async () => {
    setBusy(true); setMeldung('');
    const { data, error } = await supabase.functions.invoke('dispo-admin', { body: { aktion: 'stunden_export', von, bis, fahrer: alle ? null : auswahl } });
    setBusy(false);
    if (error || !data?.datei) { setMeldung('Export fehlgeschlagen.'); return; }
    const bytes = Uint8Array.from(atob(data.datei), (c) => c.charCodeAt(0));
    const datei = new File([bytes], data.dateiname, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    if (navigator.canShare?.({ files: [datei] })) {
      try { await navigator.share({ files: [datei], title: data.dateiname }); return; } catch { /* abgebrochen: herunterladen */ }
    }
    const url = URL.createObjectURL(datei);
    const a = document.createElement('a');
    a.href = url; a.download = data.dateiname; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setMeldung(`${data.dienste} Dienste exportiert.`);
  };
  return (
    <div className="bg-[#0f0f0f] border border-white/15 p-4 flex flex-col gap-3">
      <div className="flex gap-2">
        <Eingabe label="Von" typ="date" value={von} onChange={setVon} />
        <Eingabe label="Bis" typ="date" value={bis} onChange={setBis} />
      </div>
      <div className="flex flex-wrap gap-[6px]">
        <button type="button" onClick={() => setAuswahl(alle ? [fahrer.id] : alleFahrer.map((f) => f.id))}
          className={`h-[30px] px-3 text-[12px] font-bold ${schrift}`} style={alle ? { background: LIME, color: '#000' } : { border: `1px solid ${LIME}`, color: LIME }}>Alle Fahrer</button>
        {alleFahrer.map((f) => (
          <button key={f.id} type="button" onClick={() => umschalten(f.id)} className={`h-[30px] px-3 text-[12px] font-medium ${schrift}`}
            style={auswahl.includes(f.id) ? { background: LIME, color: '#000' } : { border: '1px solid rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.75)' }}>{f.name}</button>
        ))}
      </div>
      <Knopf hell disabled={busy || !auswahl.length} onClick={exportieren}>{busy ? 'Excel wird erstellt …' : 'Excel exportieren'}</Knopf>
      {meldung ? <div className={`text-[12px] ${schrift} text-white/60`}>{meldung}</div> : null}
    </div>
  );
};

export default function FahrerStunden({ fahrer, schliessen }) {
  const [verlauf, setVerlauf] = useState(null);
  const [dienste, setDienste] = useState([]);
  const [pausenJe, setPausenJe] = useState({});
  const [fahrtenJe, setFahrtenJe] = useState({});
  const [alleFahrer, setAlleFahrer] = useState([]);
  const [stand, setStand] = useState(0);
  // Schalter: bekommt dieser Fahrer die Stundenerfassung (Standard an).
  const [erfassungAn, setErfassungAn] = useState(true);

  useEffect(() => {
    let aktiv = true;
    (async () => {
      const heute = isoTag(new Date());
      const [{ data: v }, { data: d }, { data: f }, { data: es }] = await Promise.all([
        supabase.rpc('stunden_verlauf', { p_driver: fahrer.id, p_tage: 60 }),
        supabase.from('driver_service_requests').select('id, service_date, service_start_time, service_end_time, status')
          .eq('driver_id', fahrer.id).gte('service_date', heute).in('status', ['pending', 'accepted']).order('service_date').limit(30),
        supabase.from('profiles').select('id, first_name, last_name, role, is_dispo').order('first_name'),
        supabase.from('fahrer_einstellungen').select('stundenerfassung').eq('driver_id', fahrer.id).maybeSingle(),
      ]);
      const kommende = d || [];
      const ids = kommende.map((x) => x.id);
      const tage = [...new Set(kommende.map((x) => x.service_date))];
      const [{ data: p }, { data: j }] = await Promise.all([
        ids.length ? supabase.from('dienst_pausen').select('*').in('dienst_id', ids) : { data: [] },
        tage.length ? supabase.from('jobs').select('id, ride_date, etd, pickup_name').eq('driver_id', fahrer.id).in('ride_date', tage).order('etd') : { data: [] },
      ]);
      if (!aktiv) return;
      setVerlauf(v || []);
      setErfassungAn(es ? es.stundenerfassung !== false : true);
      setDienste(kommende);
      setPausenJe(Object.fromEntries((p || []).map((x) => [x.dienst_id, x.pausen || []])));
      const nachTag = {};
      (j || []).forEach((x) => { (nachTag[x.ride_date] ||= []).push(x); });
      setFahrtenJe(nachTag);
      setAlleFahrer((f || []).filter((x) => !x.is_dispo && !['dispo', 'dispatcher', 'admin', 'koordinator', 'pruefung'].includes(String(x.role || '').toLowerCase()))
        .map((x) => ({ id: x.id, name: `${x.first_name || ''} ${x.last_name || ''}`.trim() || 'Fahrer' })));
    })();
    return () => { aktiv = false; };
  }, [fahrer.id, stand]);

  const neuLaden = () => setStand((n) => n + 1);
  const pausenSpeichern = async (dienstId, pausen) => {
    setPausenJe((alt) => ({ ...alt, [dienstId]: pausen }));
    await supabase.from('dienst_pausen').upsert({ dienst_id: dienstId, pausen, aktualisiert: new Date().toISOString() });
  };

  const erfassungSchalten = async () => {
    const neuWert = !erfassungAn;
    setErfassungAn(neuWert);
    const { error } = await supabase.from('fahrer_einstellungen')
      .upsert({ driver_id: fahrer.id, stundenerfassung: neuWert, aktualisiert: new Date().toISOString() });
    if (error) setErfassungAn(!neuWert);
  };

  const zuPruefen = useMemo(() => (verlauf || []).filter((e) => e.zettel?.status === 'eingereicht'), [verlauf]);
  const erledigt = useMemo(() => (verlauf || []).filter((e) => e.zettel && e.zettel.status !== 'eingereicht'), [verlauf]);
  const offen = useMemo(() => (verlauf || []).filter((e) => !e.zettel && e.vorbei), [verlauf]);
  const summeMonat = (verlauf || []).filter((e) => e.zettel?.status === 'bestaetigt' && e.dienst.datum.slice(0, 7) === isoTag(new Date()).slice(0, 7))
    .reduce((n, e) => n + (e.zettel.arbeits_min || 0), 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black" style={{ backgroundImage: 'radial-gradient(141.42% 102.21% at 0% 0%, #0048cf 0%, #001234 34%, #000 46%)' }}>
      <div className="w-[min(402px,100vw)] mx-auto px-[20px] pt-[60px] pb-[80px]">
        <button type="button" onClick={schliessen} aria-label="Zurück" className="w-[50px] h-[50px] rounded-full border border-[#747474] flex items-center justify-center">
          <img src="/icon/_Icon_Grau/Arrow_Trisar_Icons_01_grau.svg" alt="" className="w-[26px] h-[16px] rotate-180" />
        </button>
        <h1 className={`mt-[30px] text-[42px] leading-[42px] font-bold ${schrift}`} style={{ color: LIME }}>Stunden</h1>
        <div className={`mt-[6px] text-[16px] font-medium ${schrift} text-white/70`}>{fahrer.name}</div>

        {/* Schalter: Stundenerfassung fuer diesen Fahrer an oder aus */}
        <button
          type="button"
          onClick={erfassungSchalten}
          className="mt-[16px] w-full h-[56px] px-4 flex items-center justify-between border-2"
          style={{ borderColor: erfassungAn ? LIME : 'rgba(255,255,255,0.3)', background: '#0f0f0f' }}
        >
          <span className="flex flex-col items-start">
            <span className={`text-[16px] font-bold ${schrift}`} style={{ color: erfassungAn ? LIME : 'rgba(255,255,255,0.7)' }}>Stundenerfassung</span>
            <span className={`text-[11px] font-medium ${schrift} text-white/50`}>{erfassungAn ? 'Fahrer erfasst nach jedem Dienst seine Stunden' : 'Fahrer sieht keine Stundenerfassung'}</span>
          </span>
          <span className="w-[52px] h-[30px] rounded-full p-[3px] flex transition-colors" style={{ background: erfassungAn ? LIME : 'rgba(255,255,255,0.2)', justifyContent: erfassungAn ? 'flex-end' : 'flex-start' }}>
            <span className="w-[24px] h-[24px] rounded-full" style={{ background: erfassungAn ? '#000' : '#fff' }} />
          </span>
        </button>

        <div className="mt-[16px] grid grid-cols-3 gap-2">
          {[[zuPruefen.length, 'zu prüfen', zuPruefen.length ? ORANGE : null], [offen.length, 'nicht erfasst', offen.length ? ROT : null], [hmm(summeMonat), 'bestätigt (Monat)', null]].map(([zahl, text, farbe], i) => (
            <div key={i} className="h-[64px] px-3 flex flex-col justify-center" style={i === 2 ? { background: LIME } : { background: '#0f0f0f', border: `1px solid ${farbe || 'rgba(227,246,84,0.35)'}` }}>
              <span className={`text-[24px] leading-[26px] font-bold ${schrift}`} style={{ color: i === 2 ? '#000' : (farbe || LIME) }}>{zahl}</span>
              <span className={`text-[11px] font-medium ${schrift}`} style={{ color: i === 2 ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.55)' }}>{text}</span>
            </div>
          ))}
        </div>

        {verlauf === null ? <div className={`mt-[24px] text-white/50 ${schrift}`}>Lädt …</div> : null}

        {zuPruefen.length ? (
          <>
            <Ueberschrift zahl={zuPruefen.length}>Zu prüfen</Ueberschrift>
            <div className="mt-[10px] flex flex-col gap-[10px]">{zuPruefen.map((e) => <ZettelKarte key={e.dienst.id} eintrag={e} neuLaden={neuLaden} />)}</div>
          </>
        ) : null}

        {offen.length ? (
          <>
            <Ueberschrift zahl={offen.length}>Nicht erfasst</Ueberschrift>
            <div className="mt-[10px] flex flex-col gap-[6px]">
              {offen.map((e) => (
                <div key={e.dienst.id} className={`h-[48px] px-4 flex items-center justify-between border ${schrift}`} style={{ borderColor: 'rgba(255,111,99,0.6)' }}>
                  <span className="text-[15px] font-bold text-white">{tagKurz(e.dienst.datum)}</span>
                  <span className="text-[13px] font-medium text-white/60">Vorschlag {uhr(e.vorschlag?.beginn)}–{uhr(e.vorschlag?.ende)} · {hmm(e.vorschlag?.arbeits_min)} h</span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <Ueberschrift>Dienste und Pausen</Ueberschrift>
        <div className="mt-[10px] flex flex-col gap-[10px]">
          {dienste.length ? dienste.map((d) => (
            <DienstPausen key={d.id} dienst={d} pausen={pausenJe[d.id] || []} fahrten={fahrtenJe[d.service_date] || []} speichern={(p) => pausenSpeichern(d.id, p)} />
          )) : <div className={`text-[14px] ${schrift} text-white/50`}>Keine kommenden Dienste.</div>}
        </div>

        {erledigt.length ? (
          <>
            <Ueberschrift zahl={erledigt.length}>Geprüft</Ueberschrift>
            <div className="mt-[10px] flex flex-col gap-[10px]">{erledigt.map((e) => <ZettelKarte key={e.dienst.id} eintrag={e} neuLaden={neuLaden} />)}</div>
          </>
        ) : null}

        <Ueberschrift>Excel</Ueberschrift>
        <div className="mt-[10px]"><Export fahrer={fahrer} alleFahrer={alleFahrer.length ? alleFahrer : [fahrer]} /></div>
      </div>
    </div>
  );
}
