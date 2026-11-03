// Fahrzeug-Kacheln (Kraftstoff, Farbe, Energie, Sitze) für Admin- UND Fahrer-App.
// Diese Datei ist in beiden Apps identisch — bei Änderungen synchron halten
// (gleiche Regel wie für src/demo/demoClient.js).
//
// Die Badges rendern in einer 36-px-Basis; über `size` wird der Inhalt
// proportional skaliert (Admin-Liste 36 px, Fahrer-App 52 px).

import { DEMO_MODE } from '../datenquelle';

const CARD_OUTLINE_URL = '/icon/_Icon_Schwarz/card-outline-52.svg';
const E10_URL = '/icon/_Icon_Schwarz/E10_Tank_Trisar_Icons_01.svg';
const E95_URL = '/icon/_Icon_Schwarz/E95_Tank_Trisar_Icons_01.svg?v=1';
const E98_URL = '/icon/_Icon_Schwarz/E98_Tank_Trisar_Icons_01.svg?v=1';
const BLITZ_URL = '/icon/_Icon_Schwarz/Blitz_Trisar_Icons_01.svg';
// Drei Ladezustands-Icons: voll, mittel, niedrig.
const BATTERY_FULL_URL = '/icon/_Icon_Green/100xBatterie_Trisar_Icon_01_green.svg';
const BATTERY_MID_URL = '/icon/_Icon_Green/40xBatterie_Trisar_Icon_01_green.svg';
const BATTERY_LOW_URL = '/icon/_Icon_Green/20xBatterie_Trisar_Icon_01_green.svg';
const PUMP_URL = '/icon/_Icon_Schwarz/Zapfsaeule_Trisar_Icons_01.svg';

const BASE_SIZE = 36;

// Antriebs-Chip: Elektro/Hybrid als Blitz, Verbrenner als Kraftstoff-Label.
// Diesel folgt der EN-590-Kennzeichnung (B7 = bis 7 % Biodiesel, B10 = bis 10 %).
export const resolveFuelBadge = (fuelTypeValue) => {
  const fuel = String(fuelTypeValue || '').trim().toLowerCase();
  if (!fuel || fuel === 'e10') return { icon: E10_URL };
  if (fuel.includes('elektr') || fuel === 'ev' || fuel === 'bev' || fuel.includes('hybrid')) {
    return { icon: BLITZ_URL };
  }
  if (fuel.includes('b10')) return { label: 'B10' };
  if (fuel.includes('diesel') || fuel.includes('b7')) return { label: 'B7' };
  if (fuel.includes('plus') || fuel.includes('98')) return { icon: E98_URL };
  if (fuel.includes('95') || fuel.includes('super') || fuel.includes('e5')) return { icon: E95_URL };
  return { label: String(fuelTypeValue).trim().slice(0, 3) };
};

export const isElectricFuel = (fuelTypeValue) => {
  const fuel = String(fuelTypeValue || '').trim().toLowerCase();
  return fuel.includes('elektr') || fuel === 'ev' || fuel === 'bev';
};

export const resolveSeatIconUrl = (seatCountValue) => {
  const parsed = Number.parseInt(String(seatCountValue ?? '').trim(), 10);
  const clamped = Number.isFinite(parsed) ? Math.min(8, Math.max(3, parsed)) : null;
  if (clamped) return `/icon/_Icon_Schwarz/${clamped}x_Person_Trisar_Icons_01.svg`;
  return '/icon/_Icon_Schwarz/Person_Trisar_Icons_01.svg';
};

