import React, { useState } from 'react';
import { fahrzeugAngaben } from '../../shared/fahrzeugAngaben';
import FahrzeugDrehung, { useDrehSatz } from '../../shared/FahrzeugDrehung';

// Kleines Fahrzeugbild im Fahrer-Blatt der Karte. Dasselbe Bild wie auf der
// Startseite der Fahrer-App (FahrzeugKarte): Auto schraeg vorne links aus dem
// 360-Grad-Satz, sonst image_url. Ohne Bild kommt nichts (null).
export default function FahrzeugMiniBild({ vehicle, breite = 120, hoehe = 48 }) {
  const a = fahrzeugAngaben(vehicle);
  const drehSatz = useDrehSatz(vehicle);
  const [kaputtesBild, setKaputtesBild] = useState('');
  if (drehSatz) {
    return (
      <div className="relative shrink-0" style={{ width: `${breite}px`, height: `${hoehe}px` }}>
        <FahrzeugDrehung satz={drehSatz} alt={a.kennzeichen} stehend style={{ left: 0, top: 0, width: `${breite}px`, height: `${hoehe}px` }} />
      </div>
    );
  }
  if (!a.bild || kaputtesBild === a.bild) return null;
  return (
    <img
      src={a.bild}
      alt={a.kennzeichen}
      className="shrink-0 object-contain"
      style={{ width: `${breite}px`, height: `${hoehe}px` }}
      onError={() => setKaputtesBild(a.bild)}
    />
  );
}
