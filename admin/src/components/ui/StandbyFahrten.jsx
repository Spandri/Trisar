// Standby-Fahrten in Alle Fahrten: faehrt ein Fahrer vom Event los, erscheint hier eine Fahrt
// "Standby-Fahrt" mit Abfahrtszeit, Status Unterwegs (orange) bzw. Rueckweg mit Ankunft am Event,
// danach "Zurück" mit Uhrzeit. Tipp oeffnet den Standby.
import { STANDBY_GRAU, STANDBY_LIME, STANDBY_ORANGE, fahrerName, standbyAktuell, uhrIso, useStandbyFahrten, useStandbys } from '../../shared/standby';

const schrift = "font-['Space_Grotesk']";
const kurz = (p) => {
  if (!p) return 'Fahrer';
  const n = `${p.first_name ? `${p.first_name[0]}. ` : ''}${p.last_name || ''}`.trim();
  return `${n || fahrerName(p)}${p.driver_number != null ? ` (${p.driver_number})` : ''}`;
};

export default function StandbyFahrten({ onOpen }) {
  const { liste } = useStandbys();
  const aktuell = (liste || []).filter(standbyAktuell);
  const fahrten = useStandbyFahrten(aktuell);
  if (!fahrten.length) return null;
  const sortiert = [...fahrten].sort((a, b) => new Date(b.start) - new Date(a.start));
  return (
    <div className="mt-6 flex flex-col gap-3">
      {sortiert.map((f) => {
        const s = aktuell.find((x) => x.id === f.standby_id);
        const p = s?.fahrer.find((x) => x.driver_id === f.driver_id)?.profil;
        const status = f.status === 'unterwegs'
          ? { text: 'Unterwegs', farbe: STANDBY_ORANGE }
          : f.status === 'rueckweg'
            ? { text: f.ankunft ? `Rückweg · an ${uhrIso(f.ankunft)}` : 'Rückweg', farbe: '#59BE80' }
            : { text: f.zurueck ? `Zurück ${uhrIso(f.zurueck)}` : 'Beendet', farbe: STANDBY_GRAU };
        return (
          <button key={f.id} type="button" onClick={() => onOpen(f.standby_id)} className="w-full text-left bg-white px-4 py-3 flex justify-between gap-3">
            <div className="min-w-0">
              <div className={`text-[22px] leading-[26px] font-bold text-[#1d1c1d] ${schrift}`}>Standby-Fahrt</div>
              <div className={`mt-[4px] text-[13px] font-medium text-[#1d1c1d]/70 ${schrift}`}>
                {s?.ort_name || 'Event'} – {f.abgesetzt ? `abgesetzt ${uhrIso(f.abgesetzt)}` : 'Ziel offen'}
              </div>
              <div className={`mt-[10px] text-[15px] font-bold text-[#1d1c1d] ${schrift}`}>{kurz(p)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`text-[30px] leading-[32px] font-bold ${schrift}`} style={{ color: '#59BE80' }}>{uhrIso(f.start)}</div>
              <div className={`mt-[4px] text-[12px] font-bold ${schrift}`} style={{ color: status.farbe === STANDBY_LIME ? '#59BE80' : status.farbe }}>{status.text}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
