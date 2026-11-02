import React, { useEffect, useState, useRef } from 'react';
import SchadenMelden from './SchadenMelden';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { USER_LOCATION_DOT_URL } from '../../../shared/ui/icons';
import { ColorBadge, EnergyBadge, FuelBadge, SeatBadge } from '../../../shared/vehicleBadges';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 1264;
const PAGE_CONTENT_OFFSET_Y = 40;
const FOOTER_HEIGHT = 40;
const FOOTER_GAP = 30;
const EXTRA_BOTTOM_SPACE = FOOTER_HEIGHT + FOOTER_GAP;

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 393 1264' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(39.3 126.4 -39.3 26.741 0 -2.8066e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

const DRIVER_COORDS = { lat: 48.1215, lng: 11.6644 };

const PfeilIcon = () => (
  <svg width="34" height="20" viewBox="0 0 34 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M29.9128 11.911L29.9128 12.6154L20.2915 16.2337L20.2915 19.916L34 14.4085L34 10.6942L34 10.0218L34 5.50692L20.2915 -0.000561531L20.2915 3.68176L29.9128 7.30005L29.9128 8.00449L-1.09799e-06 8.0045L-9.12036e-07 10.0218L-8.50053e-07 10.6942L-7.37893e-07 11.911L29.9128 11.911Z" fill="#1c1c1d" />
  </svg>
);

const VehicleBlock = ({ vehicle }) => {
  const plateNumber = vehicle?.license_plate || 'M PM 3214';
  const vin = vehicle?.vin || '12345678910121314';
  const image = vehicle?.image_url || '';
  const model = vehicle?.brand_model || 'BMW M5';
  const trim = vehicle?.trim || 'Limousine';
  const fuelType = vehicle?.fuel_type || '';

  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-[440px] w-[353px] h-[332px] bg-white">
      {/* Kennzeichen */}
      <h2
        className="absolute inset-x-0 h-[36.68px] text-center text-[#1c1c1d] text-[30px] leading-none tracking-[-0.5px] font-bold"
        style={{ top: '15.29px', fontFamily: 'Space Grotesk' }}
      >
        {plateNumber}
      </h2>
      
      {/* VIN */}
      <p
        className="absolute z-10 text-center text-[13px] inset-x-0 whitespace-nowrap"
        style={{ top: '51.97px', fontFamily: 'Space Grotesk' }}
      >
        <span className="text-[rgba(28,28,29,0.15)] font-bold">VIN  </span>
        <span className="text-[rgba(28,28,29,0.15)] tracking-[2px]">{vin}</span>
      </p>

      {/* Auto Bild */}
      <div className="absolute" style={{ left: '51px', top: '75px', width: '250px', height: '122px' }}>
        {image ? (
          <img src={image} alt={plateNumber} className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full bg-[#ececec]" />
        )}
      </div>

      {/* Model name */}
      <div 
        className="absolute text-center text-[#1c1c1d] text-[20px] leading-none tracking-[-0.5px] font-bold"
        style={{ left: '0', top: '210px', width: '353px', fontFamily: 'Space Grotesk' }}
      >
        {model}
      </div>

      {/* Trim */}
      <div 
        className="absolute text-center text-[rgba(28,28,29,0.15)] text-[13px]"
        style={{ left: '0', top: '230px', width: '353px', fontFamily: 'Space Grotesk' }}
      >
        {trim}
      </div>

      {/* 4 Kacheln – identisch zur Admin-Fahrzeugliste (gemeinsames Badge-Modul) */}
      <div className="absolute flex items-center gap-[16px]" style={{ left: '53px', top: '270px' }}>
        <FuelBadge fuelType={fuelType} size={52} />
        <ColorBadge color={vehicle?.color} size={52} />
        <EnergyBadge
          fuelType={fuelType}
          seed={vin}
          fillPercent={vehicle?.battery_fuel_percent}
          fullRangeKm={vehicle?.range_km}
          size={52}
        />
        <SeatBadge seatCount={vehicle?.seat_count} size={52} />
      </div>
    </div>
  );
};

const MapComponent = () => {
  const mapRef = useRef(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!window.trisarKarte || !mapRef.current) return;
    const map = new window.trisarKarte.Map(mapRef.current, {
      center: DRIVER_COORDS,
      zoom: 15,
      disableDefaultUI: true,
      gestureHandling: 'none',
      draggable: false,
      scrollwheel: false,
      disableDoubleClickZoom: true,
      styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
    });
    new window.trisarKarte.Marker({
      position: DRIVER_COORDS,
      map,
      icon: {
        url: USER_LOCATION_DOT_URL,
        scaledSize: new window.trisarKarte.Size(30, 30),
        anchor: new window.trisarKarte.Point(15, 15),
      },
      title: t('misc.currentLocation'),
    });
  }, [t]);

  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-[99px] w-[353px] h-[324px] pointer-events-none">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

// 2026-09-12 -> 12.09.26, wie die uebrigen Eintraege im Bericht.
const datumKurz = (wert) => {
  if (typeof wert !== 'string') return '';
  const teile = wert.slice(0, 10).split('-');
  if (teile.length !== 3) return wert;
  return `${teile[2]}.${teile[1]}.${teile[0].slice(2)}`;
};

