import { useMemo, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { supabase } from '../../services/supabase';
import { useI18n } from '../../i18n';
import { tutorialLaeuft } from '../ui/demoDialoge';
import {
  fahrtenBauen,
  felderFuer,
  gaesteBauen,
  spaltenErkennen,
  tabelleAusText,
  tabelleLesen,
} from '../../services/spaltenErkennung';
import { importBeispiele } from '../../demo/importBeispiele';

// Import von Fahrten und Fahrgästen aus beliebigen Tabellen (Excel oder CSV).
// Kein festes Spaltenschema: jede Spalte wird erkannt, die Zuordnung als
// Vorschlag gezeigt und kann geändert werden. Erst dann wird importiert.
//
// Ablauf: Datei → Erkennung → Zuordnung prüfen → Vorschau → Import.

const MODES = {
  rides: {
    titleKey: 'sonstige.fahrtenImportTitle',
    table: 'jobs',
    // Zurueck fuehrt dorthin, woher der Import geoeffnet wird (Fahrt erstellen);
    // nach dem Import geht "Zu den Fahrten" in die Fahrtenliste.
    backView: 'fahrtAdd',
    zielView: 'ankuenfte',
    bauen: fahrtenBauen,
    importKey: 'imp.fahrtenImportieren',
    fertigKey: 'imp.fahrtenImportiert',
    zielKey: 'imp.zuDenFahrten',
    describe: (row) => `${(row.etd || '').slice(0, 5)} ${row.pickup_name || '—'} → ${row.dropoff_name || '—'}`,
    detail: (row) => [row.ride_date, row.flight_number || row.train_number, (row.passengers || []).join(', ')].filter(Boolean).join(' · '),
  },
  guests: {
    titleKey: 'sonstige.kundenImportTitle',
    table: 'guests',
    backView: 'alleKunden',
    zielView: 'alleKunden',
    bauen: gaesteBauen,
    importKey: 'imp.gaesteImportieren',
    fertigKey: 'imp.gaesteImportiert',
    zielKey: 'imp.zuDenFahrgaesten',
    describe: (row) => `${row.first_name} ${row.last_name}`.trim(),
    detail: (row) => [row.company, row.email, row.phone].filter(Boolean).join(' · '),
  },
};

const LIME = '#E3F654';
const ORANGE = '#ffcd8a';
const schrift = "font-['Space_Grotesk']";

// Kleine Pause, damit die Erkennung als eigener Schritt sichtbar ist.
const ERKENNUNG_MS = 1400;

const FunkenIcon = ({ drehen = false }) => (
  <svg viewBox="0 0 29 29.14" width="22" height="22" fill="none" className={drehen ? 'animate-pulse' : ''}>
    <path d="M12.08 29.07S11.27 16.99 0 16.99M12.08 4.9s.81 12.09 12.09 12.09M12.08 4.9S11.27 16.99 0 16.99M12.08 29.07s.81-12.08 12.09-12.08" stroke="currentColor" strokeWidth="2" />
    <path d="M22.96 12.15s-.41-6.04-6.04-6.04M22.96 12.15s.4-6.04 6.04-6.04M22.96.07s-.41 6.04-6.04 6.04M22.96.07s.4 6.04 6.04 6.04" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const PfeilIcon = () => (
  <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
);

export default function ImportView({ setView, mode = 'rides' }) {
  const { t } = useI18n();
  const config = MODES[mode] || MODES.rides;
  const felder = felderFuer(mode);
  const fileInputRef = useRef(null);

  // schritt: 'datei' | 'erkennung' | 'zuordnung' | 'fertig'
  const [schritt, setSchritt] = useState('datei');
  const [dateiname, setDateiname] = useState('');
  const [erkennung, setErkennung] = useState(null);
  const [zuordnung, setZuordnung] = useState({});
  const [fehler, setFehler] = useState('');
  const [importiert, setImportiert] = useState(0);
  const [isBusy, setIsBusy] = useState(false);

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  const auswerten = async (name, rohzeilenLaden) => {
    setFehler('');
    setDateiname(name);
    setSchritt('erkennung');
    try {
      const [rohzeilen] = await Promise.all([
        rohzeilenLaden(),
        new Promise((fertig) => setTimeout(fertig, ERKENNUNG_MS)),
      ]);
      const ergebnis = spaltenErkennen(rohzeilen, mode);
      if (!ergebnis.spalten.length || !ergebnis.datenzeilen.length) {
        setFehler(t('imp.leer'));
        setSchritt('datei');
        return;
      }
      setErkennung(ergebnis);
      setZuordnung(Object.fromEntries(
        ergebnis.spalten.filter((s) => s.vorschlag).map((s) => [s.index, s.vorschlag]),
      ));
      setSchritt('zuordnung');
    } catch (error) {
      setFehler(t('sonstige.dateiLesenFehler', { message: error.message }));
      setSchritt('datei');
    }
  };

  const handleFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    auswerten(file.name, () => tabelleLesen(file));
  };

  const beispielLaden = (beispiel) => {
    auswerten(beispiel.dateiname, async () => tabelleAusText(beispiel.inhalt));
  };

  // Eine Spalte einem Feld zuordnen. Ein Feld gehört immer nur einer Spalte —
  // wird es anderswo neu gewählt, verliert die alte Spalte die Zuordnung.
  const zuordnen = (spaltenIndex, feld) => {
    setZuordnung((alt) => {
      const neu = { ...alt };
      const belegt = felder.find((f) => f.key === feld)?.belegt || [];
      Object.entries(neu).forEach(([idx, f]) => {
        const kollidiert = f === feld
          || belegt.includes(f)
          || (felder.find((x) => x.key === f)?.belegt || []).includes(feld);
        if (feld && kollidiert && Number(idx) !== spaltenIndex) delete neu[idx];
      });
      if (feld) neu[spaltenIndex] = feld; else delete neu[spaltenIndex];
      return neu;
    });
  };

  const ergebnis = useMemo(
    () => (erkennung ? config.bauen(erkennung.datenzeilen, zuordnung) : { fertig: [], unvollstaendig: [] }),
    [erkennung, zuordnung, config],
  );

  const handleApply = async () => {
    if (!ergebnis.fertig.length) return;
    setIsBusy(true);
    setFehler('');
    try {
      const { error } = await supabase.from(config.table).insert(ergebnis.fertig);
      if (error) throw error;
      window.dispatchEvent(new CustomEvent('trisar:fahrten-geaendert'));
      setImportiert(ergebnis.fertig.length);
      setSchritt('fertig');
    } catch (error) {
      setFehler(t('sonstige.importFehlgeschlagen', { message: error.message }));
    } finally {
      setIsBusy(false);
    }
  };

  const neuStarten = () => {
    setSchritt('datei');
    setErkennung(null);
    setZuordnung({});
    setDateiname('');
    setFehler('');
  };

  const grundText = (spalte) => {
    const g = spalte.grund || {};
    if (!spalte.vorschlag) return t('imp.keinTreffer');
    const teile = [];
    if (g.kopf) teile.push(t('imp.grundKopf', { titel: g.kopf }));
    if (g.werte) teile.push(t('imp.grundWerte', { anteil: g.anteil, art: t(`imp.art.${g.werte}`) }));
    return teile.join(' · ');
  };

  const zugeordnet = erkennung ? erkennung.spalten.filter((s) => zuordnung[s.index]).length : 0;
  const fehlendeFelder = [...new Set(ergebnis.unvollstaendig.flatMap((u) => u.fehlt))];

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
                  // Im Demo-Tutorial darf keine Dateiauswahl aufgehen — sie haelt den Ablauf an.
                  if (tutorialLaeuft()) return;
                  fileInputRef.current?.click();
                }}
                data-tutorial="import-datei"
                className="mt-[24px] w-full h-14 px-4 flex items-center justify-between"
                style={{ background: LIME }}
              >
                <span className={`text-[#1d1c1d] text-base font-medium ${schrift} tracking-wide`}>{t('sonstige.dateiAuswaehlen')}</span>
                {/* Figma 2563:12437 — Import-Symbol, 42 x 40 */}
                <span className="block w-[42px] h-[40px] shrink-0 overflow-clip">
                  <img src="/icon/_Icon_Schwarz/import-datei.svg" alt="" className="block w-full h-full" />
                </span>
              </button>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,text/csv" className="hidden" onChange={handleFile} />

              {mode === 'rides' ? (
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
            </>
          ) : null}

          {/* --- 2. Erkennung -------------------------------------------- */}
          {schritt === 'erkennung' ? (
            <div className="mt-[40px] flex flex-col items-center text-center" data-tutorial="import-erkennung">
              <span style={{ color: LIME }}><FunkenIcon drehen /></span>
              <div className={`mt-[14px] text-[18px] font-bold ${schrift}`} style={{ color: LIME }}>{t('imp.erkennt')}</div>
              <div className={`mt-[6px] text-[12px] font-medium ${schrift} text-white/50`}>{dateiname}</div>
            </div>
          ) : null}

          {/* --- 3. Zuordnung und Vorschau ------------------------------- */}
          {schritt === 'zuordnung' && erkennung ? (
            <>
              <div className="mt-[20px] flex items-center justify-between">
                <span className={`text-[12px] font-medium ${schrift} text-white/50 truncate pr-3`}>{dateiname}</span>
                <button type="button" onClick={neuStarten} className={`shrink-0 text-[12px] font-medium ${schrift} underline`} style={{ color: LIME }}>
                  {t('imp.andereDatei')}
                </button>
              </div>

              <div className="mt-[20px] flex items-center gap-[10px]" style={{ color: LIME }}>
                <FunkenIcon />
                <div>
                  <div className={`text-[20px] font-bold leading-none ${schrift}`}>{t('imp.zuordnung')}</div>
                  <div className={`mt-[4px] text-[12px] font-medium ${schrift}`} style={{ color: 'rgba(227,246,84,0.7)' }}>
                    {t('imp.zugeordnetVon', { n: zugeordnet, gesamt: erkennung.spalten.length })}
                  </div>
                </div>
              </div>

              <div className="mt-[14px] flex flex-col gap-[8px]" data-tutorial="import-zuordnung">
                {erkennung.spalten.map((spalte) => {
                  const feld = zuordnung[spalte.index] || '';
                  const vorschlagGilt = feld && feld === spalte.vorschlag;
                  const sicher = vorschlagGilt && spalte.sicherheit >= 0.8;
                  const pruefen = vorschlagGilt && !sicher;
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
                          {felder.map((f) => (
                            <option key={f.key} value={f.key}>{t(`imp.feld.${f.key}`)}</option>
                          ))}
                        </select>
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: feld ? LIME : 'rgba(255,255,255,0.5)' }}>▾</span>
                      </div>

                      <div className={`mt-[6px] text-[10px] leading-[13px] font-medium ${schrift} text-white/40`}>
                        {feld && !vorschlagGilt ? t('imp.vonHandGeaendert') : grundText(spalte)}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className={`mt-[24px] text-[20px] font-bold ${schrift}`} style={{ color: LIME }}>{t('imp.vorschau')}</div>
              <div className={`mt-[4px] text-[12px] font-medium ${schrift}`} style={{ color: 'rgba(227,246,84,0.7)' }}>
                {t('imp.bereit', { n: ergebnis.fertig.length })}
                {ergebnis.unvollstaendig.length ? (
                  <span style={{ color: ORANGE }}>
                    {' · '}
                    {t('imp.unvollstaendig', {
                      n: ergebnis.unvollstaendig.length,
                      felder: fehlendeFelder.map((f) => t(`imp.feld.${f === 'name' ? 'vollname' : f}`)).join(', '),
                    })}
                  </span>
                ) : null}
              </div>

              <div className="mt-[10px] space-y-[6px]" data-tutorial="import-vorschau">
                {ergebnis.fertig.slice(0, 20).map((row, index) => (
                  <div key={index} className="w-full border-2 bg-[#0f0f0f] px-3 py-2" style={{ borderColor: 'rgba(227,246,84,0.4)' }}>
                    <div className={`text-[14px] font-medium truncate ${schrift}`} style={{ color: LIME }}>{config.describe(row)}</div>
                    {config.detail(row) ? (
                      <div className={`text-[11px] font-medium truncate ${schrift} text-white/50`}>{config.detail(row)}</div>
                    ) : null}
                  </div>
                ))}
                {ergebnis.fertig.length > 20 ? (
                  <div className={`text-[12px] font-medium ${schrift} text-white/50`}>{t('sonstige.weitereDatensaetze', { n: ergebnis.fertig.length - 20 })}</div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleApply}
                disabled={isBusy || !ergebnis.fertig.length}
                data-tutorial="import-uebernehmen"
                className="mt-[16px] w-full h-14 px-4 flex items-center justify-between disabled:opacity-40"
                style={{ background: LIME }}
              >
                <span className={`text-[#1d1c1d] text-base font-medium ${schrift} tracking-wide`}>
                  {isBusy ? t('sonstige.uebernehme') : t(config.importKey, { n: ergebnis.fertig.length })}
                </span>
                <PfeilIcon />
              </button>
            </>
          ) : null}

          {/* --- 4. Fertig ---------------------------------------------- */}
          {schritt === 'fertig' ? (
            <>
              <div className={`mt-[28px] text-[18px] font-bold ${schrift}`} style={{ color: '#8DFFAF' }} data-tutorial="import-fertig">
                {t(config.fertigKey, { n: importiert })}
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
