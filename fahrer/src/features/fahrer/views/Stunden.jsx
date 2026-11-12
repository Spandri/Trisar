/* eslint-disable react-refresh/only-export-components -- Karte, Hoehen und Hooks gehoeren zusammen (Raster der Fahrtenliste). */
// Stundenerfassung fuer den Fahrer: eine Karte am Ende jedes Diensttages, gebaut wie die
// Dienstkarte (dunkle Flaeche, grosse Zeiten), darin die Fahrten des Dienstes. Darunter
// Ablehnen, Bearbeiten, Annehmen wie bei Diensten und Fahrten. Zeiten in halben Stunden.
// Daten: Datenbank-Funktion stunden_verlauf() und Tabelle stundenzettel (gleich in iOS und Android).
// Der Verlauf (Profil -> Verlauf) steht in Verlauf.jsx und nutzt Karte, Hook und Tageszeile von hier.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  // Vorbei und noch nicht von der Dispo bestaetigt, dazu der laufende Dienst von heute (Figma 2823-12431).
  const karten = useMemo(() => (eintraege || []).filter((e) => (e.vorbei && e.zettel?.status !== 'bestaetigt')
    || (!e.vorbei && e.dienst?.datum === heuteBerlin() && heuteStand(e))), [eintraege]);
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
export const stundenMitKnoepfen = (e) => Boolean(e.vorbei && (!e.zettel || e.zettel.status === 'zurueckgewiesen' || e.zettel.status === 'dispo_geaendert'));
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
  const rand = status === 'eingereicht' ? LIME : status === 'zurueckgewiesen' ? ROT : status === 'dispo_geaendert' ? ORANGE : 'transparent';
  const etikett = status === 'eingereicht' ? [tx('eingereicht'), LIME]
    : status === 'dispo_geaendert' ? ['Von Dispo geändert', ORANGE]
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
  const annehmen = async (e) => {
    if (e.zettel?.status === 'dispo_geaendert') {
      setBusyId(e.dienst.id);
      try { await dispoAenderungAnnehmen(e.zettel); setFehler(''); } catch (err) { setFehler(tx('fehler', { meldung: err.message })); }
      setBusyId(null);
      nachher?.();
      return;
    }
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

// Heute: Start, begonnene Pausen und (nach Dienstende) Ende als Kaesten, mittig. Darunter die
// Arbeitszeit, die bis zum Ende jede Minute hochlaeuft. Pausen unter 3 Stunden sind Arbeitszeit.
export const heuteBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const ms = (iso) => (iso ? new Date(iso).getTime() : null);
// Fahrt laeuft gerade (gestartet, noch nicht erledigt). Solange endet der Tag nicht.
const LAEUFT = ['at_pickup', 'pickup', 'beim_pickup', 'in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
// Geplante Pause ab 3 Stunden haelt die Zeit an (auch waehrend sie laeuft), kuerzere sind Arbeitszeit.
const pausenMin = (pausen, bis) => pausen.reduce((s, p) => {
  if (!p.bis || (p.bis - p.von) / 60000 < PAUSE_MIN) return s;
  return s + Math.max(0, (Math.min(p.bis, bis) - p.von) / 60000);
}, 0);
// Fertig: Dienstende erreicht und keine Fahrt mehr unterwegs (Ende = Dienstende oder letzte Fahrt).
// Danach zeigt die Karte, was eingereicht wird bzw. wurde (Zettel), Arbeitszeit auf halbe Stunden auf.
export const heuteStand = (eintrag, jetzt = Date.now()) => {
  const v = eintrag?.vorschlag || {};
  const z = eintrag?.zettel;
  const fertig = Boolean(eintrag?.vorbei) && !(v.fahrten || []).some((f) => LAEUFT.includes(String(f.status || '').toLowerCase()));
  const quelle = fertig && z && z.ende > z.beginn
    ? { beginn: z.beginn, ende: z.ende, pausen: z.pausen || [] }
    : { beginn: v.beginn_genau || v.beginn, ende: v.ende_genau || v.ende, pausen: v.pausen || [] };
  const start = ms(quelle.beginn);
  if (!start || start > jetzt) return null;
  const ende = fertig ? ms(quelle.ende) : null;
  const bis = ende ?? jetzt;
  const pausen = quelle.pausen
    .map((p) => ({ von: ms(p.von), bis: ms(p.bis) }))
    .filter((p) => p.von && p.von <= bis)
    .sort((a, b) => a.von - b.von);
  const genau = Math.max(0, Math.floor((bis - start) / 60000 - pausenMin(pausen, bis)));
  const arbeitsMin = !fertig ? genau : z && z.ende > z.beginn ? z.arbeits_min : halbeAuf(genau);
  return { start, ende, fertig, pausen: pausen.map((p) => ({ ...p, laeuft: !p.bis || p.bis > bis })), arbeitsMin };
};
const uhrMs = (t) => uhr(new Date(t).toISOString());
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

// Ziffer, die beim Wechsel von unten nach oben rollt (wie im Entwurf 08:45 -> 08:46).
const RollZiffer = ({ z }) => {
  const [{ alt, jetzt, rollt }, setStand] = useState({ alt: z, jetzt: z, rollt: true });
  const vorher = useRef(z);
  useEffect(() => {
    if (vorher.current === z) return undefined;
    setStand({ alt: vorher.current, jetzt: z, rollt: false });
    vorher.current = z;
    let r2;
    const r = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setStand((s) => ({ ...s, rollt: true }))); });
    return () => { cancelAnimationFrame(r); cancelAnimationFrame(r2); };
  }, [z]);
  const zeile = { height: 45, lineHeight: '45px', display: 'block', textAlign: 'center' };
  return (
    <span className="relative inline-block overflow-hidden align-top" style={{ height: 45 }}>
      <span
        className="flex flex-col"
        style={{ transform: rollt || alt === jetzt ? 'translateY(-45px)' : 'translateY(0)', transition: rollt ? 'transform 450ms cubic-bezier(.2,.8,.2,1)' : 'none' }}
      >
        <span style={zeile}>{alt}</span>
        <span style={zeile}>{jetzt}</span>
      </span>
    </span>
  );
};

