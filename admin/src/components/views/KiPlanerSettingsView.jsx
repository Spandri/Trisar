import { useMemo, useRef } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { useI18n } from '../../i18n';

// Planungsregeln für den KI Planer (Figma 2407:11491): je Regel ein Schieber
// mit Minus/Plus, darunter Bezeichnung samt Wert und ein Erklärtext.
// Die Werte gehen unverändert an den CP-SAT-Solver und wirken dort wirklich —
// Grenzen orientieren sich am Arbeitszeitgesetz für angestellte Fahrer:
//   • Regelarbeitszeit 8 h, Verlängerung auf 10 h zulässig (§ 3 ArbZG)
//   • Ruhezeit zwischen zwei Schichten mindestens 11 h (§ 5 ArbZG)

export const DEFAULT_PLANNER_SETTINGS = {
  mode: 'balanced',
  maxWorkHours: 8,
  minWorkHours: 3,
  bufferMinutes: 20,
  // Nur noch Rueckfall, falls eine Fahrt ausnahmsweise keine echte Fahrzeit
  // hinterlegt hat — regulaer kommt die Dauer aus den Routendaten (TomTom,
  // inkl. tageszeitabhaengiger Stauprognose).
  rideDurationMinutes: 80,
  // Alle Fahrer des Bestands — die echte Planung soll den ganzen Pool nutzen.
  driverPool: 101,
  // Mindestpause zwischen den beiden Blöcken eines geteilten Dienstes.
  minPauseHours: 3,
  // Ruhezeit zwischen zwei Einsatztagen (§ 5 ArbZG).
  restHours: 11,
  // Abbruchkriterium ist die Lösungsgüte (max. Abstand zum Optimum in %),
  // nicht die Rechenzeit. 0 % = bis beweisbar optimal — das kann bei vollen
  // Tagen sehr lange dauern, deshalb ist 5 % die Voreinstellung.
  qualityGapPercent: 5,
};

// Ein Regler je Planungsregel. `format` erzeugt den Wert im Label.
const REGLER = [
  {
    key: 'maxWorkHours',
    min: 3, max: 10, step: 0.5,
    labelKey: 'planer.maxShiftLength',
    hintKey: 'planer.maxShiftLengthHint',
    format: (v) => `${String(v).replace('.', ',')} h`,
  },
  {
    key: 'minWorkHours',
    min: 3, max: 10, step: 0.5,
    labelKey: 'planer.minShiftLength',
    hintKey: 'planer.minShiftLengthHint',
    format: (v) => `${String(v).replace('.', ',')} h`,
  },
  {
    key: 'bufferMinutes',
    min: 0, max: 60, step: 5,
    labelKey: 'planer.bufferBeforeRide',
    hintKey: 'planer.bufferBeforeRideHint',
    format: (v) => `${v} min`,
  },
  {
    key: 'minPauseHours',
    min: 3, max: 8, step: 0.5,
    labelKey: 'planer.splitPause',
    hintKey: 'planer.splitPauseHint',
    format: (v) => `${String(v).replace('.', ',')} h`,
  },
  {
    key: 'restHours',
    min: 11, max: 16, step: 0.5,
    labelKey: 'planer.restBetweenDays',
    hintKey: 'planer.restBetweenDaysHint',
    format: (v) => `${String(v).replace('.', ',')} h`,
  },
  {
    key: 'driverPool',
    // Obergrenze ist der tatsaechliche Fahrerbestand (siehe driverCount).
    min: 1, max: 101, step: 1, maxAusBestand: true,
    labelKey: 'planer.driverPool',
    hintKey: 'planer.driverPoolHint',
    format: (v) => String(v),
  },
  {
    key: 'qualityGapPercent',
    min: 0, max: 20, step: 1,
    labelKey: 'planer.qualityGap',
    hintKey: 'planer.qualityGapHint',
    // 0 % bedeutet: bis beweisbar optimal.
    format: (v, t) => (v === 0 ? t('planer.qualityOptimal') : `≤ ${v} %`),
  },
];

const runden = (wert, step) => Math.round(wert / step) * step;
const sauber = (wert) => Math.round(wert * 100) / 100;

