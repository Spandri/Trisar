/* eslint-disable react-refresh/only-export-components -- Karte, Hoehen und Hooks gehoeren zusammen (Raster der Fahrtenliste). */
// Stundenerfassung fuer den Fahrer: eine Karte am Ende jedes Diensttages, gebaut wie die
// Dienstkarte (dunkle Flaeche, grosse Zeiten), darin die Fahrten des Dienstes. Darunter
// Ablehnen, Bearbeiten, Annehmen wie bei Diensten und Fahrten. Zeiten in halben Stunden.
// Daten: Datenbank-Funktion stunden_verlauf() und Tabelle stundenzettel (gleich in iOS und Android).
// Der Verlauf (Profil -> Verlauf) steht in Verlauf.jsx und nutzt Karte, Hook und Tageszeile von hier.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEMO_MODE } from '../../../datenquelle';
import { supabase } from '../../../shared/supabase/client';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import CancelRideSheet from './CancelRideSheet';

const LIME = '#E3F654';
const ROT = '#ff6f63';
const ORANGE = '#ffcd8a';
const GRUEN = '#8DFFAF';
const FLAECHE = '#1a1a1a';
const schrift = { fontFamily: 'Space Grotesk' };

const TEXTE = {
  verlauf: 'Verlauf',
  stunden: 'Stunden {zeit}',
  pause: 'Pause {zeit}',
  eingereicht: 'Eingereicht',
  bestaetigt: 'Bestätigt',
  zurueckgegeben: 'Zurückgegeben',
  gefahren: 'gefahren',
  geplant: 'geplant',
  ablehnen: 'Ablehnen',
  bearbeiten: 'Bearbeiten',
  annehmen: 'Annehmen',
  bearbeitenTitel: 'Stunden bearbeiten',
  vorschlag: 'Vorschlag {von} – {bis} · {zeit}',
  beginn: 'Beginn',
  ende: 'Ende',
  pauseLabel: 'Pause',
  pauseAb: 'Pause erst ab 3 Stunden, kürzere Pausen sind Arbeitszeit.',
  begruendung: 'Warum weicht es ab?',
  schreiben: 'Schreiben...',
  begruendungFehlt: 'Bitte kurz schreiben, warum die Zeiten abweichen.',
  senden: 'Bearbeitung senden',
  ablehnenTitel: 'Warum stimmen die Stunden nicht?',
  ablehnenSenden: 'Ablehnen senden',
  abgelehnt: 'Abgelehnt: ',
  ohneAngabe: 'ohne Angabe',
  dispo: 'Dispo: ',
  keinVorschlag: 'Kein Vorschlag, bitte bearbeiten.',
  fehler: 'Speichern fehlgeschlagen: {meldung}',
};
const tx = (k, w = {}) => Object.entries(w).reduce((s, [a, b]) => s.replace(`{${a}}`, b), TEXTE[k] || k);

