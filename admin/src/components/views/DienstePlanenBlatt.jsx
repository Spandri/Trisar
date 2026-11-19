// "Dienste planen" in der Fahrerliste: Dienstzeit fuer die ausgewaehlten Fahrer
// setzen. Gestaltung wie die Stundenerfassung der Fahrer-App (Figma 2838:12842):
// dunkle Karte mit gruenem Rand, vier Kacheln Start | Pause | Pause | Ende,
// darunter die Dauer gross in Lime, unten Rot (Abbrechen) und Gruen (Senden).
// Dienststart und Dienstende sind unabhaengig: was leer bleibt, wird nicht gesendet.
// Eine Kachel antippen oeffnet das Drehrad wie in der Stundenerfassung (15-Minuten-Schritte).
// Die Tutorial-Markierungen (dienste-sheet, dienst-vorlagen, dienst-vorlage-*,
// dienst-abbrechen, dienst-anwenden) bleiben wie bisher.
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../services/supabase';
import ZeitRad from '../ui/ZeitRad';
import { dienstBestandLaden, pausenText } from '../../shared/dienstBestand';
import { reihenfolgeFehler } from '../../shared/zeitReihenfolge';
import OrtVorschlag from '../ui/OrtVorschlag';
import { orteZurEingabe, ortIconUrl, useOrte } from '../../shared/orte';
import { treffpunktSchluessel } from '../../shared/dienstTreffpunkt';

const LIME = '#E3F654';
const GRUEN = '#59BE80';
const ROT = '#FF6F63';
const KACHEL = '#242525';
const GRAU = '#5F5F5F';
const SCHRITT_MIN = 15;

const zuMinuten = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const zuUhrzeit = (min) => {
  const tag = 24 * 60;
  const x = ((min % tag) + tag) % tag;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
// Spanne ueber Mitternacht gerechnet (Nachtdienst 22–06 = 8 h).
const spanne = (von, bis) => {
  const a = zuMinuten(von);
  const b = zuMinuten(bis);
  if (a == null || b == null) return 0;
  return ((b - a) + 24 * 60) % (24 * 60) || 24 * 60;
};
// Netto-Dienstzeit als HH:MM wie in der Stundenerfassung (Pausen abgezogen).
const nettoText = (start, ende, pausen) => {
  const brutto = spanne(start, ende);
  const pause = (pausen || []).reduce((summe, p) => summe + (p.von && p.bis ? spanne(p.von, p.bis) : 0), 0);
  const netto = Math.max(0, brutto - pause);
  return `${String(Math.floor(netto / 60)).padStart(2, '0')}:${String(netto % 60).padStart(2, '0')}`;
};

const heuteIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
// "Heute", "Morgen", sonst "Mi 12.11."
const tagText = (iso) => {
  const heute = heuteIso();
  const d = new Date(`${iso}T12:00:00`);
  const morgen = new Date(); morgen.setDate(morgen.getDate() + 1);
  const morgenIso = `${morgen.getFullYear()}-${String(morgen.getMonth() + 1).padStart(2, '0')}-${String(morgen.getDate()).padStart(2, '0')}`;
  const datum = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  if (iso === heute) return `Heute ${datum}`;
  if (iso === morgenIso) return `Morgen ${datum}`;
  return `${d.toLocaleDateString('de-DE', { weekday: 'short' })} ${datum}`;
};

function Pfeil() {
  return <img src="/icon/_Icon_Schwarz/Pfeil_Knopf_Figma.svg" alt="" className="w-[34px] h-[19px] rotate-180" />;
}

// Kleines rotes × oben rechts wie in der Stundenerfassung: setzt die Kachel zurueck.
function Entfernen({ onClick, titel }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={titel}
      className="absolute -top-[8px] -right-[8px] z-[1] w-[24px] h-[24px] rounded-full flex items-center justify-center text-black text-[16px] font-bold leading-none"
      style={{ background: ROT }}
    >
      ×
    </button>
  );
}

