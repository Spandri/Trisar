import NaviFooterKomponente from '../navigation/NaviFooterKomponente';

const drivers = [
  { id: 'd1', name: 'Horst Engel', status: 'verfügbar' },
  { id: 'd2', name: 'Mara Stein', status: 'auf Fahrt' },
  { id: 'd3', name: 'Daniel Koch', status: 'Pause' },
];

export default function FahrerListeView({ setView }) {
  const gradientStyle = {
    background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
  };

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <button
        type="button"
        onClick={() => setView('list')}
        className="absolute left-[20px] top-[60px] h-[40px] px-4 border border-[#747474] text-[#e3f654] text-sm"
      >
        Zurück
      </button>
      <button
        type="button"
        onClick={() => setView('profilKoordinator')}
        className="absolute right-[20px] top-[60px] h-[40px] px-4 border border-[#747474] text-[#e3f654] text-sm"
      >
        Profil
      </button>

      <div className="absolute left-[20px] top-[130px] text-[#e3f654] text-[42px] leading-[42px] font-bold tracking-[-0.5px]">Fahrer Liste</div>

      <div className="absolute left-[20px] top-[200px] w-[362px] space-y-2">
        {drivers.map((driver) => (
          <div key={driver.id} className="bg-[#101010] border border-[#2f2f2f] p-4">
            <div className="text-white text-[18px]">{driver.name}</div>
            <div className="text-[#898889] text-[14px] mt-1">Status: {driver.status}</div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setView('kundenListe')}
        className="absolute left-[20px] top-[640px] w-[362px] h-14 bg-[#E3F654] text-[#262626] text-[16px] font-medium"
      >
        Zur Kunden Liste
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