export const resolveCarColor = (value) => {
  if (!value || typeof value !== 'string') return '#0d0d0d';
  const v = value.trim().toLowerCase();
  const map = {
    black: '#0d0d0d', schwarz: '#0d0d0d',
    white: '#f3f4f6', weiss: '#f3f4f6',
    silber: '#c4c6c8', silver: '#c4c6c8',
    grau: '#8b8e93', gray: '#8b8e93', grey: '#8b8e93',
    blau: '#1d4ed8', blue: '#1d4ed8',
    rot: '#b91c1c', red: '#b91c1c',
    gruen: '#15803d', green: '#15803d',
  };
  if (map[v]) return map[v];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) return value.trim();
  // Zusammengesetzte Lackierungen (z.B. "Alpinweiß", "Portimao Blau") über
  // Teilstrings auf Grundfarben abbilden.
  if (/wei(ß|ss)/.test(v)) return '#f3f4f6';
  if (v.includes('blau') || v.includes('blue')) return '#1d4ed8';
  if (v.includes('rot') || v.includes('red')) return '#b91c1c';
  if (/gr(ü|ue)n/.test(v) || v.includes('green')) return '#15803d';
  if (v.includes('bronze')) return '#8a6d55';
  if (v.includes('grau') || v.includes('grey') || v.includes('gray')) return '#8b8e93';
  if (v.includes('silber') || v.includes('silver')) return '#c4c6c8';
  return '#0d0d0d';
};

// Demo-Füllstand deterministisch aus der VIN ableiten (kein Zufall, damit der
// Wert einen Reload übersteht, pro Fahrzeug stabil bleibt und in Admin- und
// Fahrer-App identisch ist): 15–95 %.
export const demoFillPercent = (seed) => {
  const text = String(seed || 'x');
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return 15 + (h % 81);
};

// Rahmen einer Kachel; der Inhalt wird aus der 36-px-Basis hochskaliert.
export function BadgeFrame({ size = BASE_SIZE, children }) {
  const factor = size / BASE_SIZE;
  return (
    <div className="relative" style={{ width: `${size}px`, height: `${size}px` }}>
      <img src={CARD_OUTLINE_URL} alt="" className="w-full h-full" />
      <div className="absolute inset-0 flex items-center justify-center">
        <div style={{ transform: `scale(${factor})` }}>{children}</div>
      </div>
    </div>
  );
}

// Kraftstoff-Label im Figma-Rahmen (Nodes 2379:11634 / 2383:11670): schwarzer
// Rundrahmen mit fettem Label, für Diesel B7 und B10.
function FuelLabel({ label }) {
  return (
    <div className="relative w-[23px] h-[20px]">
      <svg viewBox="0 0 37.85 32.81" className="absolute inset-0 w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M31.77 0H6.09C2.73 0 0 2.73 0 6.09V26.72C0 30.08 2.73 32.81 6.09 32.81H31.76C35.12 32.81 37.85 30.08 37.85 26.72V6.09C37.85 2.73 35.12 0 31.76 0H31.77ZM34.36 26.73C34.36 28.16 33.2 29.32 31.77 29.32H6.09C4.66 29.32 3.5 28.16 3.5 26.73V6.09C3.5 4.66 4.66 3.5 6.09 3.5H31.76C33.19 3.5 34.35 4.66 34.35 6.09V26.72L34.36 26.73Z"
          fill="#12120D"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[9px] leading-none font-bold text-black font-['Space_Grotesk']">
        {label}
      </span>
    </div>
  );
}

export function FuelBadge({ fuelType, size = BASE_SIZE }) {
  const badge = resolveFuelBadge(fuelType);
  return (
    <BadgeFrame size={size}>
      {badge.icon ? (
        <img src={badge.icon} alt={fuelType || ''} className="w-[23px] h-[23px] object-contain" />
      ) : (
        <FuelLabel label={badge.label} />
      )}
    </BadgeFrame>
  );
}

export function ColorBadge({ color, size = BASE_SIZE }) {
  return (
    <BadgeFrame size={size}>
      <div className="w-[23px] h-[23px] rounded-full" style={{ backgroundColor: resolveCarColor(color) }} />
    </BadgeFrame>
  );
}

