import { useEffect, useState } from 'react';
import {
  Accessibility,
  Baby,
  BaggageClaim,
  ChevronDown,
  Mail,
  Star,
} from 'lucide-react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { supabase, supabaseAdmin } from '../../services/supabase';

const GUEST_LANGUAGES = [
  'Deutsch',
  'Englisch',
  'Spanisch',
  'Franzoesisch',
  'Italienisch',
  'Portugiesisch',
  'Niederlaendisch',
  'Polnisch',
];

const toBool = (value) => value === true || value === 1 || value === '1' || value === 'true';

const normalizePhone = (phone = '') => {
  const value = String(phone || '').trim();
  if (!value) return { country: '+49', local: '' };
  const match = value.match(/^(\+\d{1,4})\s*(.*)$/);
  if (match) return { country: match[1], local: match[2] || '' };
  return { country: '+49', local: value };
};

const emptyGuest = { firstName: '', lastName: '', phone: '', email: '' };
const emptyGuestExtended = {
  countryCode: '+49',
  street: '',
  streetNumber: '',
  city: '',
  zip: '',
  language: 'Deutsch',
  note: '',
  vip: false,
  accessibility: false,
  childSeat: false,
  luggage: false,
};

export default function FahrgastErstellenView({ setView, initialGuest = null }) {
  const isEditMode = Boolean(initialGuest?.id);
  const [guestForm, setGuestForm] = useState(emptyGuest);
  const [guestExtendedForm, setGuestExtendedForm] = useState(emptyGuestExtended);
  const [guestLanguageOpen, setGuestLanguageOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      if (!isEditMode) {
        setGuestForm(emptyGuest);
        setGuestExtendedForm(emptyGuestExtended);
        setFeedback('');
        return;
      }

      setFeedback('');
      setGuestForm({
        firstName: String(initialGuest?.firstName || '').trim(),
        lastName: String(initialGuest?.lastName || '').trim(),
        phone: String(initialGuest?.phone || '').trim(),
        email: String(initialGuest?.email || '').trim(),
      });
      setGuestExtendedForm((prev) => ({
        ...prev,
        street: String(initialGuest?.street || '').trim(),
        streetNumber: String(initialGuest?.streetNumber || '').trim(),
        city: String(initialGuest?.city || '').trim(),
        zip: String(initialGuest?.zip || '').trim(),
        language: String(initialGuest?.language || 'Deutsch').trim() || 'Deutsch',
        note: String(initialGuest?.notes || '').trim(),
      }));

      try {
        const { data, error } = await supabase.from('guests').select('*').eq('id', initialGuest.id).maybeSingle();
        if (!mounted) return;
        if (error || !data) return;

        const phoneParts = normalizePhone(data.phone || '');
        setGuestForm({
          firstName: String(data.first_name || '').trim(),
          lastName: String(data.last_name || '').trim(),
          phone: phoneParts.local,
          email: String(data.email || '').trim(),
        });
        setGuestExtendedForm({
          countryCode: phoneParts.country,
          street: String(data.street || '').trim(),
          streetNumber: String(data.street_number || '').trim(),
          city: String(data.city || '').trim(),
          zip: String(data.zip || '').trim(),
          language: String(data.language || 'Deutsch').trim() || 'Deutsch',
          note: String(data.notes || data.note_text || '').trim(),
          vip: toBool(data.is_vip) || toBool(data.vip_status),
          accessibility: toBool(data.needs_accessibility),
          childSeat: toBool(data.needs_child_seat),
          luggage: toBool(data.needs_luggage),
        });
      } catch {
        // best effort
      }
    };
    hydrate();
    return () => {
      mounted = false;
    };
  }, [isEditMode, initialGuest]);

  const saveWithColumnFallback = async (client, type, payload, id) => {
    let mutablePayload = { ...payload };
    for (let i = 0; i < 20; i += 1) {
      const result = type === 'update'
        ? await client.from('guests').update(mutablePayload).eq('id', id)
        : await client.from('guests').insert([mutablePayload]);
      if (!result.error) return null;

      const message = result.error.message || '';
      const missingColumnMatch =
        message.match(/Could not find the ['"]?([a-zA-Z0-9_]+)['"]? column/i) ||
        message.match(/column ["']?([a-zA-Z0-9_]+)["']?/i);
      const column = missingColumnMatch?.[1];
      if (column && Object.prototype.hasOwnProperty.call(mutablePayload, column)) {
        const { [column]: _removed, ...rest } = mutablePayload;
        mutablePayload = rest;
        continue;
      }
      return result.error;
    }
    return new Error('Fahrgast konnte nicht gespeichert werden.');
  };

  const createGuest = async (event) => {
    event.preventDefault();
    if (!guestForm.firstName.trim() || !guestForm.lastName.trim()) {
      setFeedback('Bitte Vorname und Nachname angeben.');
      return;
    }

    setIsSubmitting(true);
    setFeedback('');
    const payload = {
      first_name: guestForm.firstName.trim(),
      last_name: guestForm.lastName.trim(),
      phone: `${guestExtendedForm.countryCode || ''} ${guestForm.phone || ''}`.trim() || null,
      email: guestForm.email.trim() || null,
      street: guestExtendedForm.street.trim() || null,
      street_number: guestExtendedForm.streetNumber.trim() || null,
      city: guestExtendedForm.city.trim() || null,
      zip: guestExtendedForm.zip.trim() || null,
      language: guestExtendedForm.language || 'Deutsch',
      notes: guestExtendedForm.note.trim() || null,
      note_text: guestExtendedForm.note.trim() || null,
      is_vip: !!guestExtendedForm.vip,
      vip_status: !!guestExtendedForm.vip,
      needs_accessibility: !!guestExtendedForm.accessibility,
      needs_child_seat: !!guestExtendedForm.childSeat,
      needs_luggage: !!guestExtendedForm.luggage,
    };

    try {
      const targetId = String(initialGuest?.id || '').trim();
      let err = await saveWithColumnFallback(supabaseAdmin, isEditMode ? 'update' : 'insert', payload, targetId);

      if (err) {
        const fallbackAllowed = /invalid jwt|signature is invalid|not allowed|unauthorized|permission denied/i.test(err.message || '');
        if (!fallbackAllowed) throw err;
        err = await saveWithColumnFallback(supabase, isEditMode ? 'update' : 'insert', payload, targetId);
      }
      if (err) throw err;

      setFeedback(isEditMode ? 'Fahrgast gespeichert.' : 'Fahrgast angelegt.');
      if (!isEditMode) {
        setGuestForm(emptyGuest);
        setGuestExtendedForm(emptyGuestExtended);
      }
    } catch (error) {
      setFeedback(`Fahrgast konnte nicht gespeichert werden: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden overscroll-none"
      style={{ background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #313701 0%, #000 46%, #000 84%, #000 100%)' }}
    >
      <div className="h-full overflow-y-auto overscroll-none px-5 pt-[60px] pb-8">
        <BackCircleButton onClick={() => setView('alleKunden')} />

        <form onSubmit={createGuest} className="mt-[28px] space-y-3">
          <h2 className="text-[42px] leading-[42px] font-black tracking-tighter text-[#E3F654]">
            {isEditMode ? 'Fahrgast bearbeiten' : 'Fahrgast erstellen'}
          </h2>

          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={guestForm.firstName} onChange={(e) => setGuestForm((p) => ({ ...p, firstName: e.target.value }))} placeholder="Vorname" className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />
            <input type="text" value={guestForm.lastName} onChange={(e) => setGuestForm((p) => ({ ...p, lastName: e.target.value }))} placeholder="Nachname" className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />
          </div>

          <div className="relative">
            <input type="email" value={guestForm.email} onChange={(e) => setGuestForm((p) => ({ ...p, email: e.target.value }))} placeholder="E-Mail" className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 pr-12 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />
            <Mail size={20} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#E3F654]" />
          </div>

          <div className="grid grid-cols-[90px_1fr] gap-2">
            <input type="text" value={guestExtendedForm.countryCode} onChange={(e) => setGuestExtendedForm((p) => ({ ...p, countryCode: e.target.value }))} placeholder="+49" className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />
            <input type="text" value={guestForm.phone} onChange={(e) => setGuestForm((p) => ({ ...p, phone: e.target.value }))} placeholder="Telefon" className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />
          </div>

          <div className="grid grid-cols-[1fr_86px] gap-2">
            <input type="text" value={guestExtendedForm.street} onChange={(e) => setGuestExtendedForm((p) => ({ ...p, street: e.target.value }))} placeholder="Strasse" className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />
            <input type="text" value={guestExtendedForm.streetNumber} onChange={(e) => setGuestExtendedForm((p) => ({ ...p, streetNumber: e.target.value }))} placeholder="Nr." className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />
          </div>

          <input type="text" value={guestExtendedForm.city} onChange={(e) => setGuestExtendedForm((p) => ({ ...p, city: e.target.value }))} placeholder="Ort" className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />

          <div className="grid grid-cols-2 gap-2">
            <input type="text" value={guestExtendedForm.zip} onChange={(e) => setGuestExtendedForm((p) => ({ ...p, zip: e.target.value }))} placeholder="PLZ" className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] placeholder:text-[#E3F654]/60 text-base font-medium focus:outline-none" />
            <div className="relative">
              <button
                type="button"
                onClick={() => setGuestLanguageOpen((prev) => !prev)}
                className="w-full h-14 bg-transparent border-2 border-[#E3F654] px-4 text-[#E3F654] text-base font-medium flex items-center justify-between"
              >
                <span>{guestExtendedForm.language}</span>
                <ChevronDown size={22} />
              </button>
              {guestLanguageOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-[#161618] border border-[#E3F654] rounded-lg z-20 overflow-hidden">
                  {GUEST_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      onClick={() => {
                        setGuestExtendedForm((prev) => ({ ...prev, language: lang }));
                        setGuestLanguageOpen(false);
                      }}
                      className="w-full text-left px-3 py-2 text-sm font-bold text-[#E3F654] hover:bg-[#222224]"
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-4 gap-2">
            <button type="button" onClick={() => setGuestExtendedForm((p) => ({ ...p, vip: !p.vip }))} className={`h-12 rounded-lg border-2 flex items-center justify-center ${guestExtendedForm.vip ? 'border-[#E3F654] text-[#E3F654]' : 'border-[#7f8a2b] text-[#7f8a2b]'}`}><Star size={22} /></button>
            <button type="button" onClick={() => setGuestExtendedForm((p) => ({ ...p, accessibility: !p.accessibility }))} className={`h-12 rounded-lg border-2 flex items-center justify-center ${guestExtendedForm.accessibility ? 'border-[#E3F654] text-[#E3F654]' : 'border-[#7f8a2b] text-[#7f8a2b]'}`}><Accessibility size={22} /></button>
            <button type="button" onClick={() => setGuestExtendedForm((p) => ({ ...p, childSeat: !p.childSeat }))} className={`h-12 rounded-lg border-2 flex items-center justify-center ${guestExtendedForm.childSeat ? 'border-[#E3F654] text-[#E3F654]' : 'border-[#7f8a2b] text-[#7f8a2b]'}`}><Baby size={22} /></button>
            <button type="button" onClick={() => setGuestExtendedForm((p) => ({ ...p, luggage: !p.luggage }))} className={`h-12 rounded-lg border-2 flex items-center justify-center ${guestExtendedForm.luggage ? 'border-[#E3F654] text-[#E3F654]' : 'border-[#7f8a2b] text-[#7f8a2b]'}`}><BaggageClaim size={22} /></button>
          </div>

          <div className="bg-[#1a1a1a] rounded-[12px] h-[224px] relative" style={{ marginTop: '30px' }}>
            <div className="absolute left-[20px] right-[20px] top-[20px] bottom-[20px] bg-white overflow-hidden">
              <div className="p-4 h-full flex flex-col">
                <div className="flex items-center justify-between mb-2">
                  <h3
                    className="text-[#1d1c1d] text-[16px] font-bold tracking-[0.5px]"
                    style={{ fontFamily: 'Space Grotesk' }}
                  >
                    Notizen
                  </h3>
                  <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
                </div>
                <textarea
                  value={guestExtendedForm.note}
                  onChange={(e) => setGuestExtendedForm((p) => ({ ...p, note: e.target.value }))}
                  placeholder="Schreiben..."
                  className="flex-1 text-[14px] text-[rgba(129,129,129,0.5)] resize-none border-none outline-none bg-transparent tracking-[0.25px]"
                  style={{ fontFamily: 'Space Grotesk' }}
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="w-full h-16 bg-[#E3F654] text-black px-5 flex items-center justify-between text-lg font-bold"
            style={{ marginTop: '30px' }}
            disabled={isSubmitting}
          >
            <span>{isSubmitting ? 'Speichern ...' : (isEditMode ? 'Fahrgast speichern' : 'Fahrgast erstellen')}</span>
            <img src="/icon/_Icon_Schwarz/Arrow_Nav_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
          </button>

          {feedback ? (
            <div className="bg-[#17181c] border border-[#2a2a2d] rounded-xl p-3 text-xs text-[#E3F654] whitespace-pre-line">
              {feedback}
            </div>
          ) : null}
        </form>

        <div className="mt-[30px]">
          <TrisarFooter className="h-10 bg-black" />
        </div>
      </div>
    </div>
  );
}
