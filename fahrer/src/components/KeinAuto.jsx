import TrisarFooter from './ui/TrisarFooter';
import { NO_CAR_ARROW_URL, TOP_RIGHT_TEAM_URL, TRISAR_LOGO_URL } from '../shared/ui/icons';

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

export default function KeinAuto({ onLogout, onOpenProfile }) {
  return (
    <div
      className="min-h-dvh w-full bg-black overflow-hidden flex justify-center"
      style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none' }}
    >
      <div className="relative w-[393px] h-[874px] max-w-full overflow-hidden">
        <div className="absolute inset-0" style={screenBg} />

        <div className="absolute left-5 top-[116px] w-[161.79px] h-6">
          <img src={TRISAR_LOGO_URL} alt="trisar" className="w-full h-full object-contain" />
        </div>

        {/* Profil-Knopf wie in der Fahrtenliste, nur wenn ein Handler kommt (Live) */}
        {onOpenProfile && (
          <button type="button" onClick={onOpenProfile} aria-label="Profil" className="absolute right-5 top-[86px] w-[52px] h-[52px] rounded-full border border-[#8f8f90] flex items-center justify-center">
            <img src={TOP_RIGHT_TEAM_URL} alt="" className="w-[24px] h-[24px] object-contain opacity-90" />
          </button>
        )}

        <h1 className="absolute left-5 top-[194px] w-[362px] text-white text-[34px] leading-[1.18] tracking-[-0.5px] font-medium">
          Hey aktuell gibt es keine Fahrt und kein Auto für dich!
        </h1>

        <h2 className="absolute left-5 top-[432px] w-[362px] h-10 text-white text-[34px] leading-10 tracking-[-0.5px] font-medium">
          Komm später nochmal
        </h2>

        <div className="absolute left-5 top-[496px] w-[362px] h-[234px]">
          <img src={NO_CAR_ARROW_URL} alt="" className="w-full h-full object-contain" />
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="absolute left-5 top-[754px] w-[362px] h-14 border border-[#7f8a2b] text-[#7f8a2b] text-[16px] leading-6 tracking-[0.5px] font-medium"
        >
          Abmelden
        </button>

        <TrisarFooter />
      </div>
    </div>
  );
}
