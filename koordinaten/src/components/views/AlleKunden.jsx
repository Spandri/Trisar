import { useEffect, useMemo, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
import { supabase, supabaseAdmin } from '../../services/supabase';

const GUESTS_RELOAD_EVENT = 'trisar:ko:guests:reload';

function CustomerCard({ customer, onClick }) {
  return (
    <button type="button" onClick={() => onClick?.(customer)} className="w-full h-[96px] inline-flex flex-col justify-start items-start gap-[10px] text-left">
      <div className="self-stretch flex-1 bg-white flex flex-col justify-center items-start overflow-hidden">
        <div className="self-stretch flex-1 pl-[16px] pr-[18px] py-[10px] rounded inline-flex justify-start items-center gap-[12px]">
          <div className="flex-1 min-h-[32px] inline-flex flex-col justify-center items-start gap-[5px]">
            <div className="self-stretch text-zinc-900/80 text-xs font-medium font-['Space_Grotesk'] leading-4 tracking-wide">
              Fahrgast
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
  const [searchTerm, setSearchTerm] = useState('');
  const [guests, setGuests] = useState([]);
  const [loadingGuests, setLoadingGuests] = useState(true);
  const [guestsError, setGuestsError] = useState('');

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, #1A1A1A 46%, #1A1A1A 84%, #1A1A1A 100%)',
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
          name: [row.first_name, row.last_name].filter(Boolean).join(' ').trim() || 'Ohne Name',
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
        setGuestsError(`Fahrgäste konnten nicht geladen werden: ${error.message}`);
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
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`ko-guests-live-${Date.now()}`)
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
          <BackCircleButton onClick={handleBack} />

          <h1 className="mt-[30px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">Fahrgäste</h1>

          <button type="button" className="mt-[32px] w-[360px] h-[56px] border-2 border-[#E3F654] flex items-center justify-between pl-[16px] pr-[18px]">
            <span className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk'] tracking-[0.5px]">Kunden importieren</span>
            <img src="/icon/_Icon_Schwarz/alle-kunden-import.svg" alt="" className="w-[18px] h-[18px]" />
          </button>

          <div className="mt-[12px] w-[360px] h-[56px] border-2 border-[#E3F654] flex items-center justify-between pl-[16px] pr-[18px]">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Kunden Suchen"
              className="w-full bg-transparent border-none outline-none text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk'] placeholder:text-[#E3F654] placeholder:opacity-90 tracking-[0.5px]"
            />
            <img src="/icon/_Icon_Schwarz/alle-kunden-search.svg" alt="" className="w-[18px] h-[18px]" />
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
            className="mt-[24px] w-[360px] h-[56px] bg-[#E3F654] border-2 border-[#E3F654] flex items-center justify-between pl-[18px] pr-[18px]"
          >
            <div className="flex items-center gap-[10px]">
              <img src="/icon/_Icon_Schwarz/Person_Trisar_Icons_01.svg" alt="" className="w-[16px] h-[19px]" />
              <span className="text-[#1d1c1d] text-[16px] font-medium font-['Space_Grotesk'] tracking-[0.5px]">Fahrgast erstellen</span>
            </div>
            <img src="/icon/_Icon_Schwarz/alle-kunden-add-cross.svg" alt="" className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-[24px] bg-[#17181b] rounded-t-[16px] pt-[24px] px-[20px] pb-[24px]">
          <div className="space-y-[10px]">
            {loadingGuests ? <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">Fahrgäste werden geladen ...</div> : null}
            {!loadingGuests && guestsError ? (
              <div className="bg-[#171717] border border-[#3a3a3a] p-4 whitespace-pre-line text-[#ff8e8e] text-[13px] leading-[1.4] font-medium font-['Space_Grotesk']">
                {guestsError}
              </div>
            ) : null}
            {!loadingGuests && !guestsError && filteredCustomers.length === 0 ? (
              <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">Keine Fahrgäste gefunden.</div>
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
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToMap={() => setView('karten')}
        activeTab="home"
      />
    </div>
  );
}
