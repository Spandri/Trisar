import { useEffect, useMemo, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
import { supabase, supabaseAdmin } from '../../services/supabase';
import { useI18n } from '../../i18n';

const GUESTS_RELOAD_EVENT = 'trisar:admin:guests:reload';

function CustomerCard({ customer, onClick }) {
  const { t } = useI18n();
  return (
    <button type="button" onClick={() => onClick?.(customer)} data-tutorial={customer?.id ? `kunde-${customer.id}` : undefined} className="w-full h-[96px] inline-flex flex-col justify-start items-start gap-[10px] text-left">
      <div className="self-stretch flex-1 bg-white flex flex-col justify-center items-start overflow-hidden">
        <div className="self-stretch flex-1 pl-[16px] pr-[18px] py-[10px] rounded inline-flex justify-start items-center gap-[12px]">
          <div className="flex-1 min-h-[32px] inline-flex flex-col justify-center items-start gap-[5px]">
            <div className="self-stretch text-zinc-900/80 text-xs font-medium font-['Space_Grotesk'] leading-4 tracking-wide">
              {t('sonstige.fahrgast')}
            </div>
            <div className="self-stretch text-zinc-900 text-base font-bold font-['Space_Grotesk'] leading-6 tracking-wide truncate">
              {customer.name}
            </div>
            <div className="self-stretch h-5 text-zinc-500 text-sm font-medium font-['Space_Grotesk'] leading-5 tracking-tight truncate">
              {customer.email || customer.phone || '-'}
            </div>
          </div>
          <div className="min-h-7 flex justify-end items-center">
            <img src="/icon/_Icon_Schwarz/Edit_Trisar_Icon_01.svg" alt="" className="w-[15px] h-[15px]" />
          </div>
        </div>
      </div>
    </button>
  );
}

export default function AlleKunden({ setView, onCreateGuest, onEditGuest }) {
  const { t } = useI18n();
  const [searchTerm, setSearchTerm] = useState('');
  const [guests, setGuests] = useState([]);
  const [loadingGuests, setLoadingGuests] = useState(true);
  const [guestsError, setGuestsError] = useState('');

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const previous = {
      html: html.style.overscrollBehavior,
      body: body.style.overscrollBehavior,
      root: root ? root.style.overscrollBehavior : '',
    };

    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    if (root) root.style.overscrollBehavior = 'none';

    return () => {
      html.style.overscrollBehavior = previous.html;
      body.style.overscrollBehavior = previous.body;
      if (root) root.style.overscrollBehavior = previous.root;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const loadGuests = async () => {
      setLoadingGuests(true);
      setGuestsError('');
      try {
        let result = await supabase.from('guests').select('*').order('last_name', { ascending: true });
        if (result.error) {
          const fallbackAllowed = /invalid jwt|signature is invalid|not allowed|unauthorized|permission denied/i.test(result.error.message || '');
          if (fallbackAllowed) {
            result = await supabaseAdmin.from('guests').select('*').order('last_name', { ascending: true });
          }
        }
        if (!mounted) return;
        if (result.error) throw result.error;
        const mapped = (result.data || []).map((row) => ({
          id: row.id,
          firstName: String(row.first_name || '').trim(),
          lastName: String(row.last_name || '').trim(),
          name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || t('sonstige.ohneName'),
          email: String(row.email || '').trim(),
          phone: String(row.phone || '').trim(),
          language: String(row.language || '').trim(),
          street: String(row.street || '').trim(),
          streetNumber: String(row.street_number || '').trim(),
          city: String(row.city || '').trim(),
          zip: String(row.zip || '').trim(),
          notes: String(row.notes || row.note_text || '').trim(),
        }));
        setGuests(mapped);
      } catch (error) {
        if (!mounted) return;
        setGuests([]);
        setGuestsError(t('sonstige.gaesteLoadError', { message: error.message }));
      } finally {
        if (mounted) setLoadingGuests(false);
      }
    };

    loadGuests();

    const handleGuestsReload = () => {
      loadGuests();
    };
    window.addEventListener(GUESTS_RELOAD_EVENT, handleGuestsReload);

    return () => {
      mounted = false;
      window.removeEventListener(GUESTS_RELOAD_EVENT, handleGuestsReload);
    };
  }, [t]);

  useEffect(() => {
    const channel = supabase
      .channel(`admin-guests-live-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests' }, () => {
        window.dispatchEvent(new Event(GUESTS_RELOAD_EVENT));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredCustomers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return guests;
    return guests.filter((c) =>
      [c.name, c.email, c.phone].some((value) => String(value || '').toLowerCase().includes(q)),
    );
  }, [searchTerm, guests]);

  const handleBack = () => {
    setView('list');
  };

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden overscroll-none" style={gradientStyle}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none pb-[157px]">
        <div className="px-[20px] pt-[60px]">
          <BackCircleButton onClick={handleBack} marker="kunden-zurueck" />

          <h1 data-tutorial="kunden-liste" className="mt-[30px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">{t('sonstige.fahrgaesteTitle')}</h1>

          <button
            type="button"
            onClick={() => setView('importKunden')}
            data-tutorial="kunden-import"
            className="mt-[24px] w-[362px] h-[56px] border-2 border-[#E3F654] flex items-center justify-between px-4"
          >
            <span className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk'] tracking-[0.5px]">{t('sonstige.kundenImportieren')}</span>
            {/* TRISAR-Norm wie in den Suchfeldern: 24 x 24 px Rahmen, ~18 px Symbol.
                Import-Symbol aus Figma 2563:12262, auf diesen Rahmen zugeschnitten. */}
            <img src="/icon/_Icon_Lime/Import_Trisar_Icons_01_Lime.svg" alt="" className="block w-6 h-6 shrink-0" />
          </button>

          <div className="mt-[12px] w-[362px] h-[56px] border-2 border-[#E3F654] flex items-center justify-between px-4">
            <input
              value={searchTerm}
              data-tutorial="kunden-suche"
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={t('sonstige.kundenSuchen')}
              className="w-full bg-transparent border-none outline-none text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk'] placeholder:text-[#E3F654] placeholder:opacity-90 tracking-[0.5px]"
            />
            {/* Lupe nach TRISAR-Norm wie in den uebrigen Suchfeldern: 24 x 24 px */}
            <img src="/icon/_Icon_Schwarz/karten-filter-search.svg" alt="" className="block w-6 h-6 shrink-0" />
          </div>

          <button
            type="button"
            onClick={() => {
              if (onCreateGuest) {
                onCreateGuest();
                return;
              }
              setView('fahrgastErstellen');
            }}
            className="mt-[12px] w-[362px] h-[56px] bg-[#E3F654] border-2 border-[#E3F654] flex items-center justify-between pl-[18px] pr-[18px]"
          >
            <div className="flex items-center gap-[10px]">
              <img src="/icon/_Icon_Schwarz/Person_Trisar_Icons_01.svg" alt="" className="w-[16px] h-[19px]" />
              <span className="text-[#1d1c1d] text-[16px] font-medium font-['Space_Grotesk'] tracking-[0.5px]">{t('sonstige.fahrgastErstellen')}</span>
            </div>
            <img src="/icon/_Icon_Schwarz/alle-kunden-add-cross.svg" alt="" className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-[24px] bg-[#17181b] rounded-t-[16px] pt-[24px] px-[20px] pb-[24px]">
          <div className="space-y-[12px]">
            {loadingGuests ? <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">{t('sonstige.fahrgaesteLaden')}</div> : null}
            {!loadingGuests && guestsError ? (
              <div className="bg-[#171717] border border-[#3a3a3a] p-4 whitespace-pre-line text-[#ff8e8e] text-[13px] leading-[1.4] font-medium font-['Space_Grotesk']">
                {guestsError}
              </div>
            ) : null}
            {!loadingGuests && !guestsError && filteredCustomers.length === 0 ? (
              <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">{t('sonstige.keineFahrgaeste')}</div>
            ) : null}
            {filteredCustomers.map((customer) => (
              <CustomerCard key={customer.id} customer={customer} onClick={onEditGuest} />
            ))}
          </div>
        </div>
      </div>

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
