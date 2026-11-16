import { useKiModus } from '../../shared/kiModus';

// Zwei Felder "Regeln | Frei", Lime-Rahmen, aktives Feld gefuellt (Entwurf 13.11.).
export default function KiModusSchalter({ className = '' }) {
  const [modus, setModus] = useKiModus();
  const feld = (wert, text) => (
    <button
      type="button"
      onClick={() => setModus(wert)}
      aria-pressed={modus === wert}
      className={`px-[14px] h-[24px] text-[12px] font-medium leading-none ${modus === wert ? 'bg-[#E3F654] text-[#0E1008]' : 'bg-transparent text-[#E3F654]'}`}
    >
      {text}
    </button>
  );
  return (
    <div className={`inline-flex border-2 border-[#E3F654] font-['Space_Grotesk'] ${className}`} data-tutorial="ki-modus">
      {feld('regeln', 'Regeln')}
      {feld('frei', 'Frei')}
    </div>
  );
}
