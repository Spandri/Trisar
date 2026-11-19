import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n';

// Die Abfrage des Betriebssystems: Kamera, Mediathek oder Datei. Das ist keine
// TRISAR-Oberflaeche, sondern die des iPhones — deshalb graue Karten, blaue
// Schrift und die abgesetzte Zeile "Abbrechen". Auf einem echten Geraet zeigt
// das System sein eigenes Blatt; hier im Demo-Rahmen wird es nachgebaut.
const FotoQuelleBlatt = ({ onKamera, onGalerie, onClose }) => {
  const { t } = useI18n();
  const [oben, setOben] = useState(false);
  // Kurz nach dem Einhaengen faehrt das Blatt herein. Bewusst ueber eine Uhr
  // statt ueber den Bildtakt — ein Fenster im Hintergrund haelt den Bildtakt an,
  // das Blatt bliebe dann unten stehen.
  useEffect(() => {
    const id = setTimeout(() => setOben(true), 20);
    return () => clearTimeout(id);
  }, []);

  const zeile = 'w-full h-[57px] flex items-center justify-center text-[#007aff] text-[20px]';
  const schrift = { fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif' };

  // Die Fussleiste steht fest am unteren Rand — das Blatt endet darueber.
  return (
    <div
      className="absolute left-0 right-0 top-0 z-[120] flex flex-col justify-end"
      style={{ bottom: '40px' }}
      data-tutorial="schaden-quelle"
    >
      <button type="button" aria-label="" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        className="relative px-[8px] pb-[10px]"
        style={{
          transform: oben ? 'translateY(0)' : 'translateY(110%)',
          transition: 'transform 320ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        <div className="rounded-[14px] overflow-hidden bg-[rgba(249,249,249,0.94)] backdrop-blur-md">
          <button type="button" onClick={onKamera} data-tutorial="schaden-quelle-kamera" className={zeile} style={schrift}>
            {t('misc.sourceCamera')}
          </button>
          <div className="h-[0.5px] bg-[rgba(60,60,67,0.29)]" />
          <button type="button" onClick={onGalerie} data-tutorial="schaden-quelle-galerie" className={zeile} style={schrift}>
            {t('misc.sourceLibrary')}
          </button>
        </div>
        <div className="mt-[8px] rounded-[14px] overflow-hidden bg-[rgba(249,249,249,0.94)] backdrop-blur-md">
          <button
            type="button"
            onClick={onClose}
            data-tutorial="schaden-quelle-abbrechen"
            className={`${zeile} font-semibold`}
            style={schrift}
          >
            {t('misc.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FotoQuelleBlatt;