// Kachel fuer Start oder Ende: eine Zeit gross in Lime, leer grau. Gesetzt mit × zum Zuruecksetzen.
function ZeitKachel({ wert, aktiv, onTippen, onEntfernen, marker }) {
  return (
    <div className="relative">
    {wert && onEntfernen ? <Entfernen onClick={onEntfernen} titel="Zeit zurücksetzen" /> : null}
    <button
      type="button"
      onClick={onTippen}
      data-tutorial={marker}
      className="w-full h-[69px] rounded-[12px] flex items-center justify-center"
      style={{ background: KACHEL, outline: aktiv ? `2px solid ${LIME}` : 'none', outlineOffset: '-2px' }}
    >
      <span className="text-[22px] font-bold tracking-[-0.5px] tabular-nums whitespace-nowrap" style={{ color: wert ? LIME : GRAU }}>
        {wert || '--:--'}
      </span>
    </button>
    </div>
  );
}

// Kachel fuer eine Pause: von oben, bis unten, grau. Leer ein Plus.
function PausenKachel({ pause, aktivFeld, onTippen, onEntfernen }) {
  const rahmen = aktivFeld ? `2px solid ${LIME}` : 'none';
  if (!pause) {
    // Wie in der Stundenerfassung: gestrichelter Rahmen mit Plus.
    return (
      <button
        type="button"
        onClick={() => onTippen('neu')}
        className="w-full h-[69px] rounded-[12px] border-2 border-dashed flex items-center justify-center text-[28px] font-bold"
        style={{ borderColor: LIME, color: LIME }}
        aria-label="Pause hinzufügen"
      >
        +
      </button>
    );
  }
  const zeile = (feld) => (
    <button
      type="button"
      onClick={() => onTippen(feld)}
      className="w-full whitespace-nowrap text-[17px] font-bold tracking-[-0.5px] leading-[22px] tabular-nums"
      style={{ color: aktivFeld === feld ? LIME : GRAU }}
    >
      {pause[feld]}
    </button>
  );
  return (
    <div
      className="relative w-full h-[69px] rounded-[12px] flex flex-col items-center justify-center"
      style={{ background: KACHEL, outline: rahmen, outlineOffset: '-2px' }}
    >
      {onEntfernen ? <Entfernen onClick={onEntfernen} titel="Pause entfernen" /> : null}
      {zeile('von')}
      {zeile('bis')}
    </div>
  );
}

// Zustand eines vorausgefuellten Feldes: 'neu' (geaendert), 'bestaetigt' oder 'angefragt'.
const feldZustand = (bestand, feld, wert) => {
  if (!bestand) return null;
  const gleich = feld === 'pausen' ? pausenText(wert) === pausenText(bestand.pausen) : (wert || '') === (bestand[feld] || '');
  if (!gleich) return 'neu';
  if (!wert || (feld === 'pausen' && !wert.length)) return null;
  if (bestand.angenommen) return 'bestaetigt';
  if (bestand.vorher) {
    const alt = feld === 'pausen' ? pausenText(bestand.vorher.pausen) === pausenText(wert) : (bestand.vorher[feld] || '') === (wert || '');
    return alt ? 'bestaetigt' : 'angefragt';
  }
  return 'angefragt';
};
const ZUSTAND_TEXT = { neu: ['Neu', LIME], bestaetigt: ['Bestätigt', GRUEN], angefragt: ['Angefragt', '#FFCD8A'] };
function ZustandZeile({ zustand }) {
  if (!zustand) return null;
  const [text, farbe] = ZUSTAND_TEXT[zustand];
  return <span className="block text-center text-[11px] font-bold leading-[13px]" style={{ color: farbe }}>{text}</span>;
}

