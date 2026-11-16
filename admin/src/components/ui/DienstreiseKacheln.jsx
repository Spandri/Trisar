// Dienstreise-Kacheln oben in Alle Fahrten (wie StandbyKacheln): Start → Ziel, Tag und Startzeit,
// Zug/Flug, wie viele Fahrer angenommen haben.
import { REISE_GRAU, REISE_LIME, hm, reiseAktuell, useDienstreisen } from '../../shared/dienstreise';

const schrift = "font-['Space_Grotesk']";
const tagKurz = (iso) => {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
  if (iso === heute) return 'Heute';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
};

export default function DienstreiseKacheln({ onOpen }) {
  const { liste } = useDienstreisen();
  const aktuell = (liste || []).filter(reiseAktuell);
  if (!aktuell.length) return null;
  return (
    <div className="mt-6 flex flex-col gap-3">
      {aktuell.map((r) => {
        const ja = r.fahrer.filter((f) => f.status === 'accepted').length;
        const nein = r.fahrer.filter((f) => f.status === 'refused').length;
        const nummer = r.zugnummer || r.flugnummer;
        return (
          <button key={r.id} type="button" onClick={() => onOpen(r.id)} className="relative w-full text-left bg-[#1a1a1a] border-2 px-4 pt-[44px] pb-[14px]" style={{ borderColor: REISE_LIME }}>
            <span className={`absolute left-1/2 -translate-x-1/2 top-0 px-4 h-[30px] flex items-center gap-2 text-[16px] font-bold text-black ${schrift}`} style={{ background: REISE_LIME }}>
              Dienstreise
              <img src="/icon/_Icon_Schwarz/Rollkoffer_Trisar_Icons_01.svg" alt="" className="w-[16px] h-[16px] object-contain" />
            </span>
            <div className={`text-[22px] font-bold text-white ${schrift}`}>{r.start_name} → {r.ziel_name}</div>
            <div className={`text-[30px] leading-[34px] font-bold ${schrift}`} style={{ color: REISE_LIME }}>{tagKurz(r.datum)} {hm(r.start_zeit)}</div>
            <div className={`mt-[6px] text-[13px] font-bold ${schrift}`} style={{ color: REISE_GRAU }}>
              {nummer ? `${nummer} · ` : ''}{ja}/{r.fahrer.length} angenommen{nein ? ` · ${nein} abgelehnt` : ''}
            </div>
          </button>
        );
      })}
    </div>
  );
}
