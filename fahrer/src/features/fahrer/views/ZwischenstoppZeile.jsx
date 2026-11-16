// Zwischenstopps der Fahrt, zwischen Orten und Merkmalen. Google Maps bekommt sie ueber die Route.
// Hat die Dispo die Route angepasst (routen_punkte, 15.11.), steht davor die Marke "Route von Dispo".
export default function ZwischenstoppZeile({ stopps, routenPunkte, top }) {
  const liste = (Array.isArray(stopps) ? stopps : []).map((t) => String(t || '').trim()).filter(Boolean);
  const angepasst = Array.isArray(routenPunkte) && routenPunkte.length > 0;
  if (liste.length === 0 && !angepasst) return null;
  return (
    <div
      className="absolute left-[20px] right-[20px] text-[#e2f754] text-[13px] leading-[16px] font-bold tracking-[-0.3px] line-clamp-2"
      style={{ top: `${top}px` }}
    >
      {angepasst ? (
        <span className="inline-block mr-2 px-2 rounded-[10px] bg-[#e2f754] text-black text-[11px] leading-[16px]">Route von Dispo</span>
      ) : null}
      {liste.length ? `Über: ${liste.join('  ·  ')}` : ''}
    </div>
  );
}