export const uhr = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '--:--');
const hmm = (min) => `${Math.floor((min || 0) / 60)}:${String(Math.round((min || 0) % 60)).padStart(2, '0')}`;
const tagTitel = (iso) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString('de-DE', { weekday: 'long' })} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`.replace(/\.*$/, '.');
};
// Immer zugunsten des Fahrers: Arbeitszeit und Ende auf, Beginn und Pause ab.
const halbeAuf = (min) => Math.ceil((min || 0) / 30) * 30;
const halbeAb = (min) => Math.floor((min || 0) / 30) * 30;
// Als Pause zaehlt nur eine Unterbrechung von mindestens 3 Stunden, kuerzere sind Arbeitszeit.
const PAUSE_MIN = 180;
const pauseZaehlt = (pause) => (pause >= PAUSE_MIN ? pause : 0);

// Zeit HH:MM am Tag des Dienstes (Europe/Berlin) als ISO. Vor dem Beginn liegende Enden rutschen auf den Folgetag.
export const zuZeitpunkt = (datum, hhmm, nachIso = null) => {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm || '')) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const mittag = new Date(`${datum}T12:00:00Z`);
  const berlin = new Date(mittag.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const versatz = berlin.getTime() - new Date(mittag.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  let t = Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)), h, m) - versatz;
  if (nachIso && t <= new Date(nachIso).getTime()) t += 86400000;
  return new Date(t).toISOString();
};

export const useStundenVerlauf = (tage = 60) => {
  const [eintraege, setEintraege] = useState(null);
  const [stand, setStand] = useState(0);
  useEffect(() => {
    let aktiv = true;
    if (DEMO_MODE) { Promise.resolve().then(() => { if (aktiv) setEintraege([]); }); return () => { aktiv = false; }; }
    supabase.rpc('stunden_verlauf', { p_tage: tage }).then(({ data, error }) => {
      if (aktiv) setEintraege(error ? [] : data || []);
    });
    return () => { aktiv = false; };
  }, [tage, stand]);
  // Wieder vorne: neu laden (Dienst kann inzwischen vorbei sein).
  useEffect(() => {
    const sichtbar = () => { if (document.visibilityState === 'visible') setStand((n) => n + 1); };
    document.addEventListener('visibilitychange', sichtbar);
    return () => document.removeEventListener('visibilitychange', sichtbar);
  }, []);
  const laden = useCallback(() => setStand((n) => n + 1), []);
  return { eintraege, laden };
};

// Karten fuer die Fahrtenliste: Dienst vorbei, noch nicht bestaetigt (letzte zwei Wochen).
export const useStundenKarten = () => {
  const { eintraege, laden } = useStundenVerlauf(14);
  const karten = useMemo(() => (eintraege || []).filter((e) => e.vorbei && e.zettel?.status !== 'bestaetigt'), [eintraege]);
  return { karten, laden };
};

const speichern = async (eintrag, { beginn, ende, pauseMin, angepasst, begruendung }) => {
  const fahrer = (await supabase.auth.getUser()).data?.user?.id;
  const jetzt = new Date().toISOString();
  const dauer = Math.round((new Date(ende) - new Date(beginn)) / 60000);
  const pause = pauseZaehlt(pauseMin);
  const arbeits = Math.max(0, halbeAuf(dauer - pause));
  const v = eintrag.vorschlag || null;
  const zeile = {
    driver_id: fahrer,
    dienst_id: eintrag.dienst.id,
    datum: eintrag.dienst.datum,
    beginn,
    ende,
    pausen: angepasst ? [] : (v?.pausen || []),
    pause_min: pause,
    arbeits_min: arbeits,
    vorschlag: v,
    angepasst,
    begruendung: angepasst ? begruendung : null,
    status: 'eingereicht',
    eingereicht_am: jetzt,
    aktualisiert: jetzt,
  };
  const { error } = eintrag.zettel
    ? await supabase.from('stundenzettel').update(zeile).eq('id', eintrag.zettel.id)
    : await supabase.from('stundenzettel').insert(zeile);
  if (error) throw error;
};

// Hoehen wie in iOS (StundenKarte): Kopf 124, Fahrtzeilen 46 mit 8 Abstand, Notiz 30, Knoepfe 12 + 51.
const KOPF = 124;
const ZEILE = 46;
const ZEILEN_ABSTAND = 8;
const KNOPF_ABSTAND = 12;
const KNOPF_HOEHE = 51;

const notizText = (e) => {
  const z = e.zettel;
  if (!z) return null;
  if (z.status === 'zurueckgewiesen' && z.dispo_notiz) return tx('dispo') + z.dispo_notiz;
  return z.begruendung || null;
};
export const stundenMitKnoepfen = (e) => Boolean(e.vorbei && (!e.zettel || e.zettel.status === 'zurueckgewiesen'));
const kartenHoehe = (e) => {
  const n = (e.vorschlag?.fahrten || []).length;
  let h = KOPF;
  if (n) h += 1 + 14 + n * ZEILE + (n - 1) * ZEILEN_ABSTAND + 16;
  if (notizText(e)) h += 30;
  return h;
};
export const stundenKartenHoehe = (e) => kartenHoehe(e) + (stundenMitKnoepfen(e) ? KNOPF_ABSTAND + KNOPF_HOEHE : 0);

const FahrtZeile = ({ f }) => (
  <div className="flex items-start gap-[12px]" style={{ height: ZEILE }}>
    <span className="w-[52px] shrink-0 text-[18px] font-bold leading-[22px]" style={{ ...schrift, color: LIME }}>{f.zeit || uhr(f.start)}</span>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-[8px] text-white text-[16px] font-bold tracking-[-0.5px] leading-[22px]" style={schrift}>
        <span className="truncate">{f.von || ''}</span>
        <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[18px] h-[12px] shrink-0" />
        <span className="truncate">{f.nach || ''}</span>
      </div>
      <div className="mt-[4px] text-[12px] font-medium text-white/50 truncate" style={schrift}>
        {[`${uhr(f.start)} – ${uhr(f.ende)} ${f.genau === false ? tx('geplant') : tx('gefahren')}`, f.gaeste].filter(Boolean).join(' · ')}
      </div>
    </div>
  </div>
);

// Ablehnen (roter Rand), Bearbeiten (Lime-Rand), Annehmen (Lime), zusammen 362 breit.
const StundenKnoepfe = ({ busy, ablehnen, bearbeiten, annehmen }) => {
  const knopf = 'w-[116.67px] h-[51px] flex items-center justify-center text-[20px] font-bold tracking-[-0.5px] leading-none disabled:opacity-60';
  return (
    <div className="flex gap-[6px]" style={{ marginTop: KNOPF_ABSTAND }}>
      <button type="button" disabled={busy} onClick={ablehnen} className={`${knopf} border-2`} style={{ ...schrift, color: ROT, borderColor: ROT }}><span className="font-bold">{tx('ablehnen')}</span></button>
      <button type="button" disabled={busy} onClick={bearbeiten} className={`${knopf} border-2`} style={{ ...schrift, color: LIME, borderColor: LIME }}><span className="font-bold">{tx('bearbeiten')}</span></button>
      <button type="button" disabled={busy} onClick={annehmen} className={`${knopf} text-black`} style={{ ...schrift, background: LIME }}><span className="font-bold">{tx('annehmen')}</span></button>
    </div>
  );
};

// Die Karte selbst (362 breit). Aktionen kommen von aussen (useStundenAktionen).
export function StundenKarte({ eintrag, busy = false, annehmen, bearbeiten, ablehnen }) {
  const z = eintrag.zettel;
  const v = eintrag.vorschlag || {};
  const arbeitsMin = z ? z.arbeits_min : v.arbeits_min;
  const pauseMin = z ? z.pause_min : v.pause_min;
  const status = z?.status;
  const rand = status === 'eingereicht' ? LIME : status === 'zurueckgewiesen' ? ROT : 'transparent';
  const etikett = status === 'eingereicht' ? [tx('eingereicht'), LIME]
    : status === 'zurueckgewiesen' ? [tx('zurueckgegeben'), ROT]
      : status === 'bestaetigt' ? [tx('bestaetigt'), GRUEN] : null;
  const notiz = notizText(eintrag);
  const fahrten = v.fahrten || [];
  return (
    <div className="w-[362px]">
      <div className="border-2 overflow-hidden" style={{ background: FLAECHE, borderColor: rand, height: kartenHoehe(eintrag) }}>
        <div className="px-[10px] pt-[17px]" style={{ height: KOPF - 2 }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[38px] leading-none font-bold whitespace-nowrap" style={{ ...schrift, color: LIME }}>{tx('stunden', { zeit: hmm(arbeitsMin) })}</span>
            {etikett ? <span className="text-[13px] font-bold" style={{ ...schrift, color: etikett[1] }}>{etikett[0]}</span> : null}
          </div>
          <div className="mt-[20px] text-white text-[24px] leading-none font-bold whitespace-nowrap" style={schrift}>
            {uhr(z?.beginn || v.beginn)} – {uhr(z?.ende || v.ende)}{pauseMin ? ` · ${tx('pause', { zeit: hmm(pauseMin) })}` : ''}
          </div>
        </div>
        {fahrten.length ? (
          <>
            <div className="mx-[10px] h-px bg-white/10" />
            <div className="px-[10px] pt-[14px] pb-[16px] flex flex-col" style={{ gap: ZEILEN_ABSTAND }}>
              {fahrten.map((f) => <FahrtZeile key={f.id} f={f} />)}
            </div>
          </>
        ) : null}
        {notiz ? (
          <div className="px-[10px] h-[18px] text-[13px] font-medium truncate" style={{ ...schrift, color: status === 'zurueckgewiesen' ? ROT : ORANGE }}>{notiz}</div>
        ) : null}
      </div>
      {stundenMitKnoepfen(eintrag) ? <StundenKnoepfe busy={busy} ablehnen={ablehnen} bearbeiten={bearbeiten} annehmen={annehmen} /> : null}
    </div>
  );
}

// Aktionen fuer Karten: Annehmen direkt, Bearbeiten und Ablehnen als Vollbild.
export const useStundenAktionen = (nachher) => {
  const [busyId, setBusyId] = useState(null);
  const [bearbeiten, setBearbeiten] = useState(null);
  const [ablehnen, setAblehnen] = useState(null);
  const [fehler, setFehler] = useState('');

  const ausfuehren = async (e, werte) => {
    setBusyId(e.dienst.id);
    try { await speichern(e, werte); setFehler(''); } catch (err) { setFehler(tx('fehler', { meldung: err.message })); }
    setBusyId(null);
    nachher?.();
  };
  const annehmen = (e) => {
    const v = e.vorschlag;
    if (!v?.beginn || !v?.ende) { setFehler(tx('keinVorschlag')); return; }
    ausfuehren(e, { beginn: v.beginn, ende: v.ende, pauseMin: v.pause_min || 0, angepasst: false, begruendung: null });
  };

  const ebene = (
    <>
      {bearbeiten ? (
        <StundenBearbeiten eintrag={bearbeiten} schliessen={() => setBearbeiten(null)} fertig={() => { setBearbeiten(null); nachher?.(); }} />
      ) : null}
      {ablehnen ? (
        <CancelRideSheet
          titel={tx('ablehnenTitel')}
          knopf={tx('ablehnenSenden')}
          farbe={ROT}
          onClose={() => setAblehnen(null)}
          onConfirm={(notiz) => {
            const e = ablehnen;
            setAblehnen(null);
            const b = e.vorschlag?.beginn || zuZeitpunkt(e.dienst.datum, e.dienst.beginn || '00:00');
            ausfuehren(e, { beginn: b, ende: b, pauseMin: 0, angepasst: true, begruendung: tx('abgelehnt') + (String(notiz || '').trim() || tx('ohneAngabe')) });
          }}
        />
      ) : null}
      {fehler ? (
        <button type="button" onClick={() => setFehler('')} className="fixed left-0 right-0 top-[50px] z-[120] p-3 text-black text-[13px] font-medium" style={{ ...schrift, background: ORANGE }}>{fehler}</button>
      ) : null}
    </>
  );
  return { busyId, annehmen, bearbeiten: setBearbeiten, ablehnen: setAblehnen, ebene };
};

const HALBE = Array.from({ length: 48 }, (_, i) => i * 30);
const PAUSEN = [0, ...Array.from({ length: 15 }, (_, i) => 180 + i * 30)];
const zuMin = (iso, auf = false) => {
  if (!iso) return null;
  const [h, m] = uhr(iso).split(':').map(Number);
  return (auf ? halbeAuf(h * 60 + m) : halbeAb(h * 60 + m)) % 1440;
};
const alsUhr = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const Wahl = ({ label, wert, setWert, werte, text }) => (
  <label className="flex-1 flex flex-col px-[12px] pt-[12px] pb-[12px] gap-[8px]" style={{ background: FLAECHE }}>
    <span className="text-[13px] font-bold text-white/50" style={schrift}>{label}</span>
    <select
      value={wert}
      onChange={(e) => setWert(Number(e.target.value))}
      className="bg-transparent text-white text-[22px] outline-none appearance-none"
      style={{ ...schrift, fontWeight: 700 }}
    >
      {werte.map((m) => <option key={m} value={m} style={{ color: '#000' }}>{text(m)}</option>)}
    </select>
  </label>
);

// Vollbild Bearbeiten: Beginn, Ende und Pause in halben Stunden, Notiz warum.
export function StundenBearbeiten({ eintrag, schliessen, fertig }) {
  const z = eintrag.zettel;
  const v = eintrag.vorschlag || {};
  const tag = eintrag.dienst.datum;
  const [beginn, setBeginn] = useState(() => zuMin(z?.beginn || v.beginn) ?? zuMin(zuZeitpunkt(tag, eintrag.dienst.beginn || '')) ?? 480);
  const [ende, setEnde] = useState(() => zuMin(z?.ende || v.ende, true) ?? zuMin(zuZeitpunkt(tag, eintrag.dienst.ende || ''), true) ?? 960);
  const [pause, setPause] = useState(() => pauseZaehlt(halbeAb(z?.pause_min ?? v.pause_min ?? 0)));
  const [begruendung, setBegruendung] = useState((z?.begruendung || '').replace(tx('abgelehnt'), ''));
  const [fehler, setFehler] = useState('');
  const [busy, setBusy] = useState(false);
  let dauer = ende - beginn;
  if (dauer <= 0) dauer += 1440;
  const arbeitsMin = Math.max(0, dauer - pauseZaehlt(pause));

  const senden = async () => {
    if (!begruendung.trim()) { setFehler(tx('begruendungFehlt')); return; }
    const b = zuZeitpunkt(tag, alsUhr(beginn));
    const e = zuZeitpunkt(tag, alsUhr(ende), b);
    setBusy(true); setFehler('');
    try {
      await speichern(eintrag, { beginn: b, ende: e, pauseMin: pause, angepasst: true, begruendung: begruendung.trim() });
      setBusy(false);
      fertig();
    } catch (err) {
      setBusy(false);
      setFehler(tx('fehler', { meldung: err.message }));
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black overflow-y-auto" style={{ backgroundImage: 'radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%)' }}>
      <div className="relative w-[min(402px,100vw)] mx-auto px-[20px] pt-[140px] pb-[200px]">
        <ZurueckKnopf onClick={schliessen} />
        <h1 className="text-[42px] leading-[48px] font-bold tracking-[-0.5px]" style={{ ...schrift, color: LIME }}>{tx('bearbeitenTitel')}</h1>
        <div className="mt-[8px] text-[20px] font-bold text-white/70" style={schrift}>{tagTitel(tag)}</div>

        <div className="mt-[28px] px-[12px] pt-[19px]" style={{ background: FLAECHE, height: KOPF }}>
          <div className="text-[38px] leading-none font-bold" style={{ ...schrift, color: LIME }}>{tx('stunden', { zeit: hmm(arbeitsMin) })}</div>
          <div className="mt-[20px] text-[16px] font-bold text-white/50" style={schrift}>
            {tx('vorschlag', { von: uhr(v.beginn), bis: uhr(v.ende), zeit: hmm(v.arbeits_min) })}
          </div>
        </div>

        <div className="mt-[12px] flex gap-[6px]">
          <Wahl label={tx('beginn')} wert={beginn} setWert={setBeginn} werte={HALBE} text={hmm} />
          <Wahl label={tx('ende')} wert={ende} setWert={setEnde} werte={HALBE} text={hmm} />
          <Wahl label={tx('pauseLabel')} wert={pause} setWert={setPause} werte={PAUSEN} text={(m) => `${hmm(m)} h`} />
        </div>
        <div className="mt-[8px] text-[13px] font-medium text-white/50" style={schrift}>{tx('pauseAb')}</div>

        <div className="mt-[12px] bg-white p-4 flex flex-col gap-2">
          <span className="text-[#1d1c1d] text-[16px] font-bold tracking-[0.5px]" style={schrift}>{tx('begruendung')}</span>
          <textarea
            value={begruendung}
            onChange={(e) => setBegruendung(e.target.value)}
            rows={4}
            placeholder={tx('schreiben')}
            className="text-[14px] text-[#1d1c1d] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
            style={schrift}
          />
        </div>
        {fehler ? <div className="mt-[12px] text-[14px] font-medium" style={{ ...schrift, color: ROT }}>{fehler}</div> : null}
      </div>

      <div className="fixed left-0 right-0 bottom-[40px] z-[101] pt-[24px] pb-[30px] bg-gradient-to-t from-black via-black to-transparent">
        <button type="button" disabled={busy} onClick={senden} className="mx-auto w-[362px] h-14 px-6 flex items-center justify-between disabled:opacity-60" style={{ background: LIME }}>
          <span className="text-black text-[16px] font-bold tracking-[-0.5px]" style={schrift}>{tx('senden')}</span>
          <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
        </button>
      </div>
      <TrisarFooter className="fixed bottom-0 left-0 right-0 h-10 bg-black z-[102]" />
    </div>
  );
}

export const Tageszeile = ({ datum }) => (
  <div className="flex items-center justify-between h-[32px]">
    <span className="w-[44px] h-[2px] shrink-0" style={{ background: LIME }} />
    <span className="text-[26px] font-bold tracking-[-0.5px] whitespace-nowrap" style={{ ...schrift, color: LIME }}>{tagTitel(datum)}</span>
    <span className="w-[44px] h-[2px] shrink-0" style={{ background: LIME }} />
  </div>
);