// Monatskalender fuer "+ Tag": auch Tage in der Vergangenheit. Tage, an denen die ausgewaehlten
// Fahrer schon einen Dienst haben (angefragt oder angenommen), tragen einen Lime-Punkt.
// Tippen waehlt einen Tag aus oder ab.
const isoVon = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function DienstKalender({ gewaehlt, umschalten, fahrerIds }) {
  const [monat, setMonat] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [belegt, setBelegt] = useState(new Set());
  const ids = (fahrerIds || []).join(',');
  useEffect(() => {
    let aktiv = true;
    if (!ids) { Promise.resolve().then(() => { if (aktiv) setBelegt(new Set()); }); return () => { aktiv = false; }; }
    const von = isoVon(monat);
    const bis = isoVon(new Date(monat.getFullYear(), monat.getMonth() + 1, 0));
    supabase.from('driver_service_requests').select('service_date, status')
      .in('driver_id', ids.split(',')).gte('service_date', von).lte('service_date', bis)
      .then(({ data }) => {
        if (aktiv) setBelegt(new Set((data || []).filter((x) => String(x.status || '').toLowerCase() !== 'refused').map((x) => x.service_date)));
      });
    return () => { aktiv = false; };
  }, [ids, monat]);
  const ersterWochentag = (monat.getDay() + 6) % 7; // Montag = 0
  const tage = new Date(monat.getFullYear(), monat.getMonth() + 1, 0).getDate();
  const felder = [...Array(ersterWochentag).fill(null), ...Array.from({ length: tage }, (_, i) => i + 1)];
  const heute = heuteIso();
  return (
    <div className="mt-[10px] rounded-[12px] p-[10px]" style={{ background: KACHEL }}>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() - 1, 1))} className="w-[36px] h-[32px] text-[20px] font-bold" style={{ color: LIME }} aria-label="Monat zurück">‹</button>
        <span className="text-[15px] font-bold text-white">{monat.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</span>
        <button type="button" onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() + 1, 1))} className="w-[36px] h-[32px] text-[20px] font-bold" style={{ color: LIME }} aria-label="Monat vor">›</button>
      </div>
      <div className="mt-[4px] grid grid-cols-7 text-center text-[11px] font-bold text-white/50">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="mt-[2px] grid grid-cols-7 gap-y-[2px]">
        {felder.map((tag, i) => {
          if (!tag) return <span key={`l${i}`} />;
          const iso = isoVon(new Date(monat.getFullYear(), monat.getMonth(), tag));
          const an = gewaehlt.includes(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => umschalten(iso)}
              className="relative h-[36px] flex flex-col items-center justify-center rounded-[8px] text-[14px] font-bold tabular-nums"
              style={{ background: an ? LIME : 'transparent', color: an ? '#000' : (iso < heute ? GRAU : '#FFFFFF'), outline: iso === heute && !an ? `1px solid ${LIME}` : 'none', outlineOffset: '-1px' }}
            >
              {tag}
              {belegt.has(iso) ? <span className="absolute bottom-[3px] w-[5px] h-[5px] rounded-full" style={{ background: an ? '#000' : LIME }} /> : null}
            </button>
          );
        })}
      </div>
      <div className="mt-[6px] flex items-center gap-[6px] text-[11px] font-medium text-white/50">
        <span className="w-[5px] h-[5px] rounded-full" style={{ background: LIME }} /> schon ein Dienst eingetragen
      </div>
    </div>
  );
}

function Beschriftung({ text, an }) {
  return (
    <span className="block mt-[6px] text-center text-[16px] font-bold tracking-[-0.5px]" style={{ color: an ? '#FFFFFF' : GRAU }}>
      {text}
    </span>
  );
}


