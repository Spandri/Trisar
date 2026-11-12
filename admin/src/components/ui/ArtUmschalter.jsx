// "Fahrt | Standby" oben mittig zwischen Zurueck und Import (Fahrt hinzufuegen und Standby).
const GREEN = '#E3F654';

export default function ArtUmschalter({ standby, onFahrt, onStandby }) {
  const knopf = (an, text, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className="h-[36px] px-4 text-[15px] font-bold font-['Space_Grotesk']"
      style={an ? { background: GREEN, color: '#000' } : { color: GREEN }}
    >
      {text}
    </button>
  );
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-[67px] flex border-2" style={{ borderColor: GREEN }}>
      {knopf(!standby, 'Fahrt', onFahrt)}
      {knopf(standby, 'Standby', onStandby)}
    </div>
  );
}

