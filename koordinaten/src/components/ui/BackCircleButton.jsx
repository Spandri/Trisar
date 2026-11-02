export default function BackCircleButton({ onClick, className = '', ariaLabel = 'Zurück', type = 'button' }) {
  return (
    <button type={type} onClick={onClick} className={`w-[50px] h-[50px] relative ${className}`} aria-label={ariaLabel}>
      <div className="absolute inset-0 rounded-full border border-[#747474]" />
      <img
        src="/icon/_Icon_Grau/Arrow_Trisar_Icons_01_grau.svg"
        alt=""
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[27px] h-[16px] rotate-180 scale-[1.2]"
      />
    </button>
  );
}
