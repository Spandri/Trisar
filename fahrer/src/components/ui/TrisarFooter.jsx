import { TRISAR_LOGO_URL } from '../../shared/ui/icons';

export default function TrisarFooter({ className = 'absolute left-0 right-0 top-[834px] h-10 bg-black', style }) {
  return (
    <footer className={`${className} flex items-center justify-between`} style={style}>
      <div className="w-[116px] text-[#e3f654] text-[10px] tracking-[-0.5px] font-medium text-center leading-[19px]">
        © impressum
      </div>
      <div className="w-[73px] h-[10.83px] shrink-0">
        <img src={TRISAR_LOGO_URL} alt="trisar" className="w-full h-full object-contain" />
      </div>
      {/* Der Weg zur Supportseite. Die Fussleiste steht in jeder Ansicht, kennt
          aber keine Navigation — sie meldet den Wunsch, die App schaltet um. */}
      <button
        type="button"
        data-tutorial="footer-support"
        onClick={() => window.dispatchEvent(new CustomEvent('trisar:support-oeffnen'))}
        // Ein Knopf erbt die Schrift nicht von allein — sonst faellt er auf die
        // Schrift des Browsers zurueck und steht groesser da als "© impressum".
        style={{ fontFamily: 'inherit', fontSize: '10px', fontWeight: 500, lineHeight: '19px' }}
        className="w-[116px] text-[#e3f654] text-[10px] tracking-[-0.5px] font-medium text-center leading-[19px]"
      >
        support
      </button>
    </footer>
  );
}
