import { useMemo } from 'react';
import NaviFooterKomponente from './navigation/NaviFooterKomponente';

const profileButtonSrc = '/icon/_Icon_Grau/Person_Trisar_Icons_01_grau.svg';
const actionArrowSrc = '/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg';

// Statistics Card Component
function StatCard({ title, number, subtitle, className }) {
  return (
    <div className={`border-2 border-[#e3f654] h-[112px] w-[178px] relative ${className}`}>
      <div className="absolute left-[18px] top-[15px] text-[#e3f654] text-[16px] font-medium font-['Space_Grotesk'] opacity-50 tracking-[0.5px] leading-[24px]">
        {title}
      </div>
      <div className="absolute left-[18px] top-[47px] text-[#e3f654] text-[36px] font-medium font-['Space_Grotesk'] tracking-[0.5px] leading-[24px]">
        {number}
      </div>
      <div className="absolute left-[18px] top-[77px] text-[#e3f654] text-[16px] font-medium font-['Space_Grotesk'] opacity-50 tracking-[0.5px] leading-[24px]">
        {subtitle}
      </div>
    </div>
  );
}

// Action Button Component
function ActionButton({ label, onClick, className }) {
  return (
    <button 
      onClick={onClick}
      className={`w-[362px] h-[56px] bg-[#e3f654] border-2 border-[#e3f654] flex items-center justify-between px-[16px] ${className}`}
    >
      <span className="text-black text-[16px] font-medium font-['Space_Grotesk'] tracking-[0.5px] leading-[24px]">
        {label}
      </span>
      <img src={actionArrowSrc} alt="" className="w-[34px] h-[20px]" />
    </button>
  );
}

// Main Home Screen Component
export default function HomeScreen({ setView, coordinatorName = 'Stefano' }) {
  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
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
              aria-label="Profil öffnen"
              onClick={() => setView('profilKoordinator')}
              className="w-[52px] h-[52px] rounded-full border border-[#8f8f90] flex items-center justify-center active:scale-95 transition-transform"
            >
              <img src={profileButtonSrc} alt="" className="w-[24px] h-[24px] object-contain opacity-90" />
            </button>
          </div>

          {/* Trisar Logo */}
          <div className="absolute left-[20px] top-[150px]">
            <img src="/icon/_Icon_Schwarz/trisar_logo.svg" alt="Trisar" className="w-[161px] h-[24px] object-contain" />
          </div>

          {/* Welcome Text */}
          <div className="absolute left-[20px] top-[215px] w-[362px] text-white text-[34px] font-medium font-['Space_Grotesk'] tracking-[-0.5px] leading-[normal]">
            Willkomen zurück {coordinatorName}
          </div>

          {/* Statistics Cards */}
          <div className="absolute left-[20px] top-[370px] flex gap-[6px]">
            <StatCard 
              title="Diese Woche"
              number="5"
              subtitle="offene Fahrten"
            />
            <StatCard 
              title="Diese Woche"
              number="36"
              subtitle="abgeschlossen"
            />
          </div>

          {/* Action Buttons */}
          <div className="absolute left-[20px] top-[510px] space-y-[12px]">
            <ActionButton 
              label="Fahrer Liste"
              onClick={() => setView('alleFahrer')}
            />
            <ActionButton 
              label="Kunden Liste"  
              onClick={() => setView('alleKunden')}
            />
            <ActionButton
              label="Fahrzeugliste"
              onClick={() => setView('fahrzeugListe')}
            />
          </div>
        </div>
      </div>

      {/* Navigation Footer */}
      <NaviFooterKomponente 
        onNavigateToFahrten={handleNavigateToFahrten}
        onNavigateHome={() => setView('list')}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToMap={() => setView('karten')}
        activeTab="home"
      />
    </div>
  );
}
