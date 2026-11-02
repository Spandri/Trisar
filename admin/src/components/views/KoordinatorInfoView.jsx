import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import { useI18n } from '../../i18n';

export default function KoordinatorInfoView({ title, setView }) {
  const { t } = useI18n();
  const gradientStyle = {
    background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
  };

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <button
        type="button"
        onClick={() => setView('profilKoordinator')}
        className="absolute left-[20px] top-[60px] h-[40px] px-4 border border-[#747474] text-[#e3f654] text-sm"
      >
        {t('sonstige.zurueck')}
      </button>

      <div className="absolute left-[20px] top-[180px] text-[#e3f654] text-[40px] font-bold tracking-[-0.5px]">{title}</div>
      <div className="absolute left-[20px] top-[250px] w-[362px] text-[#898889] text-[16px] leading-6">
        {t('sonstige.koordinatorInfoText')}
      </div>

      <button
        type="button"
        onClick={() => setView('list')}
        className="absolute left-[20px] top-[620px] w-[362px] h-14 bg-[#E3F654] text-[#262626] text-[16px] font-medium"
      >
        {t('sonstige.zurUebersicht')}
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
