// Zwischenstopps der Fahrt, zwischen Orten und Merkmalen. Google Maps bekommt sie ueber die Route.
export default function ZwischenstoppZeile({ stopps, top }) {
  const liste = (Array.isArray(stopps) ? stopps : []).map((t) => String(t || '').trim()).filter(Boolean);
  if (liste.length === 0) return null;
  return (
    <div
      className="absolute left-[20px] right-[20px] text-[#e2f754] text-[13px] leading-[16px] font-bold tracking-[-0.3px] line-clamp-2"
      style={{ top: `${top}px` }}
    >
      {`Über: ${liste.join('  ·  ')}`}
    </div>
  );
}
