/* eslint-disable react-refresh/only-export-components -- Karte und Lade-Hook gehoeren zusammen. */
// Stunden eines Fahrers in der Fahrer-Ansicht der Dispo, im Look der Fahrer-App
// (fahrer/.../Stunden.jsx, StundenKarte): dunkle Flaeche, "Stunden 7:30", Zeiten, Fahrten des Dienstes.
// Die Karte steht im Ablauf der Fahrer-Ansicht unter jedem Dienst (auch bestaetigte).
// Dispo-Knoepfe statt Fahrer-Knoepfe: eingereichte Stunden bestaetigen oder bearbeiten.

import { useCallback, useEffect, useState } from 'react';
import ZeitRad from '../ui/ZeitRad';
import { supabase } from '../../services/supabase';
import { DEMO_MODE } from '../../datenquelle';
import { reihenfolgeFehler } from '../../shared/zeitReihenfolge';

const LIME = '#E3F654';
const ROT = '#ff6f63';
const ORANGE = '#ffcd8a';
const GRUEN = '#8DFFAF';
const FLAECHE = '#1a1a1a';
const schrift = { fontFamily: 'Space Grotesk' };

const uhr = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '--:--');
const heuteBerlin = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const tagTitel = (iso) => {
  if (iso === heuteBerlin()) return 'Heute';
  const d = new Date(`${iso}T12:00:00`);
  return `${d.toLocaleDateString('de-DE', { weekday: 'long' })} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`.replace(/\.*$/, '.');
};

// ---- Karte wie in der Fahrer-App (fahrer/.../Stunden.jsx, HeuteStunden): Start, Pause, Ende, Summe ----
const GRUEN_FERTIG = '#59BE80';
const PAUSE_MIN = 180;
const halbeAuf = (min) => Math.ceil((min || 0) / 30) * 30;
const ms = (iso) => (iso ? new Date(iso).getTime() : null);
const LAEUFT = ['at_pickup', 'pickup', 'beim_pickup', 'in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
const pausenMin = (pausen, bis) => pausen.reduce((n, p) => {
  if (!p.bis || (p.bis - p.von) / 60000 < PAUSE_MIN) return n;
  return n + Math.max(0, (Math.min(p.bis, bis) - p.von) / 60000);
}, 0);
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const uhrMs = (t) => uhr(new Date(t).toISOString());
// HH:MM am Diensttag (Europe/Berlin) als ISO, Enden vor dem Beginn rutschen auf den Folgetag.
const zuZeitpunkt = (datum, hm, nachIso = null) => {
  if (!/^\d{1,2}:\d{2}$/.test(hm || '')) return null;
  const [h, m] = hm.split(':').map(Number);
  const mittag = new Date(`${datum}T12:00:00Z`);
  const berlin = new Date(mittag.toLocaleString('en-US', { timeZone: 'Europe/Berlin' }));
  const versatz = berlin.getTime() - new Date(mittag.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  let t = Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)), h, m) - versatz;
  if (nachIso && t <= new Date(nachIso).getTime()) t += 86400000;
  return new Date(t).toISOString();
};
// Wie heuteStand in der Fahrer-App: laufender Dienst zaehlt hoch, danach Zettel bzw. Vorschlag.
const stand = (eintrag, jetzt = Date.now()) => {
  const v = eintrag?.vorschlag || {};
  const z = eintrag?.zettel;
  const fertig = Boolean(eintrag?.vorbei) && !(v.fahrten || []).some((f) => LAEUFT.includes(String(f.status || '').toLowerCase()));
  const quelle = z && z.ende > z.beginn
    ? { beginn: z.beginn, ende: z.ende, pausen: z.pausen || [] }
    : { beginn: v.beginn_genau || v.beginn, ende: v.ende_genau || v.ende, pausen: v.pausen || [] };
  const start = ms(quelle.beginn);
  if (!start) return null;
  const ende = fertig || z ? ms(quelle.ende) : null;
  const bis = ende ?? Math.max(jetzt, start);
  const pausen = quelle.pausen.map((p) => ({ von: ms(p.von), bis: ms(p.bis) })).filter((p) => p.von && p.von <= bis).sort((a, b) => a.von - b.von);
  const genau = Math.max(0, Math.floor((bis - start) / 60000 - pausenMin(pausen, bis)));
  const arbeitsMin = z && z.ende > z.beginn ? z.arbeits_min : (fertig ? halbeAuf(genau) : genau);
  return { start, ende, fertig, pausen: pausen.map((p) => ({ ...p, laeuft: !p.bis || p.bis > bis })), arbeitsMin };
};

