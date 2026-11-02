import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import { useI18n } from '../../i18n';

const drivers = [
  { id: 'd1', name: 'Horst Engel', status: 'verfügbar' },
  { id: 'd2', name: 'Mara Stein', status: 'auf Fahrt' },
  { id: 'd3', name: 'Daniel Koch', status: 'Pause' },
];

export default function FahrerListeView({ setView }) {
  const { t } = useI18n();
  const gradientStyle = {
    background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
  };

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <button
        type="button"
        onClick={() => setView('list')}
        className="absolute left-[20px] top-[60px] h-[40px] px-4 border border-[#747474] text-[#e3f654] text-sm"
      >
        {t('sonstige.zurueck')}
      </button>
      <button
        type="button"
        onClick={() => setView('profilKoordinator')}
        className="absolute right-[20px] top-[60px] h-[40px] px-4 border border-[#747474] text-[#e3f654] text-sm"
      >
        {t('sonstige.profil')}
      </button>

      <div className="absolute left-[20px] top-[130px] text-[#e3f654] text-[42px] leading-[42px] font-bold tracking-[-0.5px]">{t('sonstige.fahrerListe')}</div>

      <div className="absolute left-[20px] top-[200px] w-[362px] space-y-2">
        {drivers.map((driver) => (
          <div key={driver.id} className="bg-[#101010] border border-[#2f2f2f] p-4">
            <div className="text-white text-[18px]">{driver.name}</div>
            <div className="text-[#898889] text-[14px] mt-1">{t('sonstige.status', { status: driver.status })}</div>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setView('kundenListe')}
        className="absolute left-[20px] top-[640px] w-[362px] h-14 bg-[#E3F654] text-[#262626] text-[16px] font-medium"
      >
        {t('sonstige.zurKundenListe')}
      </button>

      <NaviFooterKomponente
        onNavigateHome={() => setView('list')}
        onNavigateToFahrten={() => setView('ankuenfte')}
        onNavigateToVehicles={() => setView('fahrzeugListe')}
        onNavigateToProfile={() => setView('alleFahrer')}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToPlanung={() => setView('kiPlaner')}
        onNavigateToMap={() => setView('karten')}
        activeTab="home"
      />
    </div>
  );
}