// Treffpunkt (Feld mit eigenen Orten und Adressvorschlaegen wie beim Standby) und Notiz an den Fahrer.
function TreffpunktFelder({ treffpunkt, onTreffpunkt, notiz, onNotiz, onFetchPlaceSuggestions }) {
  const { orte } = useOrte();
  const [offen, setOffen] = useState(false);
  const [vorschlaege, setVorschlaege] = useState([]);
  const timer = useRef(null);
  const seq = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);
  const tippen = (text) => {
    onTreffpunkt({ text, ortId: '' });
    clearTimeout(timer.current);
    const q = text.trim();
    if (!q) { setVorschlaege([]); return; }
    setOffen(true);
    const n = seq.current + 1;
    seq.current = n;
    timer.current = setTimeout(async () => {
      const liste = await onFetchPlaceSuggestions(q);
      if (seq.current === n) setVorschlaege(liste || []);
    }, 250);
  };
  const eigene = treffpunkt.ortId ? [] : orteZurEingabe(orte, treffpunkt.text);
  const eigenerOrt = treffpunkt.ortId ? orte.find((o) => String(o.id) === String(treffpunkt.ortId)) : null;
  return (
    <div className="mt-[12px] relative">
      <div className="h-[56px] rounded-[12px] flex items-center gap-[10px] pl-[12px] pr-[6px]" style={{ background: KACHEL }}>
        {eigenerOrt ? <img src={ortIconUrl(eigenerOrt.icon)} alt="" className="w-[24px] h-[24px] object-contain shrink-0" /> : null}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium leading-[14px] text-white/60">Treffpunkt beim Dienststart</div>
          <input
            value={treffpunkt.text}
            onChange={(e) => tippen(e.target.value)}
            onFocus={() => setOffen(true)}
            onBlur={() => setTimeout(() => setOffen(false), 150)}
            placeholder="Ort oder Adresse"
            data-tutorial="dienst-treffpunkt"
            className="w-full bg-transparent outline-none text-[15px] font-bold leading-[20px] text-white placeholder:text-white/30"
          />
        </div>
        {treffpunkt.text ? (
          <button type="button" onClick={() => { onTreffpunkt({ text: '', ortId: '' }); setVorschlaege([]); }} className="w-[36px] h-[36px] text-[20px] text-white/60" aria-label="Treffpunkt entfernen">×</button>
        ) : null}
      </div>
      {offen && (eigene.length > 0 || vorschlaege.length > 0) ? (
        <div className="absolute left-0 right-0 max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[130]" style={{ top: '60px' }}>
          {eigene.map((o) => (
            <OrtVorschlag key={`ort-${o.id}`} ort={o} onWaehlen={(g) => { onTreffpunkt({ text: g.name, ortId: g.id }); setVorschlaege([]); setOffen(false); }} />
          ))}
          {vorschlaege.map((v, i) => (
            <button
              key={`v-${i}-${v}`}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onTreffpunkt({ text: v, ortId: '' }); setVorschlaege([]); setOffen(false); }}
              className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15]"
              style={{ color: LIME }}
            >
              {v}
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-[6px] rounded-[12px] px-[12px] pt-[8px] pb-[10px]" style={{ background: KACHEL }}>
        <div className="text-[11px] font-medium leading-[14px] text-white/60">Notiz an Fahrer</div>
        <textarea
          value={notiz}
          onChange={(e) => onNotiz?.(e.target.value)}
          rows={2}
          placeholder="z. B. Schild mitnehmen"
          data-tutorial="dienst-notiz"
          className="w-full bg-transparent outline-none resize-none text-[15px] font-bold leading-[20px] text-white placeholder:text-white/30"
        />
      </div>
    </div>
  );
}

export default function DienstePlanenBlatt({
  t,
  anzahl,
  tage,            // [{ iso, wochentag, datum }] der Planungshorizont
  datum, onDatum,
  daten, onDaten,   // mehrere Tage (YYYY-MM-DD), optional
  start, onStart,
  ende, onEnde,
  pausen, onPausen, // [{ von, bis }] als HH:MM, optional
  fahrerIds = [],   // ausgewaehlte Fahrer, fuer die Punkte im Kalender
  bestand = null, onBestand = () => {}, // vorhandener Dienst (ein Fahrer, ein Tag), vorausgefuellt
  // Treffpunkt beim Dienststart ({ text, ortId } wie der Standby-Ort) und Notiz an den Fahrer (13.11.).
  treffpunkt = { text: '', ortId: '' }, onTreffpunkt = null,
  notiz = '', onNotiz = null,
  onFetchPlaceSuggestions = async () => [],
  vorlagen,
  fehler,
  speichert,
  onAnwenden,
  onSchliessen,
}) {
  // Gewaehlte Tage (Kalender). Ohne daten/onDaten gilt der einzelne Tag wie bisher.
  const tageListe = (daten && daten.length ? daten : [datum]).filter(Boolean);
  const tageSetzen = (liste) => {
    if (onDaten) onDaten(liste);
    if (liste[0]) onDatum(liste[0]);
  };

  // Welche Zeit Plus und Minus gerade verschieben: 'start', 'ende', 'p0-von', 'p1-bis' ...
  const [feld, setFeld] = useState(start ? 'start' : null);
  // Drehrad fuer das gewaehlte Feld offen.
  const [radOffen, setRadOffen] = useState(false);
  // Monatskalender fuer weitere Tage (auch Vergangenheit, belegte Tage mit Punkt).
  const [kalenderOffen, setKalenderOffen] = useState(false);
  const liste = pausen || [];

  // Genau ein Fahrer und ein Tag: vorhandenen Dienst laden und die Kacheln damit fuellen.
  const schluessel = fahrerIds.length === 1 && tageListe.length === 1 ? `${fahrerIds[0]}|${tageListe[0]}` : '';
  const hatteBestand = useRef(false);
  useEffect(() => {
    let aktiv = true;
    const setzen = (b) => {
      if (!aktiv) return;
      onBestand(b);
      if (b) {
        onStart(b.start); onEnde(b.ende); onPausen?.(b.pausen);
        onTreffpunkt?.(b.treffpunkt || { text: '', ortId: '' }); onNotiz?.(b.notiz || '');
      } else if (hatteBestand.current) {
        onStart(''); onEnde(''); onPausen?.([]);
        onTreffpunkt?.({ text: '', ortId: '' }); onNotiz?.('');
      }
      hatteBestand.current = Boolean(b);
      setFeld(null);
    };
    if (!schluessel) { Promise.resolve().then(() => setzen(null)); return () => { aktiv = false; }; }
    const [f, tag] = schluessel.split('|');
    dienstBestandLaden(f, tag).then(setzen).catch(() => setzen(null));
    return () => { aktiv = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schluessel]);
  const zStart = feldZustand(bestand, 'start', start);
  const zEnde = feldZustand(bestand, 'ende', ende);
  const zPausen = feldZustand(bestand, 'pausen', liste);
  const treffpunktNeu = Boolean(onTreffpunkt) && treffpunktSchluessel(treffpunkt, notiz)
    !== treffpunktSchluessel(bestand?.treffpunkt, bestand?.notiz);
  const unveraendert = Boolean(bestand) && zStart !== 'neu' && zEnde !== 'neu' && zPausen !== 'neu' && !treffpunktNeu;
  // × bei vorausgefuellten Feldern: zurueck auf den gesendeten Stand. Gesendetes selbst bleibt.
  const startZurueck = bestand?.start ? (zStart === 'neu' ? () => { onStart(bestand.start); setFeld(null); } : null) : () => { onStart(''); setFeld(null); };
  const endeZurueck = bestand?.ende ? (zEnde === 'neu' ? () => { onEnde(bestand.ende); setFeld(null); } : null) : () => { onEnde(''); setFeld(null); };
  const aktiveVorlage = vorlagen.find((v) => v.start === start && v.end === ende)?.key || null;

  const pausenIndex = feld?.startsWith('p') ? Number(feld.slice(1, 2)) : null;
  const pausenFeld = pausenIndex != null ? feld.slice(3) : null;
  const feldWert = feld === 'start' ? start
    : feld === 'ende' ? ende
      : (pausenIndex != null ? liste[pausenIndex]?.[pausenFeld] : '');

  const feldSetzen = (wert) => {
    if (feld === 'start') onStart(wert);
    else if (feld === 'ende') onEnde(wert);
    else if (pausenIndex != null && onPausen) {
      onPausen(liste.map((p, i) => (i === pausenIndex ? { ...p, [pausenFeld]: wert } : p)));
    }
  };

  const zeitTippen = (welches) => {
    const wert = welches === 'start' ? start : ende;
    if (!wert) {
      // Leere Kachel: sinnvolle Zeit vorschlagen (Ende 8 h nach Start, sonst 16:00).
      const vorschlag = welches === 'start'
        ? (ende ? zuUhrzeit(zuMinuten(ende) - 8 * 60) : '08:00')
        : (start ? zuUhrzeit(zuMinuten(start) + 8 * 60) : '16:00');
      (welches === 'start' ? onStart : onEnde)(vorschlag);
    }
    setFeld(welches);
    setRadOffen(true);
  };

  const pauseTippen = (index, was) => {
    if (was === 'neu') {
      // Neue Pause in der Mitte des Dienstes, 30 Minuten.
      const a = zuMinuten(start);
      const mitte = a != null && ende ? a + spanne(start, ende) / 2 : 12 * 60;
      const von = Math.round(mitte / SCHRITT_MIN) * SCHRITT_MIN + index * 60;
      onPausen?.([...liste, { von: zuUhrzeit(von), bis: zuUhrzeit(von + 30) }]);
      setFeld(`p${liste.length}-von`);
      setRadOffen(true);
      return;
    }
    setFeld(`p${index}-${was}`);
    setRadOffen(true);
  };

  // Senden geht auch nur mit einer Pause (Dienst des Tages bleibt, der Fahrer bestaetigt nur die Pause).
  const nurPause = !start && !ende && liste.some((p) => p.von && p.bis);
  const nichtsGesetzt = !start && !ende && !nurPause;
  // Dienststart < Pausenanfang < Pausenende < Dienstende (ueber Mitternacht ab Dienststart gerechnet).
  const reihenfolge = reihenfolgeFehler(start, ende, liste);

  return (
    <div
      data-tutorial="dienste-sheet"
      className="absolute left-0 right-0 bottom-0 bg-black px-[20px] pt-[20px] pb-[22px] max-h-[calc(var(--app-h,100dvh)-20px)] overflow-y-auto font-['Space_Grotesk']"
    >
      <div className="border-2 px-[17px] pt-[14px] pb-[16px]" style={{ background: '#1A1A1A', borderColor: GRUEN }}>
        <div className="text-center text-[18px] font-bold tracking-[-0.5px]" style={{ color: LIME }}>{t('fahrer.planServices')}</div>
        <div className="mt-[2px] text-center text-[12px] font-medium text-white/60">
          {anzahl > 0 ? t('fahrer.driversSelected', { n: anzahl }) : t('fahrer.noneSelected')}
        </div>

        {/* Tage: Kalender wie bei Fahrt anlegen, beliebig viele Tage */}
        <div className="mt-[12px] flex flex-wrap gap-[8px]">
          {tageListe.map((iso) => (
            <button
              key={iso}
              type="button"
              onClick={() => (tageListe.length > 1 ? tageSetzen(tageListe.filter((d) => d !== iso)) : null)}
              className="h-[48px] pl-[12px] pr-[10px] rounded-[12px] flex items-center gap-[8px]"
              style={{ background: KACHEL, outline: `2px solid ${LIME}`, outlineOffset: '-2px', color: LIME }}
              aria-label={tageListe.length > 1 ? `${tagText(iso)} entfernen` : tagText(iso)}
            >
              <span className="text-[15px] font-bold leading-[18px] whitespace-nowrap">{tagText(iso)}</span>
              {tageListe.length > 1 ? <span className="text-[18px] leading-none text-white/60">×</span> : null}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setKalenderOffen((x) => !x)}
            className="h-[48px] px-[14px] rounded-[12px] flex items-center gap-[8px]"
            style={{ background: KACHEL, color: kalenderOffen ? LIME : '#FFFFFF' }}
            aria-label="Tage im Kalender wählen"
          >
            <span className="text-[15px] font-bold leading-[18px] whitespace-nowrap">{kalenderOffen ? 'Kalender zu' : '+ Tag'}</span>
          </button>
        </div>

        {kalenderOffen ? (
          <DienstKalender
            gewaehlt={tageListe}
            fahrerIds={fahrerIds}
            umschalten={(iso) => {
              if (tageListe.includes(iso)) { if (tageListe.length > 1) tageSetzen(tageListe.filter((d) => d !== iso)); }
              else tageSetzen([...tageListe, iso].sort());
            }}
          />
        ) : null}

        {/* Start | Pause | Pause | Ende */}
        <div className="mt-[14px] grid grid-cols-4 gap-[6px]">
          <div>
            <ZeitKachel wert={start} aktiv={feld === 'start'} onTippen={() => zeitTippen('start')} onEntfernen={startZurueck} marker="dienst-start" />
            <Beschriftung text="Start" an={Boolean(start)} />
            <ZustandZeile zustand={zStart} />
          </div>
          {[0, 1].map((index) => (
            <div key={index}>
              {onPausen && (liste[index] || index === liste.length) ? (
                <PausenKachel
                  pause={liste[index]}
                  aktivFeld={pausenIndex === index ? pausenFeld : null}
                  onTippen={(was) => pauseTippen(index, was)}
                  onEntfernen={() => { onPausen(liste.filter((_, i) => i !== index)); setFeld(null); }}
                />
              ) : (
                <div className="w-full h-[69px] rounded-[12px]" style={{ background: KACHEL, opacity: 0.5 }} />
              )}
              <Beschriftung text="Pause" an={false} />
              {liste[index] ? <ZustandZeile zustand={zPausen} /> : null}
            </div>
          ))}
          <div>
            <ZeitKachel wert={ende} aktiv={feld === 'ende'} onTippen={() => zeitTippen('ende')} onEntfernen={endeZurueck} marker="dienst-ende" />
            <Beschriftung text="Ende" an={Boolean(ende)} />
            <ZustandZeile zustand={zEnde} />
          </div>
        </div>

        {radOffen && feld && feldWert ? (
          <ZeitRad key={feld} wert={feldWert} setWert={feldSetzen} schliessen={() => setRadOffen(false)} />
        ) : null}

        {/* Dauer gross, wie die Arbeitszeit in der Stundenerfassung */}
        <div className="mt-[10px] text-center tabular-nums">
          {start && ende ? (
            <>
              <div className="text-[35px] font-bold tracking-[-0.5px] leading-[44px]" style={{ color: LIME }}>{nettoText(start, ende, liste)}</div>
              {zuMinuten(ende) <= zuMinuten(start) ? (
                <div className="text-[12px] font-medium text-white/60">endet am Folgetag</div>
              ) : null}
            </>
          ) : (
            <div className="text-[18px] font-bold tracking-[-0.5px] leading-[44px]" style={{ color: nichtsGesetzt ? GRAU : LIME }}>
              {nichtsGesetzt ? 'Start oder Ende antippen' : nurPause ? 'Nur Pause' : (start ? 'Nur Dienststart' : 'Nur Dienstende')}
            </div>
          )}
        </div>

        {/* Treffpunkt und Notiz beim Dienststart: nur mit Dienststart (eigener Ort oder Adresse). */}
        {onTreffpunkt && (start || bestand?.start) ? (
          <TreffpunktFelder
            treffpunkt={treffpunkt}
            onTreffpunkt={onTreffpunkt}
            notiz={notiz}
            onNotiz={onNotiz}
            onFetchPlaceSuggestions={onFetchPlaceSuggestions}
          />
        ) : null}
      </div>

      {/* Vorlagen */}
      <div data-tutorial="dienst-vorlagen" className="mt-[10px] grid grid-cols-4 gap-[6px]">
        {vorlagen.map((v) => {
          const aktiv = v.key === aktiveVorlage;
          return (
            <button
              key={v.key}
              type="button"
              data-tutorial={`dienst-vorlage-${v.key}`}
              onClick={() => { onStart(v.start); onEnde(v.end); setFeld('start'); }}
              className="h-[48px] rounded-[12px] flex flex-col items-center justify-center"
              style={{ background: KACHEL, outline: aktiv ? `2px solid ${LIME}` : 'none', outlineOffset: '-2px', color: aktiv ? LIME : '#FFFFFF' }}
            >
              <span className="text-[14px] font-bold leading-[17px]">{t(v.labelKey)}</span>
              <span className="text-[11px] leading-[14px] opacity-70 tabular-nums">{`${v.start.slice(0, 2)}–${v.end.slice(0, 2)}`}</span>
            </button>
          );
        })}
      </div>

      {reihenfolge ? (
        <div className="mt-[8px] text-center text-[13px] font-bold" style={{ color: ROT }}>{reihenfolge}</div>
      ) : null}

      {unveraendert ? (
        <div className="mt-[8px] text-center text-[13px] font-medium text-white/60">Schon gesendet. Zeit antippen zum Ändern.</div>
      ) : null}

      {fehler ? (
        <div className="mt-[8px] text-[#FF8E8E] text-[13px] whitespace-pre-line font-medium">{fehler}</div>
      ) : null}

      <div className="mt-[12px] grid grid-cols-2 gap-[9px]">
        <button
          type="button"
          onClick={onSchliessen}
          data-tutorial="dienst-abbrechen"
          className="h-[56px] px-[16px] flex items-center justify-between text-[#202020] text-[16px] font-medium tracking-[0.5px]"
          style={{ background: ROT }}
        >
          <span>{t('fahrer.cancel')}</span>
          <Pfeil />
        </button>
        <button
          type="button"
          onClick={onAnwenden}
          data-tutorial="dienst-anwenden"
          disabled={speichert || nichtsGesetzt || unveraendert || Boolean(reihenfolge) || !anzahl}
          className="h-[56px] px-[16px] flex items-center justify-between text-[#202020] text-[16px] font-medium tracking-[0.5px] disabled:opacity-50"
          style={{ background: GRUEN }}
        >
          <span>{speichert ? t('fahrer.saving') : `Senden (${anzahl || 0})`}</span>
          <Pfeil />
        </button>
      </div>
    </div>
  );
}
