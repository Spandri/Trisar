// block: als Inline-Element liess der Knopf unter sich die Unterlaenge der
// Schriftzeile frei. In Ansichten, die untereinander fliessen, rutschte der
// Titel dadurch 7 px tiefer als in den absolut gesetzten.
// marker: data-tutorial-Kennung fuer das Demo-Tutorial (optional).
export default function BackCircleButton({ onClick, className = '', ariaLabel = 'Zurück', type = 'button', marker }) {
  return (
    <button type={type} onClick={onClick} data-tutorial={marker} className={`block w-[50px] h-[50px] relative ${className}`} aria-label={ariaLabel}>
      <div className="absolute inset-0 rounded-full border border-[#747474]" />
      <img
        src="/icon/_Icon_Grau/Arrow_Trisar_Icons_01_grau.svg"
        alt=""
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[27px] h-[16px] rotate-180 scale-[1.2]"
      />
    </button>
  );
}
