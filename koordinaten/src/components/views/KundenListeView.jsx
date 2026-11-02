import NaviFooterKomponente from '../navigation/NaviFooterKomponente';

const customers = [
  { id: 'c1', name: 'Hotel Bayerischer Hof', city: 'München' },
  { id: 'c2', name: 'Siemens Mobility', city: 'Erlangen' },
  { id: 'c3', name: 'BMW Group', city: 'München' },
];

export default function KundenListeView({ setView }) {
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

      <div className="absolute left-[20px] top-[130px] text-[#e3f654] text-[42px] leading-[42px] font-bold tracking-[-0.5px]">Kunden Liste</div>

      <div className="absolute left-[20px] top-[200px] w-[362px] space-y-2">
        {customers.map((customer) => (
          <div key={customer.id} className="bg-[#101010] border border-[#2f2f2f] p-4">
            <div className="text-white text-[18px]">{customer.name}</div>
            <div className="text-[#898889] text-[14px] mt-1">Ort: {customer.city}</div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setView('fahrerListe')}
        className="absolute left-[20px] top-[640px] w-[362px] h-14 bg-[#E3F654] text-[#262626] text-[16px] font-medium"
      >
        Zur Fahrer Liste
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