export function SeatBadge({ seatCount, size = BASE_SIZE }) {
  return (
    <BadgeFrame size={size}>
      <img src={resolveSeatIconUrl(seatCount)} alt="" className="w-[23px] h-[23px] object-contain" />
    </BadgeFrame>
  );
}

// Energie-Kachel: Elektro behält die Batterie, Verbrenner bekommt die
// Tankanzeige nach Figma (Zapfsäule 1258:6868, Füllbalken 1258:6869,
// Text 1258:6870) — der schwarze Balken steigt prozentual zum Füllstand.
//
// Datenquelle ist die `vehicles`-Tabelle: `fillPercent` kommt aus
// `battery_fuel_percent`, `fullRangeKm` aus `range_km` (Reichweite bei 100 %).
// Schreibt später Telematik echte Werte in die Spalten, zeigt die Kachel sie
// automatisch live an (die Fahrzeuglisten abonnieren `vehicles` via Realtime).
// Nur wenn die Spalte leer ist, greift in der Demo der deterministische
// Demo-Füllstand; im Betrieb steht dann "–" (kein erfundener Wert).
export function EnergyBadge({ fuelType, seed, fillPercent = null, fullRangeKm = null, size = BASE_SIZE }) {
  const parsedFill = Number.parseFloat(fillPercent);
  const fill = Number.isFinite(parsedFill)
    ? Math.max(0, Math.min(100, Math.round(parsedFill)))
    : (DEMO_MODE ? demoFillPercent(seed) : null);
  const unbekannt = fill == null;
  const parsedRange = Number.parseFloat(fullRangeKm);

  if (isElectricFuel(fuelType)) {
    // Ladezustand sichtbar: Icon nach Fuellstand, darunter Restreichweite
    // und Prozent — wie bei der Tankanzeige der Verbrenner.
    const icon = unbekannt ? BATTERY_MID_URL : (fill >= 60 ? BATTERY_FULL_URL : (fill >= 25 ? BATTERY_MID_URL : BATTERY_LOW_URL));
    const evRange = Number.isFinite(parsedRange) && parsedRange > 0 ? parsedRange : 500;
    return (
      <BadgeFrame size={size}>
        <div className="flex flex-col items-center">
          <img src={icon} alt="" className={`w-[13px] h-[13px] object-contain${unbekannt ? ' opacity-30' : ''}`} />
          <div className="mt-[3px] text-center text-black font-bold font-['Space_Grotesk'] text-[5px] leading-[6px] whitespace-pre">
            <p className="m-0">{unbekannt ? '–' : `${Math.round((fill / 100) * evRange)}km `}</p>
            <p className="m-0 text-[#060606]">{unbekannt ? '–' : `${fill}%`}</p>
          </div>
        </div>
      </BadgeFrame>
    );
  }

  const maxRange = Number.isFinite(parsedRange) && parsedRange > 0 ? parsedRange : 650;
  const rangeKm = unbekannt ? null : Math.round((fill / 100) * maxRange);
  return (
    <BadgeFrame size={size}>
      <div className="flex flex-col items-center">
        <div className="relative w-[8px] h-[13px]">
          {/* Füllbalken im Innenraum der Zapfsäule, wächst von unten */}
          <div
            className="absolute bg-[#1a171b]"
            style={{ left: '25%', width: '50%', bottom: '12%', height: `${((fill || 0) / 100) * 76}%` }}
          />
          <img src={PUMP_URL} alt="" className="absolute inset-0 w-full h-full" />
        </div>
        <div className="mt-[3px] text-center text-black font-bold font-['Space_Grotesk'] text-[5px] leading-[6px] whitespace-pre">
          <p className="m-0">{unbekannt ? '–' : `${rangeKm}km `}</p>
          <p className="m-0 text-[#060606]">{unbekannt ? '–' : `${fill}%`}</p>
        </div>
      </div>
    </BadgeFrame>
  );
}
