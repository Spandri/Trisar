import React, { useEffect, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import Bildschirmtastatur from '../../../components/ui/Bildschirmtastatur';
import { tasteFuer, vorschlaegeFuer, ebeneFuer } from '../../../components/ui/tastaturHelfer';
import { useI18n } from '../../../i18n';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 864;

const screenBg = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 864' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 86.4 -40.2 18.279 0 -1.9185e-13)'><stop stop-color='rgba(49,55,1,1)' offset='0'/><stop stop-color='rgba(25,28,0,1)' offset='0.2283'/><stop stop-color='rgba(12,14,0,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='0.83626'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

// SVG Components as inline data URIs
const EditIcon = () => (
  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.16667 15.8333H5.35417L13.5 7.6875L12.3125 6.5L4.16667 14.6458V15.8333ZM2.5 17.5V13.9583L13.5 2.97917C13.6667 2.82639 13.8507 2.70833 14.0521 2.625C14.2535 2.54167 14.4653 2.5 14.6875 2.5C14.9097 2.5 15.125 2.54167 15.3333 2.625C15.5417 2.70833 15.7222 2.83333 15.875 3L17.0208 4.16667C17.1875 4.31944 17.309 4.5 17.3854 4.70833C17.4618 4.91667 17.5 5.125 17.5 5.33333C17.5 5.55556 17.4618 5.76736 17.3854 5.96875C17.309 6.17014 17.1875 6.35417 17.0208 6.52083L6.04167 17.5H2.5ZM12.8958 7.10417L12.3125 6.5L13.5 7.6875L12.8958 7.10417Z" fill="#1D1C1D"/>
  </svg>
);

const ArrowIcon = () => (
  <svg width="34" height="20" viewBox="0 0 34 20" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M29.9128 11.911L29.9128 12.6154L20.2915 16.2337L20.2915 19.916L34 14.4085L34 10.6942L34 10.0218L34 5.50692L20.2915 -0.000561531L20.2915 3.68176L29.9128 7.30005L29.9128 8.00449L-1.09799e-06 8.0045L-9.12036e-07 10.0218L-8.50053e-07 10.6942L-7.37893e-07 11.911L29.9128 11.911Z" fill="url(#paint0_linear_416_1895)"/>
    <defs>
      <linearGradient id="paint0_linear_416_1895" x1="17" y1="19.916" x2="17" y2="-0.000561258" gradientUnits="userSpaceOnUse">
        <stop stopColor="#202020"/>
        <stop offset="1"/>
      </linearGradient>
    </defs>
  </svg>
);

// Im Demo-Rahmen (iPhone auf dem Desktop) gibt es keine echte Tastatur — dort
// faehrt beim Schreiben die iOS-Bildschirmtastatur hoch wie im Login-Trailer.
// Auf einem echten Handy zeigt das System seine eigene, also keine doppelte.
const imRahmen = () => {
  try { return typeof window !== 'undefined' && window.parent && window.parent !== window; } catch { return false; }
};

// Masse des Notizfelds und der Bildschirmtastatur (Vorschlagsleiste 44,
// vier Tastenreihen 4*44 + 3*11, Streifen 34 -> 287, aufgerundet).
const NOTES_TOP = 460;
const NOTES_HOEHE = 224;
const NOTES_INNENRAND = 20;
const TASTATUR_HOEHE = 297;
const TASTATUR_ABSTAND = 20;

const NotizSend = ({ onClose, onConfirm }) => {
  const { t } = useI18n();
  const [notes, setNotes] = useState('');
  const [tastaturOben, setTastaturOben] = useState(false);
  // Faehrt die Tastatur hoch, schiebt sich die Seite nach oben, bis das Notizfeld
  // mittig im freien Bereich ueber der Tastatur steht — wie auf dem iPhone.
  const sichtbareHoehe = typeof window !== 'undefined' ? window.innerHeight : BASE_HEIGHT;
  // Beim Tippen rutscht die Seite so weit hoch, dass der Notiz-Kasten
  // 20 px ueber der Tastatur endet.
  // Der Inhalt (864 px hoch) steht mittig im Fenster; der weisse Kasten endet
  // 20 px vor dem dunklen Notizblock.
  const inhaltOben = Math.max(0, (sichtbareHoehe - BASE_HEIGHT) / 2);
  const feldUnten = inhaltOben + NOTES_TOP + NOTES_HOEHE - NOTES_INNENRAND;
  const tastaturKante = sichtbareHoehe - TASTATUR_HOEHE - TASTATUR_ABSTAND;
  const verschiebung = tastaturOben ? Math.max(0, Math.round(feldUnten - tastaturKante)) : 0;
  // Beim Tippen leuchtet die passende Taste kurz auf, die Ebene folgt dem Zeichen.
  const [getipptesZeichen, setGetipptesZeichen] = useState('');
  const [tastaturEbene, setTastaturEbene] = useState('abc');
  useEffect(() => {
    if (!getipptesZeichen) return undefined;
    const id = setTimeout(() => setGetipptesZeichen(''), 110);
    return () => clearTimeout(id);
  }, [getipptesZeichen]);
  const textAendern = (e) => {
    const neu = e.target.value;
    const zeichen = neu.length > notes.length ? neu[neu.length - 1] : '';
    setNotes(neu);
    // Spaetestens beim Schreiben faehrt die Tastatur hoch — auch wenn das
    // Fokus-Ereignis ausbleibt (z. B. Tutorial im Hintergrund-Tab).
    if (imRahmen()) setTastaturOben(true);
    if (zeichen) {
      setGetipptesZeichen(zeichen);
      const ebene = ebeneFuer(zeichen, false);
      if (ebene) setTastaturEbene(ebene);
    }
  };

  return (
    <div
      // Der Verlauf liegt auf der ganzen Flaeche, nicht auf dem 864 px hohen
      // Inhaltsblock: ist das Fenster niedriger oder faehrt der Block wegen der
      // Tastatur nach oben, wurde der helle Bogen oben sonst abgeschnitten.
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      style={screenBg}
    >
      <div
        className="relative mx-auto max-w-md w-full h-[864px]"
        style={{
          transform: `translateY(-${verschiebung}px)`,
          transition: 'transform 460ms cubic-bezier(0.22,1,0.36,1)',
        }}
      >
        
        {/* Back Button */}
        <ZurueckKnopf onClick={() => { setTastaturOben(false); onClose?.(); }} marker="notiz-zurueck" />

        {/* Title */}
        <div 
          className="absolute left-[20px] right-[20px] top-[140px]"
          style={{ height: '150px' }}
        >
          <h1 
            className="text-[#e3f754] text-[42px] font-bold tracking-[-0.5px] leading-[48px]"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            {t('misc.rideInfoTitle')}
          </h1>
        </div>

        {/* Notes Section */}
        <div 
          className="absolute left-0 right-0 bg-[#1a1a1a] rounded-[12px]"
          style={{ top: '460px', height: '224px' }}
        >
          <div 
            className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white overflow-hidden"
          >
          <div className="p-4 h-full flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 
                className="text-[#1d1c1d] text-[16px] font-bold tracking-[0.5px]"
                style={{ fontFamily: 'Space Grotesk' }}
              >
                {t('misc.notes')}
              </h3>
              <EditIcon />
            </div>
            
            <textarea
              value={notes}
              data-tutorial="notiz-text"
              onChange={textAendern}
              onFocus={() => { if (imRahmen()) setTastaturOben(true); }}
              // Antippen genuegt: die Tastatur faehrt hoch, noch bevor das
              // erste Zeichen kommt — wie auf dem iPhone.
              onClick={() => { if (imRahmen()) setTastaturOben(true); }}
              onBlur={() => setTastaturOben(false)}
              placeholder={t('misc.writePlaceholder')}
              className="flex-1 text-[14px] text-[rgba(0,0,0,0.9)] placeholder:text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
              style={{ fontFamily: 'Space Grotesk' }}
            />
          </div>
          </div>
        </div>

        {/* Cancel Button */}
        <button 
          type="button"
          data-tutorial="notiz-abschicken"
          className="absolute left-[20px] right-[20px] bg-[#e3f754] flex items-center justify-between px-6"
          style={{ top: '742px', height: '56px' }}
          onClick={() => {
            // Tastatur einfahren, bevor das Blatt schliesst — unabhaengig davon,
            // ob das Feld vorher ein Blur-Ereignis bekommen hat.
            setTastaturOben(false);
            if (onConfirm) {
              onConfirm(notes);
            }
          }}
        >
          <span 
            className="text-black text-[16px] font-bold tracking-[-0.5px]"
            style={{ fontFamily: 'Space Grotesk' }}
          >
            {t('misc.sendNote')}
          </span>
          <ArrowIcon />
        </button>

      </div>

      {/* Footer und Tastatur stehen fest — ausserhalb des verschobenen Inhalts. */}
      <TrisarFooter className="fixed bottom-0 left-0 right-0 h-10 bg-black z-30" />
      <Bildschirmtastatur
        oben={tastaturOben}
        aktiveTaste={tasteFuer(getipptesZeichen)}
        ebene={tastaturEbene}
        vorschlaege={vorschlaegeFuer(notes)}
      />
    </div>
  );
};

export default NotizSend;
