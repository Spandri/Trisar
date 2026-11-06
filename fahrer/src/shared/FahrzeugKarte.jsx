import React, { useEffect, useState } from 'react';
import { ColorBadge, EnergyBadge, FuelBadge, SeatBadge } from './vehicleBadges';
import { useI18n } from '../i18n';
import { fahrzeugAngaben, hatKacheln, kartenRaster, istObdQuelle, standortAlter } from './fahrzeugAngaben';

// Bausteine fuer Fahrzeugkarte und Fahrzeug-Seite (nur Angaben mit Wert).

// Nur Kacheln mit Wert. Ohne jede Angabe kommt nichts (null).
export function FahrzeugKacheln({ vehicle, size = 52, className = '', style, ...rest }) {
  const a = fahrzeugAngaben(vehicle);
  if (!hatKacheln(a)) return null;
  return (
    <div className={`flex items-center justify-center gap-[16px] ${className}`} style={style} {...rest}>
      {a.kraftstoff ? <FuelBadge fuelType={a.kraftstoff} size={size} /> : null}
      {a.farbe ? <ColorBadge color={a.farbe} size={size} /> : null}
      {a.energie ? (
        <EnergyBadge fuelType={a.kraftstoff} seed={a.vin} fillPercent={a.fuellstand} fullRangeKm={vehicle?.range_km} size={size} />
      ) : null}
      {a.sitze ? <SeatBadge seatCount={a.sitze} size={size} /> : null}
    </div>
  );
}

// Bild, das bei Ladefehler einfach verschwindet (statt grauer Flaeche).
export function FahrzeugBild({ src, alt = '', style, onFehler }) {
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="absolute object-contain"
      style={style}
      onError={() => onFehler?.()}
    />
  );
}

// Chip auf der Karte: "OBD-Tracker · vor 3 Min." Aktualisiert sich jede halbe Minute.
export function StandortChip({ quelle, erfasst, className = '', style }) {
  const { t } = useI18n();
  const [jetzt, setJetzt] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setJetzt(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const alter = standortAlter(erfasst, t, jetzt);
  const name = istObdQuelle(quelle) ? t('vehicle.sourceObd') : t('vehicle.sourceApp');
  return (
    <div
      className={`inline-flex items-center gap-[7px] h-[28px] px-[10px] bg-black text-[12px] leading-none font-bold tracking-[-0.2px] whitespace-nowrap ${className}`}
      style={{ fontFamily: 'Space Grotesk', ...style }}
      data-tutorial="standort-quelle"
    >
      <span className="w-[7px] h-[7px] rounded-full bg-[#E3F654] shrink-0" />
      <span className="text-[#E3F654]">{name}</span>
      {alter ? <span className="text-white/70 font-medium">{alter}</span> : null}
    </div>
  );
}

// Weisse Fahrzeugkarte der Startseite (Fahrtenliste und "Keine Fahrt"), 362 breit.
// Hoehe folgt den vorhandenen Angaben (kartenRaster), die Eltern bekommen sie ueber onHoehe.
export function FahrzeugKarte({ vehicle, titel, bildOben = 63, top, onClick, onHoehe, className = '', ...rest }) {
  const a = fahrzeugAngaben(vehicle);
  const [kaputtesBild, setKaputtesBild] = useState('');
  const raster = kartenRaster(a, { bildOben, bildDa: Boolean(a.bild) && kaputtesBild !== a.bild });
  useEffect(() => { onHoehe?.(raster.hoehe); }, [raster.hoehe, onHoehe]);
  return (
    <div
      className={`absolute left-5 w-[362px] bg-white text-left${onClick ? ' cursor-pointer' : ''} ${className}`}
      style={{ top: `${top}px`, height: `${raster.hoehe}px` }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      {...rest}
    >
      <h2
        className="absolute inset-x-0 h-[36.68px] text-center text-[#1c1c1d] text-[30px] leading-none tracking-[-0.5px] font-bold whitespace-nowrap overflow-hidden text-ellipsis px-3"
        style={{ top: '15.29px', fontFamily: 'Space Grotesk' }}
      >
        {titel}
      </h2>
      {raster.vin !== undefined ? (
        <p className="absolute z-10 text-center text-[13px] inset-x-0 whitespace-nowrap" style={{ top: `${raster.vin}px`, fontFamily: 'Space Grotesk' }}>
          <span className="text-[rgba(28,28,29,0.15)] font-bold">VIN  </span>
          <span className="text-[rgba(28,28,29,0.15)] tracking-[2px]">{a.vin}</span>
        </p>
      ) : null}
      {raster.bild !== undefined ? (
        <FahrzeugBild
          src={a.bild}
          alt={titel}
          style={{ left: '63.9px', top: `${raster.bild}px`, width: '234.53px', height: '114.91px' }}
          onFehler={() => setKaputtesBild(a.bild)}
        />
      ) : null}
      {raster.kacheln !== undefined ? (
        <FahrzeugKacheln vehicle={vehicle} className="absolute inset-x-0" style={{ top: `${raster.kacheln}px` }} data-tutorial="kacheln" />
      ) : null}
    </div>
  );
}
