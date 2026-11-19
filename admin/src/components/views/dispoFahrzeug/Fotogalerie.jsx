import React, { useEffect, useState } from 'react';
import { useI18n } from '../../../i18n';

// Die Fotomediathek des iPhones, nachgebaut: helles Blatt, das von unten
// hereinfaehrt, oben das Kreuz zum Schliessen, der Umschalter Fotos/Alben und
// die HD-Marke, darunter das dreispaltige Raster. Auch das ist die Oberflaeche
// des Geraets, nicht die von TRISAR — auf einem echten Handy oeffnet das
// System seine eigene Auswahl.

// Die Aufnahmen im Geraet. Vorne die drei Bilder des Schadens, dahinter
// aeltere Aufnahmen.
const AUFNAHMEN = [
  `${import.meta.env.BASE_URL}schaden/felge-01.jpg`,
  `${import.meta.env.BASE_URL}schaden/felge-02.jpg`,
  `${import.meta.env.BASE_URL}schaden/felge-03.jpg`,
  '/fahrzeuge/m5-marina-bay-blau-metallic.png',
  '/fahrzeuge/7er-neue-klasse-tansanitblau-metallic.png',
  '/fahrzeuge/x7-saphirschwarz.png',
  '/fahrzeuge/ix-aventurinrot-metallic.png',
  '/fahrzeuge/740-alpinweiss.png',
  '/fahrzeuge/x5-vancouver-green.png',
  '/fahrzeuge/ix3-neue-klasse-urbangruen.png',
  '/fahrzeuge/740-oxidgrau-metallic.png',
  '/fahrzeuge/m5-saphirschwarz.png',
];

const schrift = { fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif' };

const KreuzIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.5 1.5 L15.5 15.5 M15.5 1.5 L1.5 15.5" stroke="#1c1c1e" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

const Fotogalerie = ({ onClose, onConfirm }) => {
  const { t } = useI18n();
  const [gewaehlt, setGewaehlt] = useState([]);
  const [oben, setOben] = useState(false);
  // Kurz nach dem Einhaengen faehrt das Blatt herein. Bewusst ueber eine Uhr
  // statt ueber den Bildtakt — ein Fenster im Hintergrund haelt den Bildtakt an,
  // das Blatt bliebe dann unten stehen.
  useEffect(() => {
    const id = setTimeout(() => setOben(true), 20);
    return () => clearTimeout(id);
  }, []);

  const umschalten = (url) => {
    setGewaehlt((alt) => (alt.includes(url) ? alt.filter((u) => u !== url) : [...alt, url]));
  };

  // Die Fussleiste steht fest am unteren Rand — das Blatt endet darueber.
  return (
    <div
      className="absolute left-0 right-0 top-0 z-[120] flex flex-col justify-end"
      style={{ bottom: '40px' }}
      data-tutorial="schaden-galerie-blatt"
    >
      <button type="button" aria-label="" onClick={onClose} className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-[#f2f2f7] rounded-t-[14px] overflow-hidden"
        style={{
          height: '74%',
          transform: oben ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 340ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        {/* Kopfzeile: Schliessen, Umschalter, HD */}
        <div className="h-[64px] px-[14px] flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            data-tutorial="schaden-galerie-zu"
            className="w-[38px] h-[38px] rounded-full bg-[rgba(118,118,128,0.14)] flex items-center justify-center"
          >
            <KreuzIcon />
          </button>

          <div className="h-[34px] p-[2px] rounded-[9px] bg-[rgba(118,118,128,0.14)] flex items-center">
            <span
              className="h-[30px] px-[18px] rounded-[7px] bg-white shadow-sm flex items-center text-[15px] font-medium text-[#1c1c1e]"
              style={schrift}
            >
              {t('misc.photos')}
            </span>
            <span className="h-[30px] px-[18px] flex items-center text-[15px] text-[#1c1c1e]" style={schrift}>
              {t('misc.albums')}
            </span>
          </div>

          <span
            className="w-[38px] h-[38px] rounded-full bg-[rgba(118,118,128,0.14)] flex items-center justify-center text-[13px] font-semibold text-[#1c1c1e]"
            style={schrift}
          >
            HD
          </span>
        </div>

        {/* Raster */}
        <div className="px-0 overflow-y-auto" style={{ height: 'calc(100% - 64px)' }} data-tutorial="schaden-galerie">
          <div className="grid grid-cols-3 gap-[2px]">
            {AUFNAHMEN.map((url, i) => {
              const platz = gewaehlt.indexOf(url);
              return (
                <button
                  key={url}
                  type="button"
                  onClick={() => umschalten(url)}
                  data-tutorial={`schaden-galerie-${i + 1}`}
                  className="relative bg-[#d9d9de] overflow-hidden"
                  style={{ aspectRatio: '3 / 4' }}
                >
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  {platz >= 0 ? (
                    <span
                      className="absolute right-[8px] top-[8px] w-[24px] h-[24px] rounded-full bg-[#007aff] border-2 border-white text-white text-[13px] font-semibold flex items-center justify-center"
                      style={schrift}
                    >
                      {platz + 1}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div style={{ height: '96px' }} />
        </div>

        {/* Senden — wie in der Fotoauswahl des Geraets unten rechts */}
        {gewaehlt.length ? (
          <button
            type="button"
            onClick={() => onConfirm?.(gewaehlt)}
            data-tutorial="schaden-galerie-ok"
            className="absolute right-[16px] bottom-[24px] h-[46px] px-[22px] rounded-full bg-[#007aff] text-white text-[16px] font-semibold shadow-lg"
            style={schrift}
          >
            {`${t('misc.choosePhotos')} (${gewaehlt.length})`}
          </button>
        ) : null}
      </div>
    </div>
  );
};

export default Fotogalerie;