// Im Bearbeiten-Modus: Tipp auf eine Zeit oeffnet ein Drehrad wie bei Apple (Stunden und Minuten
// in 15-Minuten-Schritten) statt eines Textfelds.
function ZeitEingabe({ wert, setWert, groesse, farbe }) {
  const [offen, setOffen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOffen(true)}
        className="w-[70px] bg-transparent text-center font-bold p-0 border-0"
        style={{ color: farbe, fontFamily: 'Space Grotesk', fontSize: groesse, lineHeight: 1.25 }}
        aria-label="Zeit ändern"
      >
        {wert}
      </button>
      {offen ? <ZeitRad wert={wert} setWert={setWert} schliessen={() => setOffen(false)} /> : null}
    </>
  );
}
const ZeitFeld = ({ wert, setWert, klasse, farbe }) => (setWert
  ? <ZeitEingabe wert={wert} setWert={setWert} farbe={farbe} groesse={klasse.includes('22px') ? 22 : 17} />
  : <span className={klasse} style={{ color: farbe }}>{wert}</span>);

const Kasten = ({ titel, oben, unten, setOben, setUnten, grau, aktiv, entfernen }) => (
  <div className="relative flex flex-col items-center w-[78px] shrink-0">
    {entfernen ? (
      <button type="button" onClick={entfernen} aria-label="Pause entfernen" className="absolute -top-[8px] -right-[8px] z-[1] w-[24px] h-[24px] rounded-full flex items-center justify-center text-black text-[16px] font-bold leading-none" style={{ background: ROT }}>×</button>
    ) : null}
    <div className="w-[78px] h-[78px] rounded-[12px] flex flex-col items-center justify-center font-bold tracking-[-0.5px]" style={{ ...schrift, background: '#242525', boxShadow: aktiv ? `inset 0 0 0 2px ${LIME}` : 'none' }}>
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

const Knopf = ({ text, farbe, onClick, disabled }) => (
  <button type="button" disabled={disabled} onClick={onClick} className="flex-1 h-[56px] pl-[16px] pr-[10px] flex items-center justify-between disabled:opacity-60" style={{ background: farbe }}>
    <span className="text-black text-[16px] leading-[24px] tracking-[0.5px]" style={schrift}>{text}</span>
    <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[19px]" />
  </button>
);

const STATUS = {
  eingereicht: ['Fahrer hat bestätigt, bitte prüfen.', LIME],
  dispo_geaendert: ['Geändert, wartet auf den Fahrer.', ORANGE],
  bestaetigt: ['Bestätigt.', GRUEN],
  zurueckgewiesen: ['Zurückgegeben, wartet auf den Fahrer.', ROT],
};

function Karte({ eintrag, busy, bestaetigen, speichern, loeschen, ohneTitel = false }) {
  const [jetzt, setJetzt] = useState(() => Date.now());
  const [werte, setWerte] = useState(null);
  const [notiz, setNotiz] = useState('');
  const s0 = stand(eintrag, jetzt);
  const laeuft = Boolean(s0 && !s0.fertig && !eintrag.zettel);
  useEffect(() => {
    if (!laeuft) return undefined;
    const id = setInterval(() => setJetzt(Date.now()), 30000);
    return () => clearInterval(id);
  }, [laeuft]);
  if (!s0) return null;
  const z = eintrag.zettel;
  const tag = eintrag.dienst.datum;
  const alsIso = (hm, nach) => zuZeitpunkt(tag, hm, nach);
  let s = s0;
  if (werte) {
    const b = alsIso(werte.start);
    const e = alsIso(werte.ende, b);
    const p = werte.pausen.map((x) => { const von = alsIso(x.von, b); return { von: ms(von), bis: ms(alsIso(x.bis, von)) }; });
    s = { ...s0, start: ms(b), ende: ms(e), pausen: p.map((x) => ({ ...x, laeuft: false })), arbeitsMin: halbeAuf(Math.max(0, (ms(e) - ms(b)) / 60000 - pausenMin(p, ms(e)))) };
  }
  const endeAnzeige = s.ende;
  const setze = (feld) => (wert) => setWerte((w) => ({ ...w, [feld]: wert }));
  const setzePause = (i, feld) => (wert) => setWerte((w) => ({ ...w, pausen: w.pausen.map((p, j) => (j === i ? { ...p, [feld]: wert } : p)) }));
  const pauseEntfernen = (i) => setWerte((w) => ({ ...w, pausen: w.pausen.filter((_, j) => j !== i) }));
  // Neue Pause: 3 Stunden (kuerzere zaehlen als Arbeitszeit), ab der Mitte des Dienstes.
  const pauseHinzufuegen = () => setWerte((w) => {
    const b = ms(alsIso(w.start));
    const e = ms(alsIso(w.ende, alsIso(w.start)));
    const letzte = w.pausen.length ? w.pausen[w.pausen.length - 1] : null;
    // Gibt es schon eine Pause, schliesst die neue an deren Ende an, sonst Mitte des Dienstes.
    const ab = letzte ? ms(alsIso(letzte.bis, alsIso(letzte.von, alsIso(w.start)))) : (b && e ? b + Math.max(0, (e - b) / 2 - 90 * 60000) : b);
    const von = Math.round(ab / 1800000) * 1800000;
    return { ...w, pausen: [...w.pausen, { von: uhrMs(von), bis: uhrMs(von + 180 * 60000) }] };
  });
  const bearbeitenStarten = () => {
    const ende = s0.ende || jetzt;
    setWerte({ start: uhrMs(s0.start), ende: uhrMs(ende), pausen: s0.pausen.map((p) => ({ von: uhrMs(p.von), bis: uhrMs(p.bis || ende) })) });
    setNotiz('');
  };
  // Start < Pausenanfang < Pausenende < Ende (ueber Mitternacht ab Start gerechnet).
  const reihenfolge = werte ? reihenfolgeFehler(werte.start, werte.ende, werte.pausen) : '';
  const senden = async () => {
    if (reihenfolge) return;
    const b = alsIso(werte.start);
    const e = alsIso(werte.ende, b);
    const pausen = werte.pausen.map((x) => { const von = alsIso(x.von, b); return { von, bis: alsIso(x.bis, von) }; });
    const p = pausen.map((x) => ({ von: ms(x.von), bis: ms(x.bis) }));
    const pause = Math.round(pausenMin(p, ms(e)));
    const ok = await speichern({ beginn: b, ende: e, pausen, pause_min: pause, arbeits_min: halbeAuf(Math.max(0, (ms(e) - ms(b)) / 60000 - pause)), dispo_notiz: notiz.trim() || null });
    if (ok) setWerte(null);
  };
  const statusText = z ? STATUS[z.status] : (s0.fertig ? ['Fahrer hat noch nicht erfasst.', ORANGE] : ['Dienst läuft.', 'rgba(255,255,255,0.6)']);
  const rand = werte || !z ? LIME : z.status === 'bestaetigt' ? GRUEN_FERTIG : z.status === 'eingereicht' ? LIME : z.status === 'zurueckgewiesen' ? ROT : ORANGE;
  const zeit = hhmm(s.arbeitsMin);
  const dispoDran = s0.fertig || z;

  return (
    <div className="w-full flex flex-col">
      {ohneTitel ? null : <div className="mb-[8px] text-[14px] font-bold text-white/70" style={schrift}>{tagTitel(tag)}</div>}
      <div className="w-full min-h-[220px] pb-[12px] border-2 flex flex-col items-center overflow-hidden" style={{ background: FLAECHE, borderColor: rand }}>
        <div className="mt-[11px] h-[23px] text-[18px] font-bold tracking-[-0.5px] leading-[23px]" style={{ ...schrift, color: LIME }}>Stundenerfassung</div>
        <div className="mt-[13px] px-[10px] pt-[8px] flex flex-wrap justify-center gap-x-[5px] gap-y-[12px]">
          <Kasten titel="Start" oben={werte ? werte.start : uhrMs(s.start)} setOben={werte ? setze('start') : null} aktiv={Boolean(werte)} />
          {s.pausen.map((p, i) => (
            <Kasten key={i} grau titel="Pause" oben={werte ? werte.pausen[i].von : uhrMs(p.von)} unten={werte ? werte.pausen[i].bis : p.laeuft ? null : uhrMs(p.bis)} setOben={werte ? setzePause(i, 'von') : null} setUnten={werte ? setzePause(i, 'bis') : null} aktiv={Boolean(werte)} entfernen={werte ? () => pauseEntfernen(i) : null} />
          ))}
          {werte ? (
            <div className="flex flex-col items-center w-[78px] shrink-0">
              <button type="button" onClick={pauseHinzufuegen} className="w-[78px] h-[78px] rounded-[12px] border-2 border-dashed flex items-center justify-center text-[30px] font-bold" style={{ ...schrift, borderColor: LIME, color: LIME }} aria-label="Pause hinzufügen">+</button>
              <span className="mt-[8px] text-[16px] leading-[20px] font-bold tracking-[-0.5px]" style={{ ...schrift, color: LIME }}>Pause</span>
            </div>
          ) : null}
          {werte || endeAnzeige ? <Kasten titel="Ende" oben={werte ? werte.ende : uhrMs(endeAnzeige)} setOben={werte ? setze('ende') : null} aktiv={Boolean(werte)} /> : null}
        </div>
        <div className="mt-[9px] text-[35px] leading-[45px] font-bold tracking-[-0.5px]" style={{ ...schrift, color: '#e2f754' }}>{zeit}</div>
      </div>

      {/* Standby am Event-Ort an diesem Tag. */}
      {(eintrag.standby || []).map((sb) => (
        <div key={`${sb.ort}-${sb.von}`} className="mt-[8px] text-[14px] font-bold" style={{ ...schrift, color: '#868687' }}>
          Standby {sb.ort} {sb.von}–{sb.bis}
        </div>
      ))}
      {!werte ? (
        <div className="mt-[10px] text-[14px] font-bold" style={{ ...schrift, color: statusText[1] }}>
          {statusText[0]}
          {z?.angepasst && z?.begruendung ? <span className="block mt-[2px] text-white/70 font-medium">Fahrer: „{z.begruendung}“</span> : null}
          {z?.dispo_notiz && z?.status !== 'eingereicht' ? <span className="block mt-[2px] text-white/70 font-medium">Dispo: „{z.dispo_notiz}“</span> : null}
        </div>
      ) : null}

      {!werte && dispoDran && z?.status !== 'bestaetigt' ? (
        <div className="mt-[10px] flex gap-[10px]">
          <Knopf text="Bearbeiten" farbe={ROT} onClick={bearbeitenStarten} disabled={busy} />
          {z?.status === 'eingereicht' ? <Knopf text="Bestätigen" farbe={GRUEN_FERTIG} onClick={bestaetigen} disabled={busy} /> : null}
        </div>
      ) : null}

      {/* Bestaetigt: wie Ablehnen und Annehmen ein Knopfpaar, Loeschen und Bearbeiten. */}
      {!werte && z?.status === 'bestaetigt' ? (
        <div className="mt-[10px] flex gap-[10px]">
          <Knopf text="Löschen" farbe={ROT} onClick={loeschen} disabled={busy} />
          <Knopf text="Bearbeiten" farbe={LIME} onClick={bearbeitenStarten} disabled={busy} />
        </div>
      ) : null}

      {werte ? (
        <>
          <div className="mt-[8px] text-[13px] font-medium text-white/50" style={schrift}>Zeiten antippen zum Ändern, × entfernt eine Pause, + fügt eine hinzu. Pausen unter 3 Stunden zählen als Arbeitszeit. Der Fahrer muss die Änderung bestätigen.</div>
          <textarea value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz an den Fahrer (optional)" className="mt-[12px] w-full h-[80px] bg-white p-3 text-[14px] text-black outline-none resize-none" style={schrift} />
          {reihenfolge ? <div className="mt-[10px] text-[13px] font-bold" style={{ ...schrift, color: ROT }}>{reihenfolge}</div> : null}
          <button type="button" disabled={busy || Boolean(reihenfolge)} onClick={senden} className="mt-[12px] w-full h-[56px] px-6 flex items-center justify-between disabled:opacity-50" style={{ background: LIME }}>
            <span className="text-black text-[16px] font-bold tracking-[-0.5px]" style={schrift}>An Fahrer senden</span>
            <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
          </button>
          <button type="button" onClick={() => setWerte(null)} className="mt-[12px] self-center text-[14px] font-bold text-white/60" style={schrift}>Abbrechen</button>
        </>
      ) : null}

      {!werte && z && z.status !== 'bestaetigt' ? (
        <button type="button" disabled={busy} onClick={loeschen} className="mt-[10px] w-full h-[40px] border text-[14px] font-bold disabled:opacity-60" style={{ ...schrift, color: ROT, borderColor: 'rgba(255,111,99,0.6)' }}>
          Erfasste Stunden löschen
        </button>
      ) : null}
    </div>
  );
}

// Stunden eines Fahrers fuer die Dispo laden und bearbeiten. Die Karten selbst stehen im Ablauf
// der Fahrer-Ansicht (FahrerAnsichtView) unter jedem Dienst, wie im Verlauf der Fahrer-App.
// tage: wie weit zurueck (Standard 14).
export function useDispoStunden(fahrerId, tage = 14) {
  const [eintraege, setEintraege] = useState(null);
  const [zaehler, setZaehler] = useState(0);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let aktiv = true;
    if (DEMO_MODE || !fahrerId) { Promise.resolve().then(() => { if (aktiv) setEintraege([]); }); return () => { aktiv = false; }; }
    supabase.rpc('stunden_verlauf', { p_driver: fahrerId, p_tage: tage }).then(({ data, error }) => {
      if (aktiv) setEintraege(error ? [] : data || []);
    });
    return () => { aktiv = false; };
  }, [fahrerId, tage, zaehler]);

  const neuLaden = useCallback(() => setZaehler((n) => n + 1), []);

  const bestaetigen = useCallback(async (e) => {
    setBusyId(e.dienst.id);
    const { data: nutzer } = await supabase.auth.getUser();
    const jetzt = new Date().toISOString();
    await supabase.from('stundenzettel').update({
      status: 'bestaetigt', geprueft_von: nutzer?.user?.id || null, geprueft_am: jetzt, aktualisiert: jetzt,
    }).eq('id', e.zettel.id);
    setBusyId(null);
    setZaehler((n) => n + 1);
  }, []);

  // Dispo bearbeitet: Zeiten speichern, Fahrer muss zustimmen (Stand dispo_geaendert).
  const speichern = useCallback(async (e, w) => {
    setBusyId(e.dienst.id);
    const jetzt = new Date().toISOString();
    const zeile = { ...w, status: 'dispo_geaendert', aktualisiert: jetzt };
    const { error } = e.zettel
      ? await supabase.from('stundenzettel').update(zeile).eq('id', e.zettel.id)
      : await supabase.from('stundenzettel').insert({
        ...zeile, driver_id: fahrerId, dienst_id: e.dienst.id, datum: e.dienst.datum, vorschlag: e.vorschlag || null, eingereicht_am: jetzt,
      });
    setBusyId(null);
    if (error) { window.alert(`Speichern fehlgeschlagen: ${error.message}`); return false; }
    setZaehler((n) => n + 1);
    return true;
  }, [fahrerId]);

  const loeschen = useCallback(async (e) => {
    if (!window.confirm(`Erfasste Stunden vom ${tagTitel(e.dienst.datum)} löschen? Der Fahrer kann danach neu erfassen.`)) return;
    setBusyId(e.dienst.id);
    const { error } = await supabase.from('stundenzettel').delete().eq('id', e.zettel.id);
    setBusyId(null);
    if (error) window.alert(`Löschen fehlgeschlagen: ${error.message}`);
    setZaehler((n) => n + 1);
  }, []);

  return { eintraege, neuLaden, busyId, bestaetigen, speichern, loeschen };
}

// Stundenkarte eines Dienstes. Ohne Tagestitel, der steht im Ablauf schon als Tagestrenner.
export function StundenKarte({ eintrag, stunden }) {
  return (
    <Karte
      eintrag={eintrag}
      ohneTitel
      busy={stunden.busyId === eintrag.dienst.id}
      bestaetigen={() => stunden.bestaetigen(eintrag)}
      speichern={(w) => stunden.speichern(eintrag, w)}
      loeschen={() => stunden.loeschen(eintrag)}
    />
  );
}

// Hat der Dienst schon eine Stundenkarte? Vorbei, oder heute und laeuft schon.
export const hatStundenKarte = (e) => Boolean(e?.dienst) && (e.vorbei || (e.dienst.datum === heuteBerlin() && Boolean(e.vorschlag?.beginn)));
