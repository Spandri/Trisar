// Vermerk "3 Fahrer markiert: ..." wie das Zitat ueber der Eingabe in Claude:
// dunkles Feld, Haken in Lime, Namen gekuerzt, X hebt die Auswahl auf.
// Erscheint nur, wenn auf der Karte Fahrer markiert sind.
import { fahrerMarkierung, useFahrerMarkierung } from '../../shared/fahrerMarkierung';
import { useI18n } from '../../i18n';
import { flaggeNachId, FLAGGE_UMRISS } from '../../shared/flaggen';

export default function MarkierungsVermerk({ className = '', text = null }) {
  const { t } = useI18n();
  const stand = useFahrerMarkierung();
  if (!stand.aktiv || stand.fahrer.length === 0) return null;
  // Kommt die Auswahl von Flaggen, zeigt der Vermerk die Flaggen statt aller Namen.
  const flaggen = (stand.flaggen || []).map(flaggeNachId).filter(Boolean);
  const namen = flaggen.length ? '' : stand.fahrer.map((f) => f.name).filter(Boolean).join(', ');
  return (
    <div className={`h-[44px] rounded-[12px] bg-[#242525] outline outline-1 outline-offset-[-1px] outline-[#3A3A3A] pl-[12px] pr-[6px] flex items-center gap-[10px] font-['Space_Grotesk'] ${className}`}>
      <img src="/icon/_Icon_Lime/Auswahl_Haken_Lime.svg" alt="" className="w-[16px] h-[18px] shrink-0" />
      <span className="flex-1 min-w-0 truncate text-[14px] leading-[18px] text-white/80">
        <span className="font-bold text-white">{text || t('auswahl.vermerk', { n: stand.fahrer.length })}</span>
        {namen ? `  ${namen}` : ''}
        {flaggen.map((f) => (
          <img key={f.id} src={f.voll} alt={f.name} className="inline-block w-[14px] h-[18px] ml-[8px] align-[-4px]" style={{ filter: FLAGGE_UMRISS }} />
        ))}
      </span>
      <button
        type="button"
        onClick={() => fahrerMarkierung.modusSetzen(false)}
        aria-label={t('auswahl.aufheben')}
        title={t('auswahl.aufheben')}
        className="w-[32px] h-[32px] shrink-0 flex items-center justify-center text-white/70 text-[20px] leading-none"
      >
        ×
      </button>
    </div>
  );
}
