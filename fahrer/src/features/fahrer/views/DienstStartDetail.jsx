// Dienststart mit Treffpunkt, angetippt in der Fahrtenliste (13.11.). Aufbau wie eine Fahrt
// (SoloNormal): oben die Karte mit der Route vom Standort zum Treffpunkt, darunter das
// ziehbare Blatt mit Dienststart, Ort (antippen = Navigation) und der Notiz der Dispo.
import React from 'react';
import { useI18n } from '../../../i18n';
import { useBlattZiehen } from './blattZiehen';
import { RouteMapTop } from './SoloNormal';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import { getNavigationUrl } from '../../../shared/utils/navigation';
import { treffpunktAlsOrt, treffpunktIcon } from '../../../shared/dienstTreffpunkt';

const LIME = '#e2f754';
const GRAU = '#868786';

const MapBackIcon = () => (
  <span className="block w-[50px] h-[50px] rounded-full bg-black overflow-hidden">
    <img src="/icon/_Icon_Karte/Backbutton_Karte.svg?v=2" alt="" className="w-[50px] h-[50px] object-contain" />
  </span>
);

const datumText = (iso, locale) => {
  const d = new Date(`${String(iso || '').slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(locale, { weekday: 'long', day: '2-digit', month: '2-digit' });
};

export default function DienstStartDetail({ dienst, standort, setView }) {
  const { t, locale } = useI18n();
  const {
    hoehe: sheetHeight,
    zieht: isDragging,
    blattRef,
    feldRef,
    scrollRef,
    ziehStart,
    ziehBewegung,
    ziehEnde,
    inhaltStart,
    inhaltBewegung,
  } = useBlattZiehen(50);

  const tp = dienst?.treffpunkt || null;
  const ort = treffpunktAlsOrt(tp);
  const zeit = String(dienst?.service_start_time || dienst?.serviceStartTime || '').slice(0, 5) || '--:--';
  const tag = dienst?.service_date || dienst?.serviceDate || '';
  const navUrl = ort ? getNavigationUrl(ort) : '';
  // Fuer die Karte wie eine laufende Fahrt: Route vom Standort zum Treffpunkt, Flagge am Ziel.
  const kartenFahrt = {
    id: `dienst-${dienst?.id || ''}`,
    status: 'started',
    from: ort,
    to: ort,
    driverLiveLat: standort?.lat,
    driverLiveLng: standort?.lng,
    driverLiveCapturedAt: standort?.erfasst || null,
  };
  const geaendert = tp?.aktualisiert ? new Date(tp.aktualisiert) : null;
  const notizZeit = geaendert && !Number.isNaN(geaendert.getTime())
    ? { zeit: geaendert.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }), datum: geaendert.toLocaleDateString(locale) }
    : { zeit: '', datum: '' };

  return (
    <div
      className="flex flex-col h-screen bg-[#0a0a0a] max-w-md mx-auto relative overflow-hidden font-['Space_Grotesk'] text-white"
      data-tutorial={`dienst-detail-${dienst?.id || ''}`}
      onMouseMove={ziehBewegung}
      onMouseUp={ziehEnde}
      onTouchMove={ziehBewegung}
      onTouchEnd={ziehEnde}
      onMouseLeave={ziehEnde}
    >
      <div className="flex-1 relative">
        <div aria-hidden="true" ref={feldRef} className="absolute left-0 right-0 top-0 pointer-events-none" style={{ bottom: `${sheetHeight}%` }} />
        {ort ? (
          <RouteMapTop job={kartenFahrt} showBack={false} openToken={kartenFahrt.id} sheetHeight={sheetHeight} />
        ) : (
          <div className="absolute inset-0 bg-[#101112]" />
        )}
        <button type="button" onClick={() => setView?.('list')} className="absolute left-[20px] top-[60px] w-[50px] h-[50px] z-40 shadow-[0_4px_16px_rgba(0,0,0,0.45)] rounded-full" aria-label="Zurück">
          <MapBackIcon />
        </button>
      </div>

      <div
        ref={blattRef}
        className={`absolute bottom-0 left-0 right-0 bg-[#1a1a1a] rounded-t-[20px] z-30 flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.5)] will-change-[height] ${!isDragging ? 'transition-[height] duration-[320ms] ease-[cubic-bezier(0.22,1,0.36,1)]' : ''}`}
        style={{ height: `${sheetHeight}%` }}
      >
        <div className="w-full pt-[18px] pb-[18px] flex justify-center cursor-grab active:cursor-grabbing" onMouseDown={ziehStart} onTouchStart={ziehStart}>
          <div className="w-[87px] h-[6px] bg-[#e2f754]" />
        </div>

        <div ref={scrollRef} className="pb-6 flex-1 overflow-y-auto overscroll-none custom-scrollbar" onTouchStart={inhaltStart} onTouchMove={inhaltBewegung}>
          <div className="px-[20px]">
            {/* Wie ETD einer Fahrt: Beschriftung klein grau, Zeit gross in Lime. */}
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[12px] font-bold tracking-[-0.3px]" style={{ color: GRAU }}>{t('misc.shiftStart', { time: '' }).trim()}</div>
                <div className="mt-[6px] text-[32px] leading-[0.88] font-bold tracking-[-1px]" style={{ color: LIME }}>{zeit}</div>
              </div>
              <div className="text-right text-[12px] font-bold tracking-[-0.3px] capitalize" style={{ color: GRAU }}>{datumText(tag, locale)}</div>
            </div>

            {tp?.name ? (
              <div className="mt-[44px] flex items-center gap-[16px]">
                <div className="w-[64px] h-[64px] bg-[#242525] rounded-[16px] flex items-center justify-center shrink-0">
                  <img src={treffpunktIcon(tp)} alt="" className="w-[30px] h-[30px] object-contain" />
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-bold tracking-[-0.5px]" style={{ color: GRAU }}>Treffpunkt</div>
                  {navUrl
                    ? <a href={navUrl} target="_blank" rel="noopener noreferrer" className="text-white text-[18px] font-bold tracking-[-0.5px] leading-[1.15] break-words block underline decoration-[#e2f754] decoration-2 underline-offset-4 active:opacity-70">{tp.name}</a>
                    : <div className="text-white text-[18px] font-bold tracking-[-0.5px] leading-[1.15] break-words">{tp.name}</div>}
                  {tp.adresse && tp.adresse !== tp.name ? (
                    <div className="mt-[4px] text-[14px] font-bold tracking-[-0.5px] leading-[1.2] break-words" style={{ color: GRAU }}>{tp.adresse}</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {tp?.notiz ? (
              <>
                {/* Notiz wie bei einer Fahrt: Titel gross in Lime, Zeit und Datum grau, Text weiss. */}
                <div className="mt-[40px] text-[58px] leading-[52px] font-bold tracking-[-1px]" style={{ color: LIME }}>{t('fahrt.note')}</div>
                <div className="mt-[12px] flex flex-col gap-[6px]">
                  <div className="flex items-center text-[16px] leading-[16px] font-bold tracking-[-0.5px]" style={{ color: GRAU }}>
                    <span>{notizZeit.zeit}</span>
                    {notizZeit.datum ? <span className="ml-[44px]">{notizZeit.datum}</span> : null}
                    <span className="ml-auto text-right">Dispo</span>
                  </div>
                  <div className="text-[#f4f5f4] text-[18px] leading-[22px] font-bold tracking-[-0.5px] whitespace-pre-line break-words">{tp.notiz}</div>
                </div>
              </>
            ) : null}

            <div className="h-[60px]" />
          </div>
          <TrisarFooter className="relative w-full h-10 bg-[#1a1a1a]" />
        </div>
      </div>
    </div>
  );
}
