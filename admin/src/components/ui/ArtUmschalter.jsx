// "Fahrt | Standby | Dienstreise" oben mittig zwischen Zurueck und Import (Fahrt hinzufuegen,
// Standby, Dienstreise). art: 'fahrt' | 'standby' | 'dienstreise' (alt: standby true/false).
const GREEN = '#E3F654';

export default function ArtUmschalter({ art, standby, onFahrt, onStandby, onDienstreise }) {
  const aktiv = art || (standby ? 'standby' : 'fahrt');
  // Drei Knoepfe muessen zwischen Zurueck (links) und Import (rechts) passen.
  const knopf = (an, text, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className="h-[36px] px-[10px] text-[14px] font-bold font-['Space_Grotesk']"
      style={an ? { background: GREEN, color: '#000' } : { color: GREEN }}
    >
      {text}
    </button>
  );
  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-[67px] flex border-2" style={{ borderColor: GREEN }}>
      {knopf(aktiv === 'fahrt', 'Fahrt', onFahrt)}
      {knopf(aktiv === 'standby', 'Standby', onStandby)}
      {knopf(aktiv === 'dienstreise', 'Dienstreise', onDienstreise)}
    </div>
  );
}
