// Eigener Ort als Vorschlag in der Adressliste beim Fahrt erstellen/bearbeiten.
// Steht ganz oben, mit Icon des Orts, darunter klein die Adresse.
import { ortIconUrl } from '../../shared/orte';

const GREEN = '#E3F654';

export default function OrtVorschlag({ ort, marker, onWaehlen }) {
  return (
    <button
      type="button"
      data-tutorial={marker}
      onMouseDown={(e) => {
        e.preventDefault();
        onWaehlen(ort);
      }}
      onClick={() => onWaehlen(ort)}
      className="w-full px-3 py-2 flex items-center gap-3 text-left border-b last:border-b-0 border-[#2a2d15]"
      style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
    >
      <img src={ortIconUrl(ort.icon)} alt="" className="w-[24px] h-[24px] object-contain shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block truncate text-[13px] font-bold">{ort.name}</span>
        <span className="block truncate text-[11px] font-medium opacity-60">{ort.adresse}</span>
      </span>
    </button>
  );
}
