import OrtVorschlag from './OrtVorschlag';

const GREEN = '#E3F654';

// Vorschlagsliste unter einer Zwischenstopp-Zeile. Eigener Ort: seine Adresse wird eingetragen.
export default function ZwischenstoppVorschlaege({ panel, top }) {
  if (!panel || (panel.optionen.length === 0 && panel.orte.length === 0)) return null;
  return (
    <div
      className="absolute left-[20px] w-[362px] max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[120]"
      style={{ top: `${top}px` }}
    >
      {panel.orte.map((ort, index) => (
        <OrtVorschlag key={`stopp-ort-${ort.id}`} ort={ort} marker={`vorschlag-stopp-ort-${index}`} onWaehlen={(gewaehlt) => panel.waehlen(gewaehlt.adresse || gewaehlt.name)} />
      ))}
      {panel.optionen.map((option, index) => (
        <button
          key={`stopp-option-${index}-${option}`}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            panel.waehlen(option);
          }}
          className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15]"
          style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
