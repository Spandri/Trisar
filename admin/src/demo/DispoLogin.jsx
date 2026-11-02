// Anmeldung der Disposition für den Rundgang (?login=1): E-Mail und Passwort
// werden sichtbar eingetippt, dann meldet sich die App selbst an und gibt dem
// Rahmen Bescheid ({ trisar: 'trailer-fertig' }). Gestaltung wie die Anmeldung
// der Fahrer-App. Die Demo braucht kein echtes Konto, das Passwort ist nur Punkte.
import { useEffect, useState } from 'react';
import TrisarFooter from '../components/ui/TrisarFooter';

const MAIL = 'disposition@trisar.de';
const PUNKTE = 10;

const HINTERGRUND = {
  backgroundImage:
    "url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 402 874' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><rect x='0' y='0' height='100%' width='100%' fill='url(%23grad)' opacity='1'/><defs><radialGradient id='grad' gradientUnits='userSpaceOnUse' cx='0' cy='0' r='10' gradientTransform='matrix(40.2 87.4 -40.2 18.49 0 0)'><stop stop-color='rgba(0,45,128,1)' offset='0'/><stop stop-color='rgba(0,22,64,1)' offset='0.2283'/><stop stop-color='rgba(0,11,32,1)' offset='0.34244'/><stop stop-color='rgba(0,0,0,1)' offset='0.45659'/><stop stop-color='rgba(0,0,0,1)' offset='1'/></radialGradient></defs></svg>\")",
};

export default function DispoLogin({ onFertig }) {
  const [mail, setMail] = useState('');
  const [punkte, setPunkte] = useState(0);
  const [gedrueckt, setGedrueckt] = useState(false);
  const [weg, setWeg] = useState(false);

  useEffect(() => {
    let ab = false;
    const schlafen = (ms) => new Promise((r) => { setTimeout(r, ms); });
    (async () => {
      await schlafen(900);
      for (let i = 1; i <= MAIL.length && !ab; i += 1) {
        setMail(MAIL.slice(0, i));
        // eslint-disable-next-line no-await-in-loop
        await schlafen(70);
      }
      await schlafen(450);
      for (let i = 1; i <= PUNKTE && !ab; i += 1) {
        setPunkte(i);
        // eslint-disable-next-line no-await-in-loop
        await schlafen(110);
      }
      await schlafen(500);
      if (ab) return;
      setGedrueckt(true);
      await schlafen(350);
      setGedrueckt(false);
      setWeg(true);
      await schlafen(450);
      if (ab) return;
      onFertig?.();
      try { window.parent?.postMessage({ trisar: 'trailer-fertig' }, '*'); } catch { /* kein Rahmen */ }
    })();
    return () => { ab = true; };
  }, [onFertig]);

  return (
    <div
      data-tutorial="dispo-login"
      className="fixed inset-0 z-[500] flex justify-center bg-black transition-opacity duration-500"
      style={{ opacity: weg ? 0 : 1 }}
    >
      <div className="relative w-[min(402px,100vw)] h-full overflow-hidden" style={HINTERGRUND}>
        <img src="/icon/_Icon_Schwarz/trisar_logo.svg" alt="trisar" className="absolute left-5 top-[117px] w-[162px] h-6 object-contain object-left" />
        <p className="absolute left-5 top-[160px] text-[13px] text-[#9ab4ff] tracking-[0.5px]">Disposition</p>
        <div className="absolute left-5 top-[212px] w-[362px] flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <span className="text-[#e3f754] text-[13px] font-medium pl-1">E-Mail</span>
            <div className="w-full bg-[#242525] border border-[#3a3a3a] text-[#e8e8e8] text-[15px] px-4 py-4 min-h-[56px]">
              {mail || <span className="text-[#868786]">deine@email.de</span>}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-[#e3f754] text-[13px] font-medium pl-1">Passwort</span>
            <div className="w-full bg-[#242525] border border-[#3a3a3a] text-[#e8e8e8] text-[15px] px-4 py-4 min-h-[56px] tracking-[3px]">
              {punkte ? '•'.repeat(punkte) : <span className="text-[#868786] tracking-normal">••••••••</span>}
            </div>
          </div>
          <div
            className="w-full bg-[#e3f754] text-black py-4 text-[15px] font-bold text-center transition-all"
            style={gedrueckt ? { transform: 'scale(0.97)', filter: 'brightness(0.85)' } : undefined}
          >
            Anmelden
          </div>
        </div>
        <TrisarFooter className="absolute bottom-0 left-0 right-0 h-10 bg-black" />
      </div>
    </div>
  );
}