const SchadensBericht = ({ damages = [], onMelden, blockRef }) => {
  const { t } = useI18n();
  const sampleDamages = [
    {
      id: 1,
      date: '12.01.26',
      part: t('misc.damageSample1Part'),
      description: t('misc.damageSample1Desc')
    },
    {
      id: 2,
      date: '12.01.26',
      part: t('misc.damageSample2Part'),
      description: t('misc.damageSample2Desc')
    },
    {
      id: 3,
      date: '06.02.26',
      part: t('misc.damageSample3Part'),
      description: t('misc.damageSample3Desc')
    }
  ];

  // Vom Fahrer gemeldete Schaeden stehen oben, darunter der vorhandene Bestand.
  const displayDamages = [...damages, ...sampleDamages];

  return (
    <div ref={blockRef} className="absolute left-1/2 -translate-x-1/2 top-[771px] w-[353px] bg-white p-[29px]" data-tutorial="schadensbericht">
      <h3 
        className="text-[#dddcdc] text-[15px] font-bold tracking-[-0.5px] mb-[10px]"
        style={{ fontFamily: 'Space Grotesk' }}
      >
        {t('misc.damageReport')}
      </h3>
      
      <div className="w-full h-[1px] bg-[#dddcdc] mb-[10px]" />

      {displayDamages.map((damage, index) => (
        <div key={damage.id || index} className="mb-[10px]">
          <div 
            className="text-[#dddcdc] text-[15px] font-bold tracking-[-0.5px] mb-[10px]"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            {damage.date || datumKurz(damage.report_date) || ''}
          </div>
          
          <div 
            className="text-[#1d1c1c] text-[10px] font-bold tracking-[-0.5px] mb-[5px]"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            {damage.part || damage.part_name || ''}
          </div>
          
          <div 
            className="text-[#1d1c1c] text-[14px] font-bold tracking-[-0.5px] mb-[10px]"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            {damage.description}
          </div>

          {(damage.image_urls?.length ? damage.image_urls : [damage.image_url].filter(Boolean)).length ? (
            <div className="flex gap-[4px] mb-[10px]">
              {(damage.image_urls?.length ? damage.image_urls : [damage.image_url]).map((url) => (
                <img key={url} src={url} alt="" className="flex-1 min-w-0 h-[96px] object-cover bg-[#f4f4f4]" />
              ))}
            </div>
          ) : null}

          {index < displayDamages.length - 1 && (
            <div className="w-full h-[1px] bg-[#dddcdc] mb-[10px]" />
          )}
        </div>
      ))}

      {/* Meldeknopf im Stil der uebrigen Lime-Leisten */}
      <button
        type="button"
        onClick={onMelden}
        data-tutorial="schaden-melden"
        className="w-full h-[56px] bg-[#E3F654] flex items-center justify-between px-6 mt-[10px]"
      >
        <span
          className="text-black text-[16px] font-bold tracking-[-0.5px]"
          style={{ fontFamily: 'Space Grotesk' }}
        >
          {t('misc.reportDamage')}
        </span>
        <PfeilIcon />
      </button>
    </div>
  );
};

export default function VehicleView({ setView, vehicle, damages, onAddDamage }) {
  const [scale, setScale] = useState(1);
  const [meldenOffen, setMeldenOffen] = useState(false);
  // Mit jedem gemeldeten Schaden waechst der Bericht. Die Seite misst ihn und
  // wird entsprechend laenger, damit der Meldeknopf nie unter den Rand rutscht.
  const berichtRef = useRef(null);
  const [berichtUnterkante, setBerichtUnterkante] = useState(0);
  useEffect(() => {
    const el = berichtRef.current;
    if (!el) return undefined;
    const messen = () => setBerichtUnterkante(el.offsetTop + el.offsetHeight);
    messen();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const beobachter = new ResizeObserver(messen);
    beobachter.observe(el);
    return () => beobachter.disconnect();
  }, [damages]);
  const inhaltHoehe = Math.max(BASE_HEIGHT, berichtUnterkante);
  const canvasHeight = inhaltHoehe + PAGE_CONTENT_OFFSET_Y + EXTRA_BOTTOM_SPACE;

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  return (
    <>
    <div
      className="h-dvh w-full bg-black overflow-y-auto overflow-x-hidden overscroll-none flex justify-center"
      style={{
        WebkitTextSizeAdjust: 'none',
        textSizeAdjust: 'none',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
      }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${canvasHeight * scale}px` }}>
        <div 
          className="absolute left-0 top-0 w-[402px] origin-top-left"
          style={{ ...screenBg, height: `${canvasHeight}px`, transform: `scale(${scale})` }}
        >
          <div className="absolute left-0 top-[20px] w-[402px]">
            {/* Back Button */}
            <ZurueckKnopf onClick={() => setView('list')} marker="fahrzeug-zurueck" oben={40} />

            {/* Map Component */}
            <MapComponent />

            {/* Vehicle Block */}
            <VehicleBlock vehicle={vehicle} />

            {/* Schadensbericht */}
            <SchadensBericht
              damages={damages}
              blockRef={berichtRef}
              onMelden={() => setMeldenOffen(true)}
            />
          </div>
        </div>
      </div>
    </div>
    {/* Footer steht fest am unteren Rand wie in den uebrigen Ansichten. Er liegt
        ausserhalb des scrollenden und skalierten Inhalts, weil position: fixed
        sich sonst am transform-Elternteil ausrichten wuerde statt am Fenster. */}
    <TrisarFooter className="fixed left-0 right-0 bottom-0 h-10 bg-black z-30" />
    {meldenOffen ? (
      <SchadenMelden
        onClose={() => setMeldenOffen(false)}
        onConfirm={({ stelle, beschreibung, fotos }) => {
          onAddDamage?.(stelle, beschreibung, fotos);
          setMeldenOffen(false);
        }}
      />
    ) : null}
    </>
  );
}
