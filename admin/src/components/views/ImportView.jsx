import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { useI18n } from '../../i18n';
import { tutorialLaeuft } from '../ui/demoDialoge';
import { importBeispiele } from '../../demo/importBeispiele';
import { DEMO_MODE } from '../../datenquelle';
import {
  adressenPruefen,
  beispielAlsDatei,
  dateiAlsBase64,
  importAnalysieren,
  importAusfuehren,
  importKern as K,
  importListe,
  importRueckgaengig,
} from '../../services/importDienst';

// Import von Fahrten und Fahrgaesten aus beliebigen Tabellen (Excel oder CSV).
// Ablauf: Datei -> Erkennung -> Zuordnung und Vorschau pruefen (jede Zeile aenderbar) -> Import.
// Die Erkennung laeuft auf dem Server (dispo-admin, siehe importDienst.js), dieselbe in iOS und Android.

const MODES = {
  rides: {
    titleKey: 'sonstige.fahrtenImportTitle',
    backView: 'fahrtAdd',
    zielView: 'ankuenfte',
    importKey: 'imp.fahrtenImportieren',
    fertigKey: 'imp.fahrtenImportiert',
    zielKey: 'imp.zuDenFahrten',
  },
  guests: {
    titleKey: 'sonstige.kundenImportTitle',
    backView: 'alleKunden',
    zielView: 'alleKunden',
    importKey: 'imp.gaesteImportieren',
    fertigKey: 'imp.gaesteImportiert',
    zielKey: 'imp.zuDenFahrgaesten',
  },
};

const LIME = '#E3F654';
const ORANGE = '#ffcd8a';
const ROT = '#ff8a8a';
const ROT_KARTE = '#FB2C36';
const schrift = "font-['Space_Grotesk']";

// Kleine Pause, damit die Erkennung als eigener Schritt sichtbar ist.
const ERKENNUNG_MS = 900;

// Hinweise, die eine Zeile nicht ausschliessen, aber angeschaut werden sollten.
const WARNUNGEN = new Set(['doppelt', 'vergangen', 'adresseUnbekannt', 'mehrNamenAlsPersonen', 'gleicheAdresse', 'emailUngueltig']);

