import { useEffect, useMemo, useRef } from 'react';
import NaviFooterKomponente from './navigation/NaviFooterKomponente';
import { useI18n } from '../i18n';
import { einsatzKennzahlen } from '../demo/einsatzKennzahlen';
import { DEMO_MODE } from '../datenquelle';

const profileButtonSrc = '/icon/_Icon_Grau/Person_Trisar_Icons_01_grau.svg';
const actionArrowSrc = '/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg';
const planenSparkleSrc = '/icon/_Icon_Lime/Planen_Sparkle_Lime.svg';

// Statistics Card Component
function StatCard({ title, number, subtitle, className }) {
  return (
    <div className={`border-2 border-[#e3f654] h-[112px] w-[178px] relative ${className}`}>
      <div className="absolute left-[18px] top-[15px] text-[#e3f654] text-[14px] font-medium font-['Space_Grotesk'] opacity-50 tracking-[0.3px] leading-[24px] whitespace-nowrap">
        {title}
      </div>
      <div className="absolute left-[18px] top-[47px] text-[#e3f654] text-[30px] font-medium font-['Space_Grotesk'] tracking-[0.5px] leading-[24px] whitespace-nowrap">
        {number}
      </div>
      <div className="absolute left-[18px] top-[77px] text-[#e3f654] text-[14px] font-medium font-['Space_Grotesk'] opacity-50 tracking-[0.3px] leading-[24px] whitespace-nowrap">
        {subtitle}
      </div>
    </div>
  );
}

// Action Button Component
function ActionButton({ label, onClick, className, marker }) {
  return (
    <button 
      onClick={onClick}
      data-tutorial={marker}
      className={`w-[362px] h-[56px] bg-[#e3f654] border-2 border-[#e3f654] flex items-center justify-between px-[16px] ${className}`}
    >
      <span className="text-black text-[16px] font-medium font-['Space_Grotesk'] tracking-[0.5px] leading-[24px]">
        {label}
      </span>
      <img src={actionArrowSrc} alt="" className="w-[34px] h-[20px]" />
    </button>
  );
}

// Planungs-Knopf nach Figma 2563:12263: Lime-Rand, Lime-Schrift, Sparkle-Icon
// und ein ruhiger Hintergrund. Der Verlauf (Blau → Schwarz → Lime) dreht sich
// gleichmaessig und sehr langsam einmal im Kreis — ohne Spruenge, Pausen oder
// Richtungswechsel, damit der Knopf lebt, aber nicht ablenkt.
const PLANEN_UMDREHUNG_MS = 120000;

function PlanungsKnopf({ label, onClick, className, marker }) {
  const farbeRef = useRef(null);

  useEffect(() => {
    const el = farbeRef.current;
    if (!el || typeof el.animate !== 'function') return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;

    const anim = el.animate(
      [{ transform: 'rotate(22.66deg)' }, { transform: 'rotate(382.66deg)' }],
      { duration: PLANEN_UMDREHUNG_MS, iterations: Infinity, easing: 'linear' },
    );

    return () => anim.cancel();
  }, []);

  return (
    <button
      type="button"
      onClick={onClick}
      data-tutorial={marker}
      className={`relative w-[362px] h-[56px] border-2 border-[#e2f754] bg-black overflow-hidden isolate flex items-center justify-between pl-[22px] pr-[26px] ${className || ''}`}
    >
      <span ref={farbeRef} className="planen-farbe" aria-hidden="true" />
      <span className="relative z-[1] text-[#e3f654] text-[16px] font-medium font-['Space_Grotesk'] tracking-[0.5px] leading-[24px] whitespace-nowrap">
        {label}
      </span>
      <span className="relative z-[1] block w-[24px] h-[24.14px] shrink-0 overflow-clip">
        <img src={planenSparkleSrc} alt="" className="block w-full h-full" />
      </span>
    </button>
  );
}

// Main Home Screen Component
export default function HomeScreen({ setView, coordinatorName = 'Martin', avatarUrl = '' }) {
  const { t } = useI18n();
  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  const handleNavigateToFahrten = () => {
    setView('ankuenfte');
  };

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none pb-[110px]">
        <div className="relative min-h-[760px]">
          {/* Profile Button */}
          <div className="absolute right-[20px] top-[60px]">
            <button
              type="button"
              aria-label={t('home.openProfile')}
              onClick={() => setView('profilKoordinator')}
              data-tutorial="profil-knopf"
              className="w-[52px] h-[52px] rounded-full border border-[#8f8f90] flex items-center justify-center overflow-hidden active:scale-95 transition-transform"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt={t('home.profileImage')} className="w-full h-full object-cover rounded-full" />
              ) : (
                <img src={profileButtonSrc} alt="" className="w-[24px] h-[24px] object-contain opacity-90" />
              )}
            </button>
          </div>

          {/* Trisar Logo — mit dem vierten Knopf (Planung) ruecken Logo, Gruss
              und Kennzahlen zusammen nach oben, damit die Knopfreihe wie vorher
              21 px ueber der Navigationsleiste endet. */}
          <div className="absolute left-[20px] top-[115px]">
            <img src="/icon/_Icon_Schwarz/trisar_logo.svg" alt="Trisar" className="w-[161px] h-[24px] object-contain" />
          </div>

          {/* Welcome Text */}
          <div data-tutorial="dispo-start" className="absolute left-[20px] top-[180px] w-[362px] text-white text-[34px] font-medium font-['Space_Grotesk'] tracking-[-0.5px] leading-[normal]">
            {t('home.welcome', { name: coordinatorName })}
          </div>

          {/* Statistics Cards — Werte sind Demo-Zahlen, live gibt es noch keine
              echte Auswertung. Die Knoepfe bleiben unten an der Leiste stehen. */}
          {DEMO_MODE && (
          <div data-tutorial="kennzahlen" className="absolute left-[20px] top-[302px] flex gap-[6px]">
            <StatCard
              title={t('home.sinceStart')}
              number={einsatzKennzahlen.co2Anzeige}
              subtitle={t('home.co2')}
            />
            <StatCard
              title={t('home.sinceStart')}
              number={einsatzKennzahlen.kostenAnzeige}
              subtitle={t('home.costs')}
            />
          </div>
          )}

          {/* Action Buttons */}
          <div className="absolute left-[20px] top-[442px] space-y-[12px]">
            <PlanungsKnopf
              label={t('home.planning')}
              marker="start-planung"
              onClick={() => setView('kiPlaner')}
            />
            <ActionButton 
              label={t('home.driverList')}
              marker="start-fahrer"
              onClick={() => setView('alleFahrer')}
            />
            <ActionButton 
              label={t('home.customerList')}  
              marker="start-kunden"
              onClick={() => setView('alleKunden')}
            />
            <ActionButton
              label={t('home.vehicleList')}
              marker="start-fahrzeuge"
              onClick={() => setView('fahrzeugListe')}
            />
          </div>
        </div>
      </div>

      {/* Navigation Footer */}
      <NaviFooterKomponente 
        onNavigateToFahrten={handleNavigateToFahrten}
        onNavigateToVehicles={() => setView('fahrzeugListe')}
        onNavigateToProfile={() => setView('alleFahrer')}
        onNavigateHome={() => setView('list')}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToPlanung={() => setView('kiPlaner')}
        onNavigateToMap={() => setView('karten')}
        activeTab="home"
      />
    </div>
  );
}
