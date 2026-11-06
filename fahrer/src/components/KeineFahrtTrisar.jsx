import { useEffect, useState } from 'react';
import TrisarFooter from './ui/TrisarFooter';
import { TOP_RIGHT_TEAM_URL, TRISAR_LOGO_URL } from '../shared/ui/icons';
import { FahrzeugKarte } from '../shared/FahrzeugKarte';

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};


export default function KeineFahrtTrisar({ currentVehicle, onLogout, onOpenProfile, onOpenVehicle }) {
  const [scale, setScale] = useState(1);
  // Ueberschrift: Modell, ohne Modell das Kennzeichen (keine erfundenen Werte).
  const carName = currentVehicle?.brand_model || currentVehicle?.license_plate || '';

  useEffect(() => {
    const updateScale = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      setScale(Math.min(vw / 393, vh / 874, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return (
    <div
      className="min-h-dvh w-full bg-black overflow-hidden flex justify-center"
      style={{ WebkitTextSizeAdjust: 'none', textSizeAdjust: 'none' }}
    >
      <div className="relative overflow-hidden" style={{ width: `${393 * scale}px`, height: `${874 * scale}px` }}>
        <div className="absolute left-0 top-0 w-[393px] h-[874px] origin-top-left" style={{ ...screenBg, transform: `scale(${scale})` }}>
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
            Hey aktuell gibt es keine Fahrt für dich!
          </h1>

          <FahrzeugKarte
            vehicle={currentVehicle}
            titel={carName}
            bildOben={55.57}
            top={462}
            onClick={onOpenVehicle}
          />

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
    </div>
  );
}
