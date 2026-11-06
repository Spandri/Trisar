import { useEffect, useMemo, useRef, useState } from 'react';
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

const datumKurz = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(2, 4)}` : '');
const datumLang = (iso) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');

const Feld = ({ label, value, onChange, typ = 'text', breit = true }) => (
  <label className={`flex flex-col gap-[3px] ${breit ? 'col-span-2' : ''}`}>
    <span className={`text-[10px] font-medium ${schrift} text-white/50`}>{label}</span>
    <input
      type={typ}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={`h-[34px] bg-black border border-white/25 px-2 text-[13px] font-medium ${schrift} text-white outline-none focus:border-[#E3F654]`}
    />
  </label>
);

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

  const fahrtZeile = (s) => {
    const d = s.daten;
    return {
      titel: `${(d.etd || '--:--').slice(0, 5)} ${d.pickup_name || d.pickup_address || '—'} → ${d.dropoff_name || d.dropoff_address || '—'}`,
      detail: [datumKurz(d.ride_date), d.flight_number || d.train_number, (d.passengers || []).join(', '), d.anzahl ? `${d.anzahl} P.` : ''].filter(Boolean).join(' · '),
    };
  };
  const gastZeile = (s) => ({
    titel: `${s.daten.first_name || ''} ${s.daten.last_name || ''}`.trim() || '—',
    detail: [s.daten.company, s.daten.email, s.daten.phone].filter(Boolean).join(' · '),
  });

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden overscroll-none" style={gradientStyle}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none pb-[90px]">
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
              <div className="mt-[20px] flex items-center justify-between">
                <span className={`text-[12px] font-medium ${schrift} text-white/50 truncate pr-3`}>{analyse.dateiname}</span>
                <button type="button" onClick={neuStarten} className={`shrink-0 text-[12px] font-medium ${schrift} underline`} style={{ color: LIME }}>
                  {t('imp.andereDatei')}
                </button>
              </div>

              {/* Mehrere Tabellenblaetter: das passende ist gewaehlt, wechseln geht. */}
              {analyse.blaetter.length > 1 ? (
                <div className="mt-[14px]">
                  <div className={`text-[11px] font-medium ${schrift} text-white/50`}>{t('imp.blatt')}</div>
                  <div className="mt-[6px] flex flex-wrap gap-[6px]">
                    {analyse.blaetter.map((b) => (
                      <button
                        key={b.index}
                        type="button"
                        onClick={() => b.index !== analyse.blatt && blattWechseln(b.index)}
                        className={`h-[30px] px-3 border text-[12px] font-medium ${schrift}`}
                        style={b.index === analyse.blatt ? { background: LIME, color: '#000', borderColor: LIME } : { borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.7)' }}
                      >
                        {b.name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {analyse.vorlage ? (
                <div className={`mt-[14px] border-l-2 pl-3 text-[12px] leading-4 font-medium ${schrift}`} style={{ borderColor: '#8DFFAF', color: '#8DFFAF' }}>
                  {t('imp.vorlageGenutzt', { name: analyse.vorlage.name || '' })}
                </div>
              ) : null}
              {analyse.kontext?.datum || analyse.kontext?.ziel ? (
                <div className={`mt-[14px] border-l-2 pl-3 text-[12px] leading-4 font-medium ${schrift}`} style={{ borderColor: LIME, color: 'rgba(227,246,84,0.85)' }}>
                  {[
                    analyse.kontext.datum ? t('imp.kontextDatum', { datum: datumLang(analyse.kontext.datum) }) : '',
                    analyse.kontext.ziel ? t('imp.kontextZiel', { ziel: analyse.kontext.ziel }) : '',
                  ].filter(Boolean).join(' ')}
                </div>
              ) : null}
              {analyse.llama?.genutzt ? (
                <div className={`mt-[14px] border-l-2 pl-3 text-[12px] leading-4 font-medium ${schrift}`} style={{ borderColor: ORANGE, color: ORANGE }}>
                  {t('imp.llamaGenutzt')}
                </div>
              ) : null}

              <div className="mt-[20px] flex items-center gap-[10px]" style={{ color: LIME }}>
                <FunkenIcon />
                <div>
                  <div className={`text-[20px] font-bold leading-none ${schrift}`}>{t('imp.zuordnung')}</div>
                  <div className={`mt-[4px] text-[12px] font-medium ${schrift}`} style={{ color: 'rgba(227,246,84,0.7)' }}>
                    {t('imp.zugeordnetVon', { n: zugeordnet, gesamt: analyse.spalten.length })}
                  </div>
                </div>
              </div>

              {analyse.fehlendeZuordnung?.length ? (
                <div className={`mt-[10px] text-[12px] leading-4 font-medium ${schrift}`} style={{ color: ORANGE }}>
                  {t('imp.pflichtFehlt', { felder: analyse.fehlendeZuordnung.map(feldText).join(', ') })}
                </div>
              ) : null}

              <div className="mt-[14px] flex flex-col gap-[8px]" data-tutorial="import-zuordnung">
                {analyse.spalten.map((spalte) => {
                  const feld = analyse.zuordnung[spalte.index] || '';
                  const sicher = feld && (spalte.sicherheit >= 0.8 || spalte.grund?.vorlage);
                  const pruefen = feld && !sicher;
                  return (
                    <div
                      key={spalte.index}
                      className="w-full border-2 bg-[#0f0f0f] px-3 py-[10px]"
                      style={{ borderColor: feld ? 'rgba(227,246,84,0.55)' : 'rgba(255,255,255,0.12)' }}
                      data-tutorial={`import-spalte-${spalte.index}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={`text-[15px] font-bold truncate ${schrift}`} style={{ color: feld ? LIME : 'rgba(255,255,255,0.55)' }}>
                          {spalte.titel}
                        </span>
                        {sicher ? (
                          <span className={`shrink-0 px-[8px] h-[20px] flex items-center text-[10px] font-bold ${schrift}`} style={{ background: LIME, color: '#000' }}>{t('imp.sicher')}</span>
                        ) : null}
                        {pruefen ? (
                          <span className={`shrink-0 px-[8px] h-[20px] flex items-center text-[10px] font-bold ${schrift}`} style={{ background: ORANGE, color: '#000' }}>{t('imp.pruefen')}</span>
                        ) : null}
                      </div>

                      <div className={`mt-[3px] text-[11px] font-medium truncate ${schrift} text-white/45`}>
                        {spalte.beispiele.slice(0, 3).join(' · ')}
                      </div>

                      <div className="mt-[8px] relative">
                        <select
                          value={feld}
                          onChange={(e) => zuordnen(spalte.index, e.target.value)}
                          data-tutorial={`import-feld-${spalte.index}`}
                          className={`w-full h-[38px] appearance-none bg-black border pl-3 pr-9 text-[14px] font-medium ${schrift} outline-none`}
                          style={{ borderColor: feld ? LIME : 'rgba(255,255,255,0.25)', color: feld ? LIME : 'rgba(255,255,255,0.6)' }}
                        >
                          <option value="">{t('imp.nichtImportieren')}</option>
                          {analyse.felder.map((f) => (
                            <option key={f} value={f}>{t(`imp.feld.${f}`)}</option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: feld ? LIME : 'rgba(255,255,255,0.5)' }}>▾</span>
                      </div>

                      <div className={`mt-[6px] text-[10px] leading-[13px] font-medium ${schrift} text-white/40`}>
                        {grundText(spalte)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={`mt-[24px] text-[20px] font-bold ${schrift}`} style={{ color: LIME }}>{t('imp.vorschau')}</div>
              <div className={`mt-[4px] text-[12px] leading-4 font-medium ${schrift}`} style={{ color: 'rgba(227,246,84,0.7)' }}>
                {t('imp.bereit', { n: bereit.length })}
                {unvollstaendig.length ? <span style={{ color: ROT }}>{' · '}{t('imp.unvollstaendigKurz', { n: unvollstaendig.length })}</span> : null}
              </div>
              {modus === 'rides' && !DEMO_MODE ? (
                <div className={`mt-[2px] text-[11px] font-medium ${schrift} text-white/45`}>
                  {adressStand ? t('imp.adressenOk', { n: adressStand.gefunden, gesamt: adressStand.gesamt }) : t('imp.adressenPruefen')}
                </div>
              ) : null}

              <div className="mt-[10px] space-y-[6px]" data-tutorial="import-vorschau">
                {mitAdressen.map((s, index) => {
                  const z = modus === 'rides' ? fahrtZeile(s) : gastZeile(s);
                  const warnt = s.hinweise.some((h) => WARNUNGEN.has(h));
                  const rand = s.aus ? 'rgba(255,255,255,0.1)' : s.fehlt.length ? ROT : warnt ? ORANGE : 'rgba(227,246,84,0.4)';
                  const istOffen = offen === index;
                  return (
                    <div key={index} className="w-full border-2 bg-[#0f0f0f]" style={{ borderColor: rand, opacity: s.aus ? 0.5 : 1 }}>
                      <div className="flex items-start gap-2 px-3 py-2">
                        <input
                          type="checkbox"
                          checked={!s.aus}
                          onChange={() => setSaetze((alt) => alt.map((x, i) => (i === index ? { ...x, aus: !x.aus } : x)))}
                          className="mt-[3px] accent-[#E3F654] w-4 h-4 shrink-0"
                          aria-label={t('imp.mitImportieren')}
                        />
                        <button type="button" onClick={() => setOffen(istOffen ? null : index)} className="min-w-0 flex-1 text-left">
                          <div className={`text-[14px] font-medium truncate ${schrift}`} style={{ color: LIME }}>{z.titel}</div>
                          {z.detail ? <div className={`text-[11px] font-medium truncate ${schrift} text-white/50`}>{z.detail}</div> : null}
                          {s.fehlt.length ? (
                            <div className={`text-[11px] font-medium ${schrift}`} style={{ color: ROT }}>{t('imp.fehltFeld', { felder: s.fehlt.map(feldText).join(', ') })}</div>
                          ) : null}
                          {s.hinweise.length ? (
                            <div className={`text-[11px] font-medium ${schrift}`} style={{ color: warnt ? ORANGE : 'rgba(255,255,255,0.45)' }}>
                              {s.hinweise.map((h) => hinweisText(h, s)).join(' · ')}
                            </div>
                          ) : null}
                        </button>
                        <span className={`shrink-0 text-[11px] font-medium ${schrift} text-white/40`}>{istOffen ? '▴' : '✎'}</span>
                      </div>

                      {istOffen ? (
                        <div className="px-3 pb-3 grid grid-cols-2 gap-[8px] border-t border-white/10 pt-2">
                          {modus === 'rides' ? (
                            <>
                              <Feld breit={false} typ="date" label={feldText('datum')} value={s.daten.ride_date} onChange={(v) => satzAendern(index, { ride_date: v || null })} />
                              <Feld breit={false} typ="time" label={feldText('uhrzeit')} value={(s.daten.etd || '').slice(0, 5)} onChange={(v) => satzAendern(index, { etd: v ? `${v}:00` : null, original_etd: v ? `${v}:00` : null })} />
                              <Feld label={feldText('abholort')} value={s.daten.pickup_address} onChange={(v) => satzAendern(index, { pickup_address: v, pickup_name: K.kurzname(v) })} />
                              <Feld label={feldText('zielort')} value={s.daten.dropoff_address} onChange={(v) => satzAendern(index, { dropoff_address: v, dropoff_name: K.kurzname(v) })} />
                              <Feld breit={false} label={feldText('flugnummer')} value={s.daten.flight_number || s.daten.train_number} onChange={(v) => satzAendern(index, /^(ICE|IC|EC|RJ|RE|RB)\s?\d/i.test(v) ? { train_number: v, flight_number: null } : { flight_number: v, train_number: null })} />
                              <Feld breit={false} typ="number" label={feldText('anzahl')} value={s.daten.anzahl ?? ''} onChange={(v) => satzAendern(index, { anzahl: v ? Number(v) : null })} />
                              <Feld label={feldText('gaeste')} value={(s.daten.passengers || []).join(', ')} onChange={(v) => satzAendern(index, { passengers: v.split(/\s*,\s*/).filter(Boolean) })} />
                              <Feld label={feldText('notiz')} value={s.daten.note} onChange={(v) => satzAendern(index, { note: v })} />
                              {adressen ? [s.daten.pickup_address, s.daten.dropoff_address].filter((a) => a && adressen[a]?.gefunden).map((a) => (
                                <div key={a} className={`col-span-2 text-[10px] leading-[13px] font-medium ${schrift} text-white/40`}>{a} → {adressen[a].name}</div>
                              )) : null}
                            </>
                          ) : (
                            <>
                              <Feld breit={false} label={feldText('vorname')} value={s.daten.first_name} onChange={(v) => satzAendern(index, { first_name: v })} />
                              <Feld breit={false} label={feldText('nachname')} value={s.daten.last_name} onChange={(v) => satzAendern(index, { last_name: v })} />
                              <Feld label={feldText('email')} value={s.daten.email} onChange={(v) => satzAendern(index, { email: v || null })} />
                              <Feld breit={false} label={feldText('telefon')} value={s.daten.phone} onChange={(v) => satzAendern(index, { phone: v || null })} />
                              <Feld breit={false} label={feldText('firma')} value={s.daten.company} onChange={(v) => satzAendern(index, { company: v || null })} />
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleApply}
                disabled={isBusy || !bereit.length}
                data-tutorial="import-uebernehmen"
                className="mt-[16px] w-full h-14 px-4 flex items-center justify-between disabled:opacity-40"
                style={{ background: LIME }}
              >
                <span className={`text-[#1d1c1d] text-base font-medium ${schrift} tracking-wide`}>
                  {isBusy ? t('sonstige.uebernehme') : t(config.importKey, { n: bereit.length })}
                </span>
                <PfeilIcon />
              </button>
              {unvollstaendig.length ? (
                <div className={`mt-[6px] text-[11px] leading-4 font-medium ${schrift} text-white/45`}>{t('imp.unvollstaendigHinweis')}</div>
              ) : null}
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

      <div className="absolute bottom-0 left-0 right-0">
        <TrisarFooter className="relative h-10 bg-black" />
      </div>
    </div>
  );
}