// Ein Schieber: Minus, Schiene mit Knopf, Plus — Wert folgt dem Ziehen sofort.
function Regler({ wert, min, max, step, onChange, ariaLabel }) {
  const schieneRef = useRef(null);
  const ziehtRef = useRef(false);

  const anteil = Math.max(0, Math.min(1, (wert - min) / (max - min)));

  const ausPointer = (clientX) => {
    const box = schieneRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return null;
    const p = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
    return sauber(Math.max(min, Math.min(max, runden(min + p * (max - min), step))));
  };

  const setzen = (clientX) => {
    const v = ausPointer(clientX);
    if (v != null) onChange(v);
  };

  return (
    <div className="flex items-center gap-[14px] select-none">
      <button
        type="button"
        aria-label="−"
        onClick={() => onChange(sauber(Math.max(min, wert - step)))}
        className="w-[23px] h-[23px] flex items-center justify-center flex-shrink-0"
      >
        <span className="block w-[23px] h-[3px] bg-[#E3F654]" />
      </button>

      <div
        ref={schieneRef}
        role="slider"
        tabIndex={0}
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={wert}
        onPointerDown={(e) => {
          ziehtRef.current = true;
          try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* egal */ }
          setzen(e.clientX);
        }}
        onPointerMove={(e) => { if (ziehtRef.current) setzen(e.clientX); }}
        onPointerUp={(e) => {
          ziehtRef.current = false;
          try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch { /* egal */ }
        }}
        onPointerCancel={() => { ziehtRef.current = false; }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onChange(sauber(Math.max(min, wert - step)));
          if (e.key === 'ArrowRight') onChange(sauber(Math.min(max, wert + step)));
        }}
        className="relative flex-1 h-[27px] cursor-pointer touch-none"
      >
        {/* Schiene: links gefüllt (Lime), rechts offen (grau) */}
        <span className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[2px] bg-[#3f4436]" />
        <span
          className="absolute left-0 top-1/2 -translate-y-1/2 h-[2px] bg-[#E3F654]"
          style={{ width: `${anteil * 100}%` }}
        />
        <span
          className="absolute top-1/2 w-[27px] h-[27px] rounded-full bg-[#E3F654] pointer-events-none"
          style={{ left: `${anteil * 100}%`, transform: 'translate(-50%, -50%)' }}
        />
      </div>

      <button
        type="button"
        aria-label="+"
        onClick={() => onChange(sauber(Math.min(max, wert + step)))}
        className="relative w-[23px] h-[23px] flex items-center justify-center flex-shrink-0"
      >
        <span className="absolute w-[23px] h-[3px] bg-[#E3F654]" />
        <span className="absolute w-[3px] h-[23px] bg-[#E3F654]" />
      </button>
    </div>
  );
}

export default function KiPlanerSettingsView({
  settings = {},
  onChangeSettings = () => {},
  onClose = () => {},
  // Anzahl verfuegbarer Fahrer — begrenzt den Fahrerpool-Regler.
  driverCount = 0,
}) {
  const { t } = useI18n();
  const current = { ...DEFAULT_PLANNER_SETTINGS, ...settings };

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  // Min- und Max-Schichtlänge sind gekoppelt: schiebt man die Mindestlänge
  // über das Maximum, wandert das Maximum mit (beide dürfen gleich sein).
  const update = (key, value) => {
    const next = { ...current, [key]: value };
    if (key === 'minWorkHours' && value > next.maxWorkHours) next.maxWorkHours = value;
    if (key === 'maxWorkHours' && value < next.minWorkHours) next.minWorkHours = value;
    onChangeSettings(next);
  };

  return (
    <div className="fixed inset-0 z-[260] bg-black">
      <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
        <div className="h-full overflow-y-auto overscroll-none pb-[90px]">
          <div className="px-[20px] pt-[60px]">
            <BackCircleButton onClick={onClose} className="block" />

            <h1 className="mt-[30px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk'] tracking-[-0.5px]">
              {t('planer.settingsTitle')}
            </h1>

            <div className="mt-[24px] flex flex-col gap-[42px]">
              {REGLER.map((regel) => {
                const max = regel.maxAusBestand && driverCount > 0
                  ? Math.max(regel.min, driverCount)
                  : regel.max;
                const wert = Math.min(max, Number(current[regel.key] ?? regel.min));
                return (
                  <div key={regel.key}>
                    <Regler
                      wert={wert}
                      min={regel.min}
                      max={max}
                      step={regel.step}
                      onChange={(v) => update(regel.key, v)}
                      ariaLabel={t(regel.labelKey)}
                    />

                    <p className="mt-[12px] text-center text-[#E3F654] text-[20px] leading-[26px] font-bold font-['Space_Grotesk'] tracking-[-0.3px]">
                      {`${t(regel.labelKey)} ${regel.format(wert, t)}`}
                    </p>
                    <p className="mt-[6px] text-center text-white/45 text-[11px] leading-[15px] font-medium font-['Space_Grotesk']">
                      {t(regel.hintKey)}
                    </p>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="mt-[40px] w-full h-[52px] bg-[#E3F654] border-2 border-[#E3F654] px-4 flex items-center"
            >
              <span className="text-[#1d1c1d] text-[16px] font-medium font-['Space_Grotesk'] tracking-wide">
                {t('planer.applySettings')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => onChangeSettings({ ...DEFAULT_PLANNER_SETTINGS })}
              className="mt-[10px] w-full h-[52px] border-2 border-[#E3F654] px-4 flex items-center"
            >
              <span className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk'] tracking-wide">
                {t('planer.resetDefaults')}
              </span>
            </button>
          </div>
        </div>

        <div className="absolute bottom-0 left-0 right-0">
          <TrisarFooter className="relative h-10 bg-black" />
        </div>
      </div>
    </div>
  );
}
