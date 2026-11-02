import NaviFooterKomponente from '../navigation/NaviFooterKomponente';

export default function KoordinatorInfoView({ title, setView }) {
  const gradientStyle = {
    background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
  };

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <button
        type="button"
        onClick={() => setView('profilKoordinator')}
        className="absolute left-[20px] top-[60px] h-[40px] px-4 border border-[#747474] text-[#e3f654] text-sm"
      >
        Zurück
      </button>

      <div className="absolute left-[20px] top-[180px] text-[#e3f654] text-[40px] font-bold tracking-[-0.5px]">{title}</div>
      <div className="absolute left-[20px] top-[250px] w-[362px] text-[#898889] text-[16px] leading-6">
        Diese Ansicht ist für den Koordinator-Flow aktiv verdrahtet.
      </div>

      <button
        type="button"
        onClick={() => setView('list')}
        className="absolute left-[20px] top-[620px] w-[362px] h-14 bg-[#E3F654] text-[#262626] text-[16px] font-medium"
      >
        Zur Übersicht
      </button>

      <NaviFooterKomponente
        onNavigateHome={() => setView('list')}
        onNavigateToFahrten={() => setView('ankuenfte')}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToMap={() => setView('karten')}
        activeTab="home"
      />
    </div>
  );
}