const Kasten = ({ titel, oben, unten, grau }) => (
  <div className="flex flex-col items-center w-[78px] shrink-0">
    <div className="w-[78px] h-[78px] rounded-[12px] flex flex-col items-center justify-center font-bold tracking-[-0.5px]" style={{ ...schrift, background: '#242525' }}>
      {grau ? (
        <>
          <span className="text-[17px] leading-[24.5px]" style={{ color: '#5f5f5f' }}>{oben}</span>
          {unten ? <span className="mt-[4.5px] text-[17px] leading-[24.5px]" style={{ color: '#5f5f5f' }}>{unten}</span> : null}
        </>
      ) : <span className="text-[22px] leading-[28px]" style={{ color: '#e2f754' }}>{oben}</span>}
    </div>
    <span className="mt-[8px] text-[16px] leading-[20px] font-bold tracking-[-0.5px]" style={{ ...schrift, color: grau ? '#5f5f5f' : '#fff' }}>{titel}</span>
  </div>
);

// Zeitfeld im Kasten: im Bearbeiten-Modus antippbar (Uhrzeit-Auswahl des Geraets), sonst Text.
const ZeitFeld = ({ wert, setWert, klasse, farbe }) => (
  <span className={`relative ${klasse}`} style={{ color: farbe }}>
    {wert}
    {setWert ? (
      <input
        type="time"
        value={wert}
        onChange={(e) => e.target.value && setWert(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        aria-label="Zeit ändern"
      />
    ) : null}
  </span>
);

const BearbeitbarerKasten = ({ titel, oben, unten, setOben, setUnten, grau, aktiv }) => (
  <div className="flex flex-col items-center w-[78px] shrink-0">
    <div
      className="w-[78px] h-[78px] rounded-[12px] flex flex-col items-center justify-center font-bold tracking-[-0.5px]"
      style={{ ...schrift, background: '#242525', boxShadow: aktiv ? `inset 0 0 0 2px ${LIME}` : 'none' }}
    >
      {grau ? (
        <>
          <ZeitFeld wert={oben} setWert={setOben} klasse="text-[17px] leading-[24.5px]" farbe={aktiv ? '#fff' : '#5f5f5f'} />
          {unten ? <ZeitFeld wert={unten} setWert={setUnten} klasse="mt-[4.5px] text-[17px] leading-[24.5px]" farbe={aktiv ? '#fff' : '#5f5f5f'} /> : null}
        </>
      ) : <ZeitFeld wert={oben} setWert={setOben} klasse="text-[22px] leading-[28px]" farbe="#e2f754" />}
    </div>
    <span className="mt-[8px] text-[16px] leading-[20px] font-bold tracking-[-0.5px]" style={{ ...schrift, color: grau ? '#5f5f5f' : '#fff' }}>{titel}</span>
  </div>
);

// Knopf 176 x 56 wie im Entwurf 2838-12842: Text links, schwarzer Pfeil rechts.
const HeuteKnopf = ({ text, farbe, onClick, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`w-[176px] h-[56px] pl-[16px] pr-[10px] flex items-center justify-between disabled:opacity-60`}
    style={{ background: farbe }}
  >
    <span className="text-black text-[16px] leading-[24px] tracking-[0.5px]" style={schrift}>{text}</span>
    <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[19px]" />
  </button>
);

const GRUEN_FERTIG = '#59BE80';
const ROT_KNOPF = '#FF6F63';

// Speichert die Zeiten von heute (Bestaetigen: so wie gezeigt, Bearbeiten: mit Notiz).
// Pausen ab 3 Stunden zaehlen, Arbeitszeit auf halbe Stunden auf (zugunsten des Fahrers).
const heuteSpeichern = async (eintrag, { beginn, ende, pausen, angepasst, begruendung }) => {
  const fahrer = (await supabase.auth.getUser()).data?.user?.id;
  const jetzt = new Date().toISOString();
  const b = ms(beginn);
  const e = ms(ende);
  const p = pausen.map((x) => ({ von: ms(x.von), bis: ms(x.bis) }));
  const pause = Math.round(pausenMin(p, e));
  const arbeits = halbeAuf(Math.max(0, (e - b) / 60000 - pause));
  const zeile = {
    driver_id: fahrer,
    dienst_id: eintrag.dienst.id,
    datum: eintrag.dienst.datum,
    beginn,
    ende,
    pausen: pausen.map((x) => ({ von: x.von, bis: x.bis })),
    pause_min: pause,
    arbeits_min: arbeits,
    vorschlag: eintrag.vorschlag || null,
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

const STATUS_TEXT = {
  eingereicht: ['Anfrage gesendet, Dispo prüft.', LIME],
  bestaetigt: ['Von der Dispo bestätigt.', GRUEN],
  zurueckgewiesen: ['Von der Dispo zurückgegeben', ROT],
  dispo_geaendert: ['Dispo hat die Zeiten geändert, bitte bestätigen.', ORANGE],
};

// Fahrer ist dran: noch nicht erfasst, von der Dispo zurueckgegeben (alt) oder von der Dispo geaendert.
const fahrerDran = (z) => !z || z.status === 'zurueckgewiesen' || z.status === 'dispo_geaendert';
// Aenderung der Dispo annehmen: Stunden sind dann fertig (beide einig).
const dispoAenderungAnnehmen = async (z) => {
  const { error } = await supabase.rpc('stunden_fahrer_zustimmen', { p_zettel: z.id });
  if (error) throw error;
};

// Karte 362 x 220 (Figma 2837-12573), immer mittig. Nach Dienstende bzw. letzter Fahrt (Figma 2838-12842)
// gruener Rand mit Bearbeiten und Bestaetigen. Bearbeiten macht die Zeiten antippbar, dazu Notiz und Senden.
// Hoehe der Karte im Raster der Fahrtenliste: Karte 220, Statuszeile 10 + 20, Knoepfe 10 + 56.
export const heuteKartenHoehe = (eintrag) => {
  const s = heuteStand(eintrag);
  if (!s) return 0;
  const z = eintrag.zettel;
  const offen = s.fertig && fahrerDran(z);
  // Standby am Event-Ort: je Standby eine Zeile "Standby BMW Welt 18:00–23:00" unter der Karte.
  return 220 + (s.fertig && z ? 30 : 0) + (offen ? 66 : 0) + (eintrag.standby || []).length * 26;
};

// vollbild: Bearbeiten oeffnet sich ueber dem ganzen Bildschirm (Fahrtenliste mit festem Raster),
// sonst klappt es unter der Karte auf (Verlauf).
export function HeuteStunden({ eintrag, nachher, vollbild = false }) {
  const [jetzt, setJetzt] = useState(() => Date.now());
  const [werte, setWerte] = useState(null); // im Bearbeiten-Modus: { start, ende, pausen: [{von, bis}] } als HH:MM
  const [notiz, setNotiz] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState('');
  const s0 = heuteStand(eintrag, jetzt);
  const fertig = Boolean(s0?.fertig);
  useEffect(() => {
    if (fertig) return undefined;
    const id = setInterval(() => setJetzt(Date.now()), 1000);
    return () => clearInterval(id);
  }, [fertig]);
  if (!s0) return null;

  const z = eintrag.zettel;
  const offen = fertig && fahrerDran(z);
  const tag = eintrag.dienst.datum;
  const alsIso = (hm, nach) => zuZeitpunkt(tag, hm, nach);
  // Im Bearbeiten-Modus aus den Eingaben rechnen, sonst aus dem Stand.
  let s = s0;
  if (werte) {
    const b = alsIso(werte.start);
    const e = alsIso(werte.ende, b);
    const p = werte.pausen.map((x) => { const von = alsIso(x.von, b); return { von: ms(von), bis: ms(alsIso(x.bis, von)) }; });
    s = { ...s0, start: ms(b), ende: ms(e), pausen: p.map((x) => ({ ...x, laeuft: false })), arbeitsMin: halbeAuf(Math.max(0, (ms(e) - ms(b)) / 60000 - pausenMin(p, ms(e)))) };
  }
  const zeit = hhmm(s.arbeitsMin);
  const zuHm = (t) => uhrMs(t);

  const bearbeitenStarten = () => {
    setWerte({ start: zuHm(s0.start), ende: zuHm(s0.ende), pausen: s0.pausen.map((p) => ({ von: zuHm(p.von), bis: zuHm(p.bis || s0.ende) })) });
    setNotiz('');
    setFehler('');
  };
  const ausfuehrenMit = async (aktion) => {
    setBusy(true); setFehler('');
    try {
      await aktion();
      setWerte(null);
      nachher?.();
    } catch (err) {
      setFehler(tx('fehler', { meldung: err.message }));
    }
    setBusy(false);
  };
  const ausfuehren = async (werteNeu) => {
    setBusy(true); setFehler('');
    try {
      await heuteSpeichern(eintrag, werteNeu);
      setWerte(null);
      nachher?.();
    } catch (err) {
      setFehler(tx('fehler', { meldung: err.message }));
    }
    setBusy(false);
  };
  const bestaetigen = () => (z?.status === 'dispo_geaendert' ? ausfuehrenMit(() => dispoAenderungAnnehmen(z)) : ausfuehren({
    beginn: new Date(s0.start).toISOString(),
    ende: new Date(s0.ende).toISOString(),
    pausen: s0.pausen.map((p) => ({ von: new Date(p.von).toISOString(), bis: new Date(p.bis || s0.ende).toISOString() })),
    angepasst: false,
  }));
  const senden = () => {
    if (!notiz.trim()) { setFehler(tx('begruendungFehlt')); return; }
    const b = alsIso(werte.start);
    ausfuehren({
      beginn: b,
      ende: alsIso(werte.ende, b),
      pausen: werte.pausen.map((x) => { const von = alsIso(x.von, b); return { von, bis: alsIso(x.bis, von) }; }),
      angepasst: true,
      begruendung: notiz.trim(),
    });
  };
  const setze = (feld) => (wert) => setWerte((w) => ({ ...w, [feld]: wert }));
  const setzePause = (i, feld) => (wert) => setWerte((w) => ({ ...w, pausen: w.pausen.map((p, j) => (j === i ? { ...p, [feld]: wert } : p)) }));
  const status = fertig && z ? STATUS_TEXT[z.status] : null;
  // Lime bis bestaetigt bzw. gesendet, dann gruen. Von der Dispo zurueckgegeben: rot.
  const rand = !fertig || werte || !z ? LIME : z.status === 'zurueckgewiesen' ? ROT : z.status === 'dispo_geaendert' ? ORANGE : GRUEN_FERTIG;

  const karte = (
    <div className="w-[362px] flex flex-col">
      <div className="w-[362px] h-[220px] border-2 flex flex-col items-center overflow-hidden" style={{ background: FLAECHE, borderColor: rand }}>
        <div className="mt-[11px] h-[23px] text-[18px] font-bold tracking-[-0.5px] leading-[23px]" style={{ ...schrift, color: LIME }}>Stundenerfassung</div>
        <div className="mt-[13px] flex justify-center gap-[5px]">
          <BearbeitbarerKasten titel="Start" oben={werte ? werte.start : zuHm(s.start)} setOben={werte ? setze('start') : null} aktiv={Boolean(werte)} />
          {s.pausen.map((p, i) => (
            <BearbeitbarerKasten
              key={i}
              grau
              titel="Pause"
              oben={werte ? werte.pausen[i].von : zuHm(p.von)}
              unten={werte ? werte.pausen[i].bis : p.laeuft ? null : zuHm(p.bis)}
              setOben={werte ? setzePause(i, 'von') : null}
              setUnten={werte ? setzePause(i, 'bis') : null}
              aktiv={Boolean(werte)}
            />
          ))}
          {s.ende ? <BearbeitbarerKasten titel="Ende" oben={werte ? werte.ende : zuHm(s.ende)} setOben={werte ? setze('ende') : null} aktiv={Boolean(werte)} /> : null}
        </div>
        <div className="mt-[9px] flex text-[35px] font-bold tracking-[-0.5px]" style={{ ...schrift, color: '#e2f754' }}>
          {zeit.split('').map((c, i) => (c === ':' ? <span key={i} style={{ lineHeight: '45px' }}>:</span> : <RollZiffer key={i} z={c} />))}
        </div>
      </div>

      {(eintrag.standby || []).map((sb) => (
        <div key={`${sb.ort}-${sb.von}`} className="mt-[6px] h-[20px] leading-[20px] text-[14px] font-bold truncate" style={{ ...schrift, color: '#868687' }}>
          Standby {sb.ort} {sb.von}–{sb.bis}
        </div>
      ))}

      {status ? (
        <div className="mt-[10px] h-[20px] leading-[20px] text-[14px] font-bold truncate" style={{ ...schrift, color: status[1] }}>
          {status[0]}{z.status === 'zurueckgewiesen' && z.dispo_notiz ? `: ${z.dispo_notiz}` : ''}
        </div>
      ) : null}

      {offen && !werte ? (
        <div className="mt-[10px] flex justify-between">
          <HeuteKnopf text="Bearbeiten" farbe={ROT_KNOPF} onClick={bearbeitenStarten} disabled={busy} />
          <HeuteKnopf text="Bestätigen" farbe={GRUEN_FERTIG} onClick={bestaetigen} disabled={busy} />
        </div>
      ) : null}

      {werte ? (
        <>
          <div className="mt-[8px] text-[13px] font-medium text-white/50" style={schrift}>Zeiten antippen zum Ändern. {tx('pauseAb')}</div>
          {/* Notiz wie beim Stornieren (CancelRideSheet): dunkle Flaeche ueber die volle Breite, weisses Feld 362. */}
          <div className="mt-[16px] -mx-[20px] w-[402px] h-[224px] bg-[#1a1a1a] rounded-[12px] p-[20px]">
            <div className="h-full bg-white overflow-hidden p-4 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[#1d1c1d] text-[16px] font-bold tracking-[0.5px]" style={schrift}>Notizen</h3>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M4.16667 15.8333H5.35417L13.5 7.6875L12.3125 6.5L4.16667 14.6458V15.8333ZM2.5 17.5V13.9583L13.5 2.97917C13.6667 2.82639 13.8507 2.70833 14.0521 2.625C14.2535 2.54167 14.4653 2.5 14.6875 2.5C14.9097 2.5 15.125 2.54167 15.3333 2.625C15.5417 2.70833 15.7222 2.83333 15.875 3L17.0208 4.16667C17.1875 4.31944 17.309 4.5 17.3854 4.70833C17.4618 4.91667 17.5 5.125 17.5 5.33333C17.5 5.55556 17.4618 5.76736 17.3854 5.96875C17.309 6.17014 17.1875 6.35417 17.0208 6.52083L6.04167 17.5H2.5ZM12.8958 7.10417L12.3125 6.5L13.5 7.6875L12.8958 7.10417Z" fill="#1D1C1D" />
                </svg>
              </div>
              <textarea
                value={notiz}
                onChange={(e) => setNotiz(e.target.value)}
                placeholder={tx('schreiben')}
                className="flex-1 text-[14px] text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
                style={schrift}
              />
            </div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={senden}
            className="mt-[20px] w-[362px] h-[56px] px-6 flex items-center justify-between disabled:opacity-60"
            style={{ background: LIME }}
          >
            <span className="text-black text-[16px] font-bold tracking-[-0.5px]" style={schrift}>Anfrage senden</span>
            <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
          </button>
          <button type="button" onClick={() => { setWerte(null); setFehler(''); }} className="mt-[12px] self-center text-[14px] font-bold text-white/60" style={schrift}>Abbrechen</button>
        </>
      ) : null}
      {fehler && (werte || !vollbild) ? <div className="mt-[10px] text-[14px] font-medium" style={{ ...schrift, color: ROT }}>{fehler}</div> : null}
    </div>
  );

  if (!vollbild) return karte;
  return (
    <>
      {werte ? <div style={{ height: heuteKartenHoehe(eintrag) }} /> : karte}
      {werte ? createPortal(
        <div className="fixed inset-0 z-[100] overflow-y-auto" style={{ backgroundImage: 'radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%)', backgroundColor: '#000' }}>
          <div className="w-[min(402px,100vw)] mx-auto px-[20px] pt-[60px] pb-[120px]">
            <h1 className="mb-[24px] text-[42px] leading-[48px] font-bold tracking-[-0.5px]" style={{ ...schrift, color: LIME }}>{tx('bearbeitenTitel')}</h1>
            {karte}
          </div>
        </div>,
        document.body,
      ) : null}
      {/* Fehler beim Bestaetigen direkt auf der Liste: oben einblenden statt die Karte zu verlaengern. */}
      {fehler && !werte ? createPortal(
        <button type="button" onClick={() => setFehler('')} className="fixed left-0 right-0 top-[50px] z-[120] p-3 text-black text-[13px] font-medium" style={{ ...schrift, background: ORANGE }}>{fehler}</button>,
        document.body,
      ) : null}
    </>
  );
}

export const Tageszeile = ({ datum }) => (
  <div className="flex items-center justify-between h-[32px]">
    <span className="w-[44px] h-[2px] shrink-0" style={{ background: LIME }} />
    <span className="text-[26px] font-bold tracking-[-0.5px] whitespace-nowrap" style={{ ...schrift, color: LIME }}>{tagTitel(datum)}</span>
    <span className="w-[44px] h-[2px] shrink-0" style={{ background: LIME }} />
  </div>
);
