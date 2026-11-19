import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n';

// Die Kamera des iPhones, nachgebaut: schwarzer Schirm, Sucher im Format 4:3,
// darunter die Betriebsarten und der Ausloeser. Auf einem echten Geraet oeffnet
// das System hier seine eigene Kamera — im Demo-Rahmen gibt es keine, deshalb
// steht im Sucher schon das Motiv, das die Aufnahme zeigen wird.
const KameraBlatt = ({ bild, onAufnahme, onClose }) => {
  const { t } = useI18n();
  const [blitz, setBlitz] = useState(false);

  // Nach dem Ausloesen kurz aufblitzen, dann die Aufnahme uebergeben.
  useEffect(() => {
    if (!blitz) return undefined;
    const id = setTimeout(() => onAufnahme?.(bild), 260);
    return () => clearTimeout(id);
  }, [blitz, bild, onAufnahme]);

  const schrift = { fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif' };

  return (
    // Die Kamera deckt den ganzen Schirm ab — auch die Fussleiste.
    <div className="fixed inset-0 z-[140] bg-black" data-tutorial="schaden-kamera">
      {/* Kopfzeile: Blitz und HDR wie in der Kamera des Geraets */}
      <div className="absolute left-0 right-0 top-[44px] h-[44px] px-[20px] flex items-center justify-between text-white/90">
        <span className="text-[15px]" style={schrift}>⚡︎</span>
        <span className="text-[13px] tracking-[0.5px]" style={schrift}>HDR</span>
        <span className="text-[15px]" style={schrift}>◠</span>
      </div>

      {/* Sucher */}
      <div className="absolute left-0 right-0" style={{ top: '110px', height: '536px' }}>
        <img src={bild} alt="" className="w-full h-full object-cover" />
      </div>

      {/* Betriebsarten */}
      <div className="absolute left-0 right-0 flex items-center justify-center gap-[22px]" style={{ top: '672px' }}>
        <span className="text-white/60 text-[13px] tracking-[1px]" style={schrift}>VIDEO</span>
        <span className="text-[#ffd60a] text-[13px] tracking-[1px] font-semibold" style={schrift}>FOTO</span>
        <span className="text-white/60 text-[13px] tracking-[1px]" style={schrift}>PORTRÄT</span>
      </div>

      {/* Ausloeser, Abbrechen, Kamerawechsel */}
      <div className="absolute left-0 right-0 flex items-center justify-between px-[28px]" style={{ top: '716px' }}>
        <button type="button" onClick={onClose} data-tutorial="schaden-kamera-abbrechen" className="text-white text-[16px]" style={schrift}>
          {t('misc.cancel')}
        </button>

        <button
          type="button"
          onClick={() => setBlitz(true)}
          data-tutorial="schaden-kamera-ausloeser"
          className="w-[74px] h-[74px] rounded-full border-[4px] border-white flex items-center justify-center"
        >
          <span className="w-[60px] h-[60px] rounded-full bg-white" />
        </button>

        <span className="w-[42px] h-[42px] rounded-full bg-white/20 flex items-center justify-center text-white text-[16px]" style={schrift}>
          ⟳
        </span>
      </div>

      {blitz ? (
        <span
          className="absolute inset-0 bg-white pointer-events-none"
          style={{ animation: 'none', opacity: 0.9, transition: 'opacity 240ms ease-out' }}
        />
      ) : null}
    </div>
  );
};

export default KameraBlatt;
