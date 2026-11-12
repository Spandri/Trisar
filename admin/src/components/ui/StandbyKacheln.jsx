// Standby-Kacheln oben in Alle Fahrten: Ort, Tag, von–bis, angenommen und wer vor Ort, mit Gast, auf Rueckweg.
import { STANDBY_GRAU, STANDBY_LIME, hm, standbyAktuell, useStandbys } from '../../shared/standby';

const schrift = "font-['Space_Grotesk']";
const tagKurz = (iso) => {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  if (iso === heute) return 'Heute';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

export default function StandbyKacheln({ onOpen }) {
  const { liste } = useStandbys();
  const aktuell = (liste || []).filter(standbyAktuell);
  if (!aktuell.length) return null;
  return (
    <div className="mt-6 flex flex-col gap-3">
      {aktuell.map((s) => {
        const ja = s.fahrer.filter((f) => f.status === 'accepted');
        const n = (z) => ja.filter((f) => f.zustand === z).length;
        return (
          <button key={s.id} type="button" onClick={() => onOpen(s.id)} className="relative w-full text-left bg-[#1a1a1a] border-2 px-4 pt-[44px] pb-[14px]" style={{ borderColor: STANDBY_LIME }}>
            <span className={`absolute left-1/2 -translate-x-1/2 top-0 px-4 h-[30px] flex items-center text-[16px] font-bold text-black ${schrift}`} style={{ background: STANDBY_LIME }}>Standby</span>
            <div className={`text-[22px] font-bold text-white ${schrift}`}>{s.ort_name}</div>
            <div className={`text-[30px] leading-[34px] font-bold ${schrift}`} style={{ color: STANDBY_LIME }}>{tagKurz(s.datum)} {hm(s.von)} – {hm(s.bis)}</div>
            <div className={`mt-[6px] text-[13px] font-bold ${schrift}`} style={{ color: STANDBY_GRAU }}>
              {ja.length}/{s.fahrer.length} angenommen · {n('vor_ort')} vor Ort · {n('mit_gast')} mit Gast · {n('rueckweg')} Rückweg
            </div>
          </button>
        );
      })}
    </div>
  );
}