const FunkenIcon = ({ drehen = false }) => (
  <svg viewBox="0 0 29 29.14" width="22" height="22" fill="none" className={drehen ? 'animate-pulse' : ''}>
    <path d="M12.08 29.07S11.27 16.99 0 16.99M12.08 4.9s.81 12.09 12.09 12.09M12.08 4.9S11.27 16.99 0 16.99M12.08 29.07s.81-12.08 12.09-12.08" stroke="currentColor" strokeWidth="2" />
    <path d="M22.96 12.15s-.41-6.04-6.04-6.04M22.96 12.15s.4-6.04 6.04-6.04M22.96.07s-.41 6.04-6.04 6.04M22.96.07s.4 6.04 6.04 6.04" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const PfeilIcon = () => (
  <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
);

const datumLang = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

const Feld = ({ label, value, onChange, typ = 'text', breit = true }) => (
  <label className={`flex flex-col gap-[3px] ${breit ? 'col-span-2' : ''}`}>
    <span className={`text-[10px] font-medium ${schrift} text-[#71717B]`}>{label}</span>
    <input
      type={typ}
      value={value ?? ''}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      className={`h-[34px] bg-white border border-[#d4d4d8] px-2 text-[13px] font-medium ${schrift} text-[#18181B] outline-none focus:border-[#18181B]`}
    />
  </label>
);

// Zahl gross, Bezeichnung klein, wie die Kennzahlen der Startseite.
const Kachel = ({ zahl, text, hell = false, farbe = null }) => (
  <div className="h-[64px] px-3 flex flex-col justify-center" style={hell ? { background: LIME } : { background: '#0f0f0f', border: `1px solid ${farbe || 'rgba(227,246,84,0.35)'}` }}>
    <span className={`text-[26px] leading-[28px] font-bold ${schrift}`} style={{ color: hell ? '#000' : (farbe || LIME) }}>{zahl}</span>
    <span className={`text-[11px] font-medium ${schrift}`} style={{ color: hell ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.55)' }}>{text}</span>
  </div>
);

const Chip = ({ children, farbe = LIME }) => (
  <span className={`h-[24px] px-2 inline-flex items-center border text-[11px] font-medium ${schrift} max-w-full truncate`} style={{ borderColor: farbe, color: farbe }}>{children}</span>
);

// Trennzeile wie in "Alle Fahrten": Striche aussen, Wochentag und Datum mittig, darunter die Zahl.
const TagKopf = ({ iso, erster, anzahl, gaeste, modus, t }) => {
  if (modus !== 'rides') return null;
  const titel = iso
    ? (() => { const d = new Date(`${iso}T12:00:00`); return `${d.toLocaleDateString('de-DE', { weekday: 'long' })} ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`.replace(/\.*$/, '.'); })()
    : t('imp.ohneDatum');
  return (
    <div className={`${erster ? '' : 'pt-[12px]'} flex flex-col items-center`}>
      <div className="w-full flex items-center justify-between">
        <span className="w-[44px] h-[2px] shrink-0" style={{ background: iso ? '#e3f754' : ROT }} />
        <span className={`text-[26px] font-bold tracking-[-0.5px] whitespace-nowrap ${schrift}`} style={{ color: iso ? '#e3f754' : ROT }}>{titel}</span>
        <span className="w-[44px] h-[2px] shrink-0" style={{ background: iso ? '#e3f754' : ROT }} />
      </div>
      <span className={`mt-[2px] text-[12px] font-medium ${schrift}`} style={{ color: 'rgba(227,246,84,0.7)' }}>
        {t(anzahl === 1 ? 'imp.tagEine' : 'imp.tagViele', { n: anzahl })}{gaeste ? ` · ${t('imp.tagGaeste', { n: gaeste })}` : ''}
      </span>
    </div>
  );
};

// Fahrt wie die Karte in "Alle Fahrten": Namen gross, Route, Zeit rechts. Rot = es fehlt etwas,
// blass = wird nicht importiert. Antippen oeffnet die Bearbeitung in der Karte.
const ImportKarte = ({ satz: s, modus, offen, oeffnen, umschalten, aendern, adressen, t, feldText, hinweisText }) => {
  const d = s.daten;
  const rot = s.fehlt.length > 0;
  const text = rot ? '#000' : '#18181B';
  const warnungen = s.hinweise.filter((h) => WARNUNGEN.has(h));
  const infos = s.hinweise.filter((h) => !WARNUNGEN.has(h));
  const namen = modus === 'rides'
    ? ((d.passengers || []).join(', ') || t('imp.ohneName'))
    : (`${d.first_name || ''} ${d.last_name || ''}`.trim() || t('imp.ohneName'));
  const groesse = namen.length > 45 ? 18 : namen.length > 30 ? 20 : 24;
  const route = modus === 'rides'
    ? `${d.pickup_name || d.pickup_address || '—'} → ${d.dropoff_name || d.dropoff_address || '—'}`
    : [d.company, d.email, d.phone].filter(Boolean).join(' · ');
  // Firma steht beim Import vorne in der Notiz ("Firma: X · Tel. ..."): eigene Zeile.
  const teile = String(d.note || '').split(' · ').filter(Boolean);
  const firma = (teile.find((x) => x.startsWith('Firma: ')) || '').replace(/^Firma: /, '');
  const notiz = teile.filter((x) => !x.startsWith('Firma: ')).join(' · ');
  const extra = modus === 'rides'
    ? [d.flight_number || d.train_number, d.anzahl ? t('imp.personen', { n: d.anzahl }) : '', d.needs_child_seat ? feldText('kindersitz') : '', d.is_vip ? 'VIP' : ''].filter(Boolean).join(' · ')
    : '';
  return (
    <div className="relative w-full" style={{ background: rot ? ROT_KARTE : '#fff', opacity: s.aus ? 0.45 : 1 }}>
      <div role="button" tabIndex={0} onClick={oeffnen} className="w-full min-h-[120px] p-[18px] text-left cursor-pointer">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 flex flex-col gap-[5px]">
            <div className={`font-bold ${schrift} break-words line-clamp-2`} style={{ fontSize: groesse, lineHeight: 1.3, color: text }}>{namen}</div>
            <div className={`text-xs font-medium ${schrift} leading-4 tracking-wide opacity-80`} style={{ color: text }}>{route}</div>
            {firma ? <div className={`text-[13px] font-bold ${schrift} truncate`} style={{ color: text }}>{firma}</div> : null}
            {extra ? <div className={`text-[13px] font-bold ${schrift}`} style={{ color: text }}>{extra}</div> : null}
            {rot ? <div className={`text-[12px] font-bold ${schrift}`} style={{ color: '#000' }}>{t('imp.fehltFeld', { felder: s.fehlt.map(feldText).join(', ') })}</div> : null}
            {warnungen.length ? <div className={`text-[12px] font-bold ${schrift}`} style={{ color: rot ? '#000' : '#FF8A00' }}>{warnungen.map(hinweisText).join(' · ')}</div> : null}
            {infos.length ? <div className={`text-[11px] font-medium ${schrift}`} style={{ color: rot ? '#262626' : '#71717B' }}>{infos.map(hinweisText).join(' · ')}</div> : null}
            {notiz ? <div className={`text-xs font-medium ${schrift} leading-5 truncate pr-[36px]`} style={{ color: rot ? '#000' : '#71717B' }}>{t('imp.notiz', { text: notiz })}</div> : null}
          </div>
          {modus === 'rides' ? (
            <div className={`shrink-0 text-right ${schrift}`}>
              <div className="text-[22px] font-bold leading-[24px]" style={{ color: text }}>{(d.etd || '--:--').slice(0, 5)}</div>
            </div>
          ) : null}
        </div>
      </div>
      {/* Haken unten rechts: mit importieren ja/nein */}
      <button
        type="button"
        onClick={umschalten}
        aria-label={t('imp.mitImportieren')}
        className="absolute right-[14px] bottom-[14px] w-[30px] h-[30px] flex items-center justify-center"
        style={{ background: s.aus ? 'transparent' : '#18181B', border: '2px solid #18181B' }}
      >
        {s.aus ? null : <span className="text-[16px] leading-none" style={{ color: LIME }}>✓</span>}
      </button>
      {offen ? (
        <div className="px-[18px] pb-[56px] grid grid-cols-2 gap-[8px] border-t border-black/10 pt-[12px]">
          {modus === 'rides' ? (
            <>
              <Feld breit={false} typ="date" label={feldText('datum')} value={d.ride_date} onChange={(v) => aendern({ ride_date: v || null })} />
              <Feld breit={false} typ="time" label={feldText('uhrzeit')} value={(d.etd || '').slice(0, 5)} onChange={(v) => aendern({ etd: v ? `${v}:00` : null, original_etd: v ? `${v}:00` : null })} />
              <Feld label={feldText('abholort')} value={d.pickup_address} onChange={(v) => aendern({ pickup_address: v, pickup_name: K.kurzname(v) })} />
              <Feld label={feldText('zielort')} value={d.dropoff_address} onChange={(v) => aendern({ dropoff_address: v, dropoff_name: K.kurzname(v) })} />
              <Feld breit={false} label={feldText('flugnummer')} value={d.flight_number || d.train_number} onChange={(v) => aendern(/^(ICE|IC|EC|RJ|RE|RB)\s?\d/i.test(v) ? { train_number: v, flight_number: null } : { flight_number: v, train_number: null })} />
              <Feld breit={false} typ="number" label={feldText('anzahl')} value={d.anzahl ?? ''} onChange={(v) => aendern({ anzahl: v ? Number(v) : null })} />
              <Feld label={feldText('gaeste')} value={(d.passengers || []).join(', ')} onChange={(v) => aendern({ passengers: v.split(/\s*,\s*/).filter(Boolean) })} />
              <Feld label={feldText('notiz')} value={d.note} onChange={(v) => aendern({ note: v })} />
              {adressen ? [d.pickup_address, d.dropoff_address].filter((a) => a && adressen[a]?.gefunden).map((a) => (
                <div key={a} className={`col-span-2 text-[10px] leading-[13px] font-medium ${schrift} text-[#71717B]`}>{a} → {adressen[a].name}</div>
              )) : null}
            </>
          ) : (
            <>
              <Feld breit={false} label={feldText('vorname')} value={d.first_name} onChange={(v) => aendern({ first_name: v })} />
              <Feld breit={false} label={feldText('nachname')} value={d.last_name} onChange={(v) => aendern({ last_name: v })} />
              <Feld label={feldText('email')} value={d.email} onChange={(v) => aendern({ email: v || null })} />
              <Feld breit={false} label={feldText('telefon')} value={d.phone} onChange={(v) => aendern({ phone: v || null })} />
              <Feld breit={false} label={feldText('firma')} value={d.company} onChange={(v) => aendern({ company: v || null })} />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default function ImportView({ setView, mode = 'rides' }) {
  const { t } = useI18n();
  const modus = mode === 'guests' ? 'guests' : 'rides';
  const config = MODES[modus];
  const fileInputRef = useRef(null);

  // schritt: 'datei' | 'erkennung' | 'zuordnung' | 'fertig'
  const [schritt, setSchritt] = useState('datei');
  const [quelle, setQuelle] = useState(null); // { datei (base64), dateiname }
  const [analyse, setAnalyse] = useState(null);
  const [saetze, setSaetze] = useState([]); // [{ ...datensatz, aus: bool }]
  const [offen, setOffen] = useState(null); // Index der Zeile im Editor
  const [adressen, setAdressen] = useState(null); // { adresse: {gefunden, name} } oder null = laeuft
  const [neuBerechnen, setNeuBerechnen] = useState(false);
  const [fehler, setFehler] = useState('');
  const [ergebnis, setErgebnis] = useState(null); // { import_id, anzahl }
  const [rueckgaengigText, setRueckgaengigText] = useState('');
  const [importe, setImporte] = useState([]);
  const [isBusy, setIsBusy] = useState(false);
  const [spaltenOffen, setSpaltenOffen] = useState(false);

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  const fehlerText = (e) => {
    const code = e?.code || e?.message || '';
    if (['datei_zu_gross', 'datei_unlesbar', 'datei_leer', 'nichts_zu_importieren'].includes(code)) return t(`imp.fehler.${code}`);
    if (/not_signed_in/.test(code)) return t('erstellen.errorSessionExpired');
    return t('sonstige.dateiLesenFehler', { message: code });
  };

  const listeLaden = () => { importListe(modus).then(setImporte).catch(() => setImporte([])); };
  useEffect(listeLaden, [modus]);

  // Ergebnis der Analyse uebernehmen. Doppelte Fahrten sind zunaechst abgewaehlt.
  const uebernehmen = (a) => {
    setAnalyse(a);
    setSaetze(a.datensaetze.map((s) => ({ ...s, aus: s.hinweise.includes('doppelt') })));
    setOffen(null);
    setAdressen(null);
  };

  const auswerten = async (eingabe, { blatt = null, zuordnung = null, warten = true } = {}) => {
    setFehler('');
    if (warten) setSchritt('erkennung'); else setNeuBerechnen(true);
    try {
      const [a] = await Promise.all([
        importAnalysieren({ modus, ...eingabe, blatt, zuordnung }),
        warten ? new Promise((fertig) => setTimeout(fertig, ERKENNUNG_MS)) : null,
      ]);
      uebernehmen(a);
      setSchritt('zuordnung');
    } catch (e) {
      setFehler(fehlerText(e));
      if (warten) setSchritt('datei');
    } finally {
      setNeuBerechnen(false);
    }
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { setFehler(t('imp.fehler.datei_zu_gross')); return; }
    const eingabe = { datei: await dateiAlsBase64(file), dateiname: file.name };
    setQuelle(eingabe);
    auswerten(eingabe);
  };

  const beispielLaden = (beispiel) => {
    const eingabe = { datei: beispielAlsDatei(beispiel.inhalt), dateiname: beispiel.dateiname };
    setQuelle(eingabe);
    auswerten(eingabe);
  };

  // Adressen pruefen, sobald die Vorschau steht (nur Fahrten, nur live).
  useEffect(() => {
    if (schritt !== 'zuordnung' || modus !== 'rides' || !analyse || DEMO_MODE) return undefined;
    let aktiv = true;
    const liste = [...new Set(analyse.datensaetze.flatMap((s) => [s.daten.pickup_address, s.daten.dropoff_address]).filter(Boolean))];
    setAdressen(null);
    adressenPruefen(liste).then((r) => { if (aktiv) setAdressen(r); }).catch(() => { if (aktiv) setAdressen({}); });
    return () => { aktiv = false; };
  }, [analyse, schritt, modus]);

  // Spalte neu zuordnen: der Server baut die Datensaetze neu.
  const zuordnen = (spaltenIndex, feld) => {
    const felder = K.felderFuer(modus);
    const neu = { ...(analyse?.zuordnung || {}) };
    const belegt = felder.find((f) => f.key === feld)?.belegt || [];
    Object.entries(neu).forEach(([idx, f]) => {
      const kollidiert = f === feld || belegt.includes(f) || (felder.find((x) => x.key === f)?.belegt || []).includes(feld);
      if (feld && kollidiert && Number(idx) !== spaltenIndex) delete neu[idx];
    });
    if (feld) neu[spaltenIndex] = feld; else delete neu[spaltenIndex];
    auswerten(quelle, { blatt: analyse.blatt, zuordnung: neu, warten: false });
  };

  const blattWechseln = (blatt) => auswerten(quelle, { blatt, warten: false });

  // Zeile bearbeiten und sofort neu pruefen.
  const satzAendern = (index, aenderung) => {
    setSaetze((alt) => alt.map((s, i) => {
      if (i !== index) return s;
      const neu = { ...s, daten: { ...s.daten, ...aenderung } };
      return K.pruefen(modus, neu);
    }));
  };

  // Adresshinweise an die Saetze haengen (nur Anzeige, blockiert nichts).
  const mitAdressen = useMemo(() => saetze.map((s) => {
    if (modus !== 'rides' || !adressen) return s;
    const unbekannt = [s.daten.pickup_address, s.daten.dropoff_address].some((a) => a && adressen[a] && !adressen[a].gefunden);
    const hinweise = s.hinweise.filter((h) => h !== 'adresseUnbekannt');
    return { ...s, hinweise: unbekannt ? [...hinweise, 'adresseUnbekannt'] : hinweise };
  }), [saetze, adressen, modus]);

  const bereit = mitAdressen.filter((s) => !s.aus && !s.fehlt.length);
  const zuPruefen = mitAdressen.filter((s) => !s.aus && !s.fehlt.length && s.hinweise.some((h) => WARNUNGEN.has(h))).length;
  const aussortiert = mitAdressen.filter((s) => s.aus).length;
  const gaesteZahl = bereit.reduce((n, s) => n + Math.max((s.daten.passengers || []).length, Number(s.daten.anzahl) || 0), 0);
  // Nach Tag gruppiert und nach Uhrzeit sortiert. Ohne Datum zuerst (muss ergaenzt werden).
  const gruppen = useMemo(() => {
    const karte = new Map();
    mitAdressen.forEach((satz, index) => {
      const tag = modus === 'rides' ? (satz.daten.ride_date || '') : 'alle';
      if (!karte.has(tag)) karte.set(tag, []);
      karte.get(tag).push({ satz, index });
    });
    return [...karte.entries()]
      .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
      .map(([tag, saetze]) => ({
        tag: tag === 'alle' ? 'alle' : tag,
        saetze: modus === 'rides' ? saetze.sort((x, y) => String(x.satz.daten.etd || '').localeCompare(String(y.satz.daten.etd || ''))) : saetze,
        gaeste: saetze.filter((x) => !x.satz.aus).reduce((n, x) => n + Math.max((x.satz.daten.passengers || []).length, Number(x.satz.daten.anzahl) || 0), 0),
      }));
  }, [mitAdressen, modus]);
  const tage = gruppen.filter((g) => g.tag && g.tag !== 'alle');
  const unvollstaendig = mitAdressen.filter((s) => !s.aus && s.fehlt.length);
  const adressStand = useMemo(() => {
    if (!adressen) return null;
    const werte = Object.values(adressen);
    return { gefunden: werte.filter((w) => w.gefunden).length, gesamt: werte.length };
  }, [adressen]);

  const handleApply = async () => {
    if (!bereit.length) return;
    setIsBusy(true);
    setFehler('');
    try {
      const vorlage = Object.fromEntries(analyse.spalten
        .filter((s) => !s.ohneTitel && analyse.zuordnung[s.index])
        .map((s) => [K.schluessel(s.titel), analyse.zuordnung[s.index]]));
      const r = await importAusfuehren({
        modus,
        datensaetze: bereit.map((s) => s.daten),
        dateiname: analyse.dateiname,
        signatur: analyse.signatur,
        vorlage,
      });
      window.dispatchEvent(new CustomEvent('trisar:fahrten-geaendert'));
      setErgebnis(r);
      setRueckgaengigText('');
      setSchritt('fertig');
      listeLaden();
    } catch (e) {
      setFehler(t('sonstige.importFehlgeschlagen', { message: fehlerText(e) }));
    } finally {
      setIsBusy(false);
    }
  };

  const rueckgaengig = async (importId) => {
    setIsBusy(true);
    try {
      const r = await importRueckgaengig(importId);
      window.dispatchEvent(new CustomEvent('trisar:fahrten-geaendert'));
      setRueckgaengigText(t('imp.rueckgaengigFertig', { n: r.geloescht })
        + (r.behalten ? ` ${t('imp.rueckgaengigBehalten', { n: r.behalten })}` : ''));
      listeLaden();
    } catch (e) {
      setFehler(fehlerText(e));
    } finally {
      setIsBusy(false);
    }
  };

  const neuStarten = () => {
    setSchritt('datei');
    setAnalyse(null);
    setSaetze([]);
    setQuelle(null);
    setFehler('');
    setErgebnis(null);
    setRueckgaengigText('');
  };

  const grundText = (spalte) => {
    const g = spalte.grund || {};
    if (!spalte.vorschlag) return t('imp.keinTreffer');
    if (g.vorlage) return t('imp.grundVorlage');
    if (g.llama) return t('imp.grundLlama');
    const teile = [];
    if (g.kopf) teile.push(t('imp.grundKopf', { titel: g.kopf }));
    if (g.werte) teile.push(t('imp.grundWerte', { anteil: g.anteil, art: t(`imp.art.${g.werte}`) }));
    return teile.join(' · ') || t('imp.vonHandGeaendert');
  };

  const hinweisText = (h, s) => (h === 'mehrereZeilen' ? t('imp.h.mehrereZeilen', { n: s.zeilen.length }) : t(`imp.h.${h}`));
  const feldText = (f) => t(`imp.feld.${f === 'name' ? 'vollname' : f}`);

  const zugeordnet = analyse ? analyse.spalten.filter((s) => analyse.zuordnung[s.index]).length : 0;
  const spaltenSichtbar = spaltenOffen || Boolean(analyse?.fehlendeZuordnung?.length);

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden overscroll-none" style={gradientStyle}>
      <div className={`h-full overflow-y-auto overflow-x-hidden overscroll-none ${schritt === 'zuordnung' ? 'pb-[150px]' : 'pb-[90px]'}`}>
        <div className="px-[20px] pt-[60px]">
          <BackCircleButton onClick={() => setView(config.backView)} marker="import-zurueck" />

          <h1 data-tutorial="import-ansicht" className={`mt-[30px] text-[42px] leading-[42px] font-bold ${schrift}`} style={{ color: LIME }}>
            {t(config.titleKey)}
          </h1>

          {/* --- 1. Datei ------------------------------------------------ */}
          {schritt === 'datei' ? (
            <>
              <p className={`mt-[24px] text-[13px] leading-[18px] font-medium ${schrift}`} style={{ color: 'rgba(227,246,84,0.7)' }}>
                {t('imp.hinweis')}
              </p>

              <button
                type="button"
                onClick={() => {
                  // Im Demo-Tutorial darf keine Dateiauswahl aufgehen, sie haelt den Ablauf an.
                  if (tutorialLaeuft()) return;
                  fileInputRef.current?.click();
                }}
                data-tutorial="import-datei"
                className="mt-[24px] w-full h-14 px-4 flex items-center justify-between"
                style={{ background: LIME }}
              >
                <span className={`text-[#1d1c1d] text-base font-medium ${schrift} tracking-wide`}>{t('sonstige.dateiAuswaehlen')}</span>
                <span className="block w-[42px] h-[40px] shrink-0 overflow-clip">
                  <img src="/icon/_Icon_Schwarz/import-datei.svg" alt="" className="block w-full h-full" />
                </span>
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,text/csv" className="hidden" onChange={handleFile} />

              {DEMO_MODE && modus === 'rides' ? (
                <div className="mt-[28px]">
                  <div className={`text-[13px] font-medium ${schrift}`} style={{ color: 'rgba(227,246,84,0.7)' }}>{t('imp.beispiele')}</div>
                  <div className="mt-[10px] flex flex-col gap-[8px]">
                    {importBeispiele().map((b) => (
                      <button
                        key={b.key}
                        type="button"
                        onClick={() => beispielLaden(b)}
                        data-tutorial={`import-beispiel-${b.key}`}
                        className="w-full h-[48px] border-2 px-4 flex items-center justify-between bg-black/40"
                        style={{ borderColor: LIME }}
                      >
                        <span className={`text-[14px] font-medium ${schrift}`} style={{ color: LIME }}>{t(`imp.beispiel.${b.key}`)}</span>
                        <span className={`text-[11px] font-medium ${schrift} text-white/50`}>{b.dateiname}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {importe.length ? (
                <div className="mt-[28px]">
                  <div className={`text-[13px] font-medium ${schrift}`} style={{ color: 'rgba(227,246,84,0.7)' }}>{t('imp.letzteImporte')}</div>
                  <div className="mt-[10px] flex flex-col gap-[6px]">
                    {importe.map((imp) => (
                      <div key={imp.id} className="w-full border-2 bg-[#0f0f0f] px-3 py-2 flex items-center justify-between gap-2" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
                        <div className="min-w-0">
                          <div className={`text-[13px] font-medium truncate ${schrift} text-white`}>{imp.dateiname || '—'}</div>
                          <div className={`text-[11px] font-medium ${schrift} text-white/45`}>
                            {new Date(imp.erstellt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}
                            {' · '}
                            {imp.rueckgaengig ? t('imp.wurdeRueckgaengig') : t('imp.nochDa', { n: imp.vorhanden, gesamt: imp.anzahl })}
                          </div>
                        </div>
                        {!imp.rueckgaengig && imp.vorhanden ? (
                          <button type="button" disabled={isBusy} onClick={() => rueckgaengig(imp.id)} className={`shrink-0 text-[12px] font-medium underline ${schrift}`} style={{ color: ORANGE }}>
                            {t('imp.rueckgaengigKurz')}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {rueckgaengigText ? <div className={`mt-[8px] text-[12px] font-medium ${schrift}`} style={{ color: '#8DFFAF' }}>{rueckgaengigText}</div> : null}
                </div>
              ) : null}
            </>
          ) : null}

          {/* --- 2. Erkennung -------------------------------------------- */}
          {schritt === 'erkennung' ? (
            <div className="mt-[40px] flex flex-col items-center text-center" data-tutorial="import-erkennung">
              <span style={{ color: LIME }}><FunkenIcon drehen /></span>
              <div className={`mt-[14px] text-[18px] font-bold ${schrift}`} style={{ color: LIME }}>{t('imp.erkennt')}</div>
              <div className={`mt-[6px] text-[12px] font-medium ${schrift} text-white/50`}>{quelle?.dateiname}</div>
            </div>
          ) : null}

          {/* --- 3. Zuordnung und Vorschau ------------------------------- */}
          {schritt === 'zuordnung' && analyse ? (
            <div className={neuBerechnen ? 'opacity-50 pointer-events-none' : ''}>
              <div className="mt-[16px] flex items-center justify-between">
                <span className={`text-[12px] font-medium ${schrift} text-white/50 truncate pr-3`}>{analyse.dateiname}</span>
                <button type="button" onClick={neuStarten} className={`shrink-0 text-[12px] font-medium ${schrift} underline`} style={{ color: LIME }}>
                  {t('imp.andereDatei')}
                </button>
              </div>

              {analyse.blaetter.length > 1 ? (
                <div className="mt-[12px] -mx-[20px] px-[20px] flex gap-[6px] overflow-x-auto [scrollbar-width:none]">
                  {analyse.blaetter.map((b) => (
                    <button
                      key={b.index}
                      type="button"
                      onClick={() => b.index !== analyse.blatt && blattWechseln(b.index)}
                      className={`h-[30px] px-3 border text-[12px] font-medium whitespace-nowrap shrink-0 ${schrift}`}
                      style={b.index === analyse.blatt ? { background: LIME, color: '#000', borderColor: LIME } : { borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.7)' }}
                    >
                      {b.name}{(b.fahrten ?? 0) > 0 && b.index !== analyse.blatt ? ` · ${b.fahrten}` : ''}
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Ueberblick in Zahlen, wie die Kennzahlen auf der Startseite */}
              <div className="mt-[16px] grid grid-cols-3 gap-[8px]" data-tutorial="import-vorschau">
                <Kachel zahl={bereit.length} text={modus === 'rides' ? t('imp.k.fahrten') : t('imp.k.gaeste')} hell />
                {modus === 'rides' ? <Kachel zahl={tage.length} text={tage.length === 1 ? t('imp.k.tag') : t('imp.k.tage')} /> : null}
                {modus === 'rides' ? <Kachel zahl={gaesteZahl} text={t('imp.k.gaeste')} /> : null}
                {unvollstaendig.length ? <Kachel zahl={unvollstaendig.length} text={t('imp.k.fehlt')} farbe={ROT} /> : null}
                {zuPruefen ? <Kachel zahl={zuPruefen} text={t('imp.k.pruefen')} farbe={ORANGE} /> : null}
                {aussortiert ? <Kachel zahl={aussortiert} text={t('imp.k.aus')} farbe="rgba(255,255,255,0.35)" /> : null}
              </div>

              {/* Herkunft in kurzen Chips statt Fliesstext */}
              <div className="mt-[10px] flex flex-wrap gap-[6px]">
                {analyse.kontext?.datum ? <Chip>{t('imp.c.datum', { datum: datumLang(analyse.kontext.datum) })}</Chip> : null}
                {analyse.kontext?.ziel ? <Chip>{t('imp.c.ziel', { ziel: K.kurzname(analyse.kontext.ziel) })}</Chip> : null}
                {analyse.vorlage ? <Chip farbe="#8DFFAF">{t('imp.c.vorlage')}</Chip> : null}
                {analyse.llama?.genutzt ? <Chip farbe={ORANGE}>{t('imp.c.llama')}</Chip> : null}
                {modus === 'rides' && !DEMO_MODE ? (
                  <Chip farbe="rgba(255,255,255,0.6)">{adressStand ? t('imp.c.adressen', { n: adressStand.gefunden, gesamt: adressStand.gesamt }) : t('imp.c.adressenLaeuft')}</Chip>
                ) : null}
              </div>

              {/* Spaltenzuordnung: zugeklappt, offen wenn etwas fehlt */}
              <button
                type="button"
                onClick={() => setSpaltenOffen((o) => !o)}
                data-tutorial="import-zuordnung"
                className="mt-[14px] w-full h-[48px] border-2 px-4 flex items-center justify-between bg-black/40"
                style={{ borderColor: analyse.fehlendeZuordnung?.length ? ORANGE : 'rgba(227,246,84,0.45)' }}
              >
                <span className="flex items-center gap-[10px]" style={{ color: LIME }}>
                  <FunkenIcon />
                  <span className={`text-[15px] font-bold ${schrift}`}>{t('imp.spalten')}</span>
                </span>
                <span className={`text-[12px] font-medium ${schrift}`} style={{ color: analyse.fehlendeZuordnung?.length ? ORANGE : 'rgba(227,246,84,0.75)' }}>
                  {analyse.fehlendeZuordnung?.length
                    ? t('imp.fehltKurz', { felder: analyse.fehlendeZuordnung.map(feldText).join(', ') })
                    : t('imp.erkanntVon', { n: zugeordnet, gesamt: analyse.spalten.length })}
                  {spaltenSichtbar ? ' ▴' : ' ▾'}
                </span>
              </button>

              {spaltenSichtbar ? (
                <div className="mt-[8px] flex flex-col gap-[6px]">
                  {analyse.spalten.map((spalte) => {
                    const feld = analyse.zuordnung[spalte.index] || '';
                    const sicher = feld && (spalte.sicherheit >= 0.8 || spalte.grund?.vorlage);
                    return (
                      <div key={spalte.index} className="w-full bg-[#0f0f0f] border px-3 py-[8px] flex items-center gap-3" style={{ borderColor: feld ? (sicher ? 'rgba(227,246,84,0.45)' : ORANGE) : 'rgba(255,255,255,0.12)' }} data-tutorial={`import-spalte-${spalte.index}`}>
                        <div className="min-w-0 flex-1">
                          <div className={`text-[14px] font-bold truncate ${schrift}`} style={{ color: feld ? LIME : 'rgba(255,255,255,0.55)' }}>{spalte.titel}</div>
                          <div className={`text-[11px] font-medium truncate ${schrift} text-white/40`}>{spalte.beispiele.slice(0, 2).join(' · ')}</div>
                        </div>
                        <div className="relative shrink-0 w-[150px]">
                          <select
                            value={feld}
                            onChange={(e) => zuordnen(spalte.index, e.target.value)}
                            data-tutorial={`import-feld-${spalte.index}`}
                            title={grundText(spalte)}
                            className={`w-full h-[34px] appearance-none bg-black border pl-2 pr-7 text-[13px] font-medium ${schrift} outline-none`}
                            style={{ borderColor: feld ? LIME : 'rgba(255,255,255,0.25)', color: feld ? LIME : 'rgba(255,255,255,0.55)' }}
                          >
                            <option value="">{t('imp.nichtImportieren')}</option>
                            {analyse.felder.map((f) => <option key={f} value={f}>{t(`imp.feld.${f}`)}</option>)}
                          </select>
                          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px]" style={{ color: feld ? LIME : 'rgba(255,255,255,0.5)' }}>▾</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {/* Fahrten nach Tagen, Karten wie in "Alle Fahrten" */}
              <div className="mt-[22px] flex flex-col gap-[12px]">
                {gruppen.map((g, gi) => (
                  <Fragment key={g.tag || 'ohne'}>
                    <TagKopf iso={g.tag} erster={gi === 0} anzahl={g.saetze.filter((x) => !x.satz.aus).length} gaeste={g.gaeste} modus={modus} t={t} />
                    {g.saetze.map(({ satz: s, index }) => (
                      <ImportKarte
                        key={index}
                        satz={s}
                        modus={modus}
                        offen={offen === index}
                        oeffnen={() => setOffen(offen === index ? null : index)}
                        umschalten={() => setSaetze((alt) => alt.map((x, i) => (i === index ? { ...x, aus: !x.aus } : x)))}
                        aendern={(w) => satzAendern(index, w)}
                        adressen={adressen}
                        t={t}
                        feldText={feldText}
                        hinweisText={(h) => hinweisText(h, s)}
                      />
                    ))}
                  </Fragment>
                ))}
              </div>

            </div>
          ) : null}

          {/* --- 4. Fertig ---------------------------------------------- */}
          {schritt === 'fertig' ? (
            <>
              <div className={`mt-[28px] text-[18px] font-bold ${schrift}`} style={{ color: '#8DFFAF' }} data-tutorial="import-fertig">
                {t(config.fertigKey, { n: ergebnis?.anzahl || 0 })}
              </div>
              <button
                type="button"
                onClick={() => setView(config.zielView)}
                className="mt-[20px] w-full h-14 px-4 flex items-center justify-between"
                style={{ background: LIME }}
              >
                <span className={`text-[#1d1c1d] text-base font-medium ${schrift} tracking-wide`}>{t(config.zielKey)}</span>
                <PfeilIcon />
              </button>
              <button
                type="button"
                onClick={neuStarten}
                className="mt-[10px] w-full h-12 border-2 px-4 flex items-center justify-between"
                style={{ borderColor: LIME }}
              >
                <span className={`text-[14px] font-medium ${schrift}`} style={{ color: LIME }}>{t('imp.weitereDatei')}</span>
              </button>
              {ergebnis?.import_id && !rueckgaengigText ? (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => rueckgaengig(ergebnis.import_id)}
                  className="mt-[10px] w-full h-12 border-2 px-4 flex items-center justify-between"
                  style={{ borderColor: ORANGE }}
                >
                  <span className={`text-[14px] font-medium ${schrift}`} style={{ color: ORANGE }}>{t('imp.rueckgaengig')}</span>
                </button>
              ) : null}
              {rueckgaengigText ? <div className={`mt-[10px] text-[13px] font-medium ${schrift}`} style={{ color: '#8DFFAF' }}>{rueckgaengigText}</div> : null}
              {/* Weitere Blaetter derselben Datei (schon importierte Fahrten kommen als Dublette abgewaehlt). */}
              {analyse?.blaetter?.length > 1 && quelle ? analyse.blaetter.filter((b) => b.index !== analyse.blatt && (b.fahrten ?? 1) > 0).map((b) => (
                <button
                  key={b.index}
                  type="button"
                  onClick={() => { setErgebnis(null); setRueckgaengigText(''); auswerten(quelle, { blatt: b.index }); }}
                  className="mt-[10px] w-full h-12 border-2 px-4 flex items-center justify-between"
                  style={{ borderColor: LIME }}
                >
                  <span className={`text-[14px] font-medium truncate ${schrift}`} style={{ color: LIME }}>{t('imp.blattImportieren', { name: b.name })}</span>
                </button>
              )) : null}
            </>
          ) : null}

          {fehler ? (
            <div className={`mt-[16px] w-full border-2 bg-[#171717] px-3 py-2 text-[12px] leading-4 font-medium ${schrift}`} style={{ borderColor: 'rgba(255,205,138,0.6)', color: ORANGE }}>
              {fehler}
            </div>
          ) : null}
        </div>
      </div>

      {/* Importknopf fest unten ueber der Fusszeile */}
      {schritt === 'zuordnung' && analyse ? (
        <div className="absolute left-0 right-0 bottom-10 px-[20px] pt-[18px] pb-[10px] bg-gradient-to-t from-black via-black/95 to-transparent z-20">
          <button
            type="button"
            onClick={handleApply}
            disabled={isBusy || !bereit.length || neuBerechnen}
            data-tutorial="import-uebernehmen"
            className="w-full h-14 px-4 flex items-center justify-between disabled:opacity-40"
            style={{ background: LIME }}
          >
            <span className={`text-[#1d1c1d] text-base font-medium ${schrift} tracking-wide`}>
              {isBusy ? t('sonstige.uebernehme') : t(config.importKey, { n: bereit.length })}
            </span>
            <PfeilIcon />
          </button>
        </div>
      ) : null}

      <div className="absolute bottom-0 left-0 right-0">
        <TrisarFooter className="relative h-10 bg-black" />
      </div>
    </div>
  );
}
