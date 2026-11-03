import { useEffect, useState } from 'react';
import TrisarFooter from './ui/TrisarFooter';
import { TOP_RIGHT_TEAM_URL, TRISAR_LOGO_URL } from '../shared/ui/icons';
import { ColorBadge, EnergyBadge, FuelBadge, SeatBadge } from '../shared/vehicleBadges';

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};


export default function KeineFahrtTrisar({ currentVehicle, onLogout, onOpenProfile, onOpenVehicle }) {
  const [scale, setScale] = useState(1);
  const carName = currentVehicle?.brand_model || 'M PM 3214';
  const vin = currentVehicle?.vin || '12345678910121314';
  const image = currentVehicle?.image_url || '';
  const fuelType = currentVehicle?.fuel_type || '';

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

          <div
            className={`absolute left-5 top-[462px] w-[362px] h-[268px] bg-white${onOpenVehicle ? ' cursor-pointer' : ''}`}
            onClick={onOpenVehicle}
            role={onOpenVehicle ? 'button' : undefined}
          >
            <h2 className="absolute inset-x-0 h-[36.68px] text-center text-[#1c1c1d] text-[30px] leading-none tracking-[-0.5px] font-bold" style={{ top: '15.29px' }}>
              {carName}
            </h2>
            <p className="absolute z-10 text-center text-[13px] inset-x-0 whitespace-nowrap" style={{ top: '51.97px' }}>
              <span className="text-[rgba(28,28,29,0.15)] font-bold">VIN  </span>
              <span className="text-[rgba(28,28,29,0.15)] tracking-[2px]">{vin}</span>
            </p>

            <div className="absolute" style={{ left: '63.9px', top: '55.57px', width: '234.53px', height: '114.91px' }}>
              {image ? (
                <img src={image} alt={carName} className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full bg-[#ececec]" />
              )}
            </div>

            {/* 4 Kacheln – identisch zur Admin-Fahrzeugliste (gemeinsames Badge-Modul) */}
            <div className="absolute flex items-center gap-[16px]" style={{ left: '53px', top: '195.65px' }}>
              <FuelBadge fuelType={fuelType} size={52} />
              <ColorBadge color={currentVehicle?.color} size={52} />
              <EnergyBadge
                fuelType={fuelType}
                seed={vin}
                fillPercent={currentVehicle?.battery_fuel_percent}
                fullRangeKm={currentVehicle?.range_km}
                size={52}
              />
              <SeatBadge seatCount={currentVehicle?.seat_count} size={52} />
            </div>
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
    </div>
  );
}
