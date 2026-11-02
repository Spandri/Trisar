import React, { useEffect, useMemo, useRef, useState } from 'react';
import TrisarFooter from '../../../components/ui/TrisarFooter';
import Bildschirmtastatur from '../../../components/ui/Bildschirmtastatur';
import { tasteFuer, vorschlaegeFuer, ebeneFuer } from '../../../components/ui/tastaturHelfer';
import { supabase } from '../../../shared/supabase/client';
import { useI18n } from '../../../i18n';
import { kolonnenNameKurz } from '../../../shared/utils/kolonnenName';
import ZurueckKnopf from '../../../components/ui/ZurueckKnopf';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 864;
const screenBg = {
  backgroundImage:
    'radial-gradient(141.42% 102.21% at 0% 0%, #313701 0%, #000000 46%, #000000 84%, #000000 100%)',
};
const imRahmen = () => {
  try { return typeof window !== 'undefined' && window.parent && window.parent !== window; } catch { return false; }
};
// Hoehe der Bildschirmtastatur (Vorschlagsleiste 44, vier Reihen 4*44 + 3*11,
// Streifen 34 -> 297). Faehrt sie hoch, rueckt die Eingabezeile darueber.
const TASTATUR_HOEHE = 297;
const EINGABE_UNTEN = 70;        // Abstand zum unteren Rand ohne Tastatur
const EINGABE_HOEHE = 48;        // eine Zeile
const EINGABE_HOEHE_MAX = 144;   // fuenf Zeilen, ab hier scrollt das Feld statt zu wachsen
const EINGABE_ZEILE = 24;
// 12 px ueber und 12 px unter dem Text. Vorher waren es 12 zusammen, ab der
// zweiten Zeile klebte der Text dann oben und unten am Rand der Blase.
const EINGABE_INNEN = 24;        // Polsterung oben + unten zusammen
const EINGABE_ABSTAND = 16;      // Luft zwischen Verlauf und Eingabezeile
const VERLAUF_OBEN = 109;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = (value) => UUID_REGEX.test(value || '');

// Senden-Knopf traegt den TRISAR-Pfeil, schwarz auf dem gruenen Kreis.
// Die Vorlage zeigt nach rechts, um 45 Grad gedreht zeigt sie nach oben
// rechts — wie der gewohnte Senden-Pfeil.
const SendIcon = () => (
  <svg
    width="22"
    height="19"
    viewBox="0 0 36 31"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ transform: 'rotate(-45deg)' }}
  >
    <path
      d="M20.06 0V5.71L32.19 11.62V12.45H0V17.85H32.19V18.67L20.06 24.58V30.29L36 22.32V17.85V12.45V7.97L20.06 0Z"
      fill="black"
    />
  </svg>
);

export default function KolonnenChat({
  setView,
  backView = 'details',
  selectedJob,
  messages = {},
  setMessages,
  currentUserId,
}) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [inputText, setInputText] = useState('');
  const hasInput = inputText.trim().length > 0;
  // Bildschirmtastatur wie im Login und beim Notizblatt — nur im Demo-Rahmen,
  // auf einem echten Handy zeigt das System seine eigene.
  const [tastaturOben, setTastaturOben] = useState(false);
  const [getipptesZeichen, setGetipptesZeichen] = useState('');
  const [tastaturEbene, setTastaturEbene] = useState('abc');
  useEffect(() => {
    if (!getipptesZeichen) return undefined;
    const id = setTimeout(() => setGetipptesZeichen(''), 110);
    return () => clearTimeout(id);
  }, [getipptesZeichen]);
  // Eingabezeile sitzt ueber der Tastatur, der Verlauf wird entsprechend kuerzer.
  // Das Feld waechst mit dem Text, damit man das Geschriebene immer sieht.
  const feldRef = useRef(null);
  const [feldHoehe, setFeldHoehe] = useState(EINGABE_HOEHE);
  useEffect(() => {
    const el = feldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const gewuenscht = Math.min(el.scrollHeight + EINGABE_INNEN, EINGABE_HOEHE_MAX);
    const hoehe = Math.max(EINGABE_HOEHE, gewuenscht);
    el.style.height = `${hoehe - EINGABE_INNEN}px`;
    setFeldHoehe(hoehe);
  }, [inputText]);

  const eingabeUnten = tastaturOben ? TASTATUR_HOEHE + 12 : EINGABE_UNTEN;
  const verlaufHoehe = BASE_HEIGHT - VERLAUF_OBEN - (eingabeUnten + feldHoehe + EINGABE_ABSTAND);

  const textAendern = (e) => {
    const neu = e.target.value;
    const zeichen = neu.length > inputText.length ? neu[neu.length - 1] : '';
    setInputText(neu);
    if (imRahmen()) setTastaturOben(true);
    if (zeichen) {
      setGetipptesZeichen(zeichen);
      const ebene = ebeneFuer(zeichen, false);
      if (ebene) setTastaturEbene(ebene);
    }
  };
  const chatId = selectedJob?.convoyId || selectedJob?.id || 'kolonnen-chat';
  const chatTitle = kolonnenNameKurz(selectedJob?.kolonneName) || t('app.convoy');

  const chatMessages = useMemo(
    () => (Array.isArray(messages?.[chatId]) ? messages[chatId] : []),
    [messages, chatId],
  );

  useEffect(() => {
    const updateScale = () => {
      setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    if (!isUuid(chatId) || !currentUserId || typeof setMessages !== 'function') return undefined;

    let active = true;

    const fetchGroupMessages = async () => {
      try {
        const { data: rawMessages, error } = await supabase
          .from('messages')
          .select('*')
          .eq('target_type', 'group')
          .eq('target_id', chatId)
          .order('created_at', { ascending: true });

        if (error || !active) return;

        const senderIds = Array.from(
          new Set((rawMessages || []).map((msg) => msg.sender_id).filter((id) => id && id !== currentUserId)),
        );

        let senderMap = {};
        if (senderIds.length) {
          const { data: profiles } = await supabase
            .from('profiles')
            .select('id,first_name,last_name')
            .in('id', senderIds);
          senderMap = Object.fromEntries(
            (profiles || []).map((p) => [p.id, `${p.first_name || ''} ${p.last_name || ''}`.trim() || t('misc.colleague')]),
          );
        }

        const formatted = (rawMessages || []).map((msg) => ({
          id: msg.id,
          sender: msg.sender_id === currentUserId ? 'me' : (senderMap[msg.sender_id] || t('misc.colleague')),
          text: msg.content || '',
          time: msg.created_at
            ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '',
          createdAt: msg.created_at || null,
        }));

        setMessages((prev) => ({ ...prev, [chatId]: formatted }));
      } catch {
        // intentionally no-op; UI keeps local state fallback
      }
    };

    fetchGroupMessages();

    const channel = supabase
      .channel(`kolonnen-chat-${chatId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `target_id=eq.${chatId}` }, () => {
        fetchGroupMessages();
      })
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [chatId, currentUserId, setMessages, t]);

  const handleSend = (e) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || typeof setMessages !== 'function') return;

    const nextMsg = {
      id: Date.now(),
      sender: 'me',
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => ({
      ...prev,
      [chatId]: [...(prev?.[chatId] || []), nextMsg],
    }));
    setInputText('');
    setTastaturOben(false);

    if (isUuid(chatId) && currentUserId) {
      supabase
        .from('messages')
        .insert([
          {
            sender_id: currentUserId,
            target_type: 'group',
            target_id: chatId,
            content: text,
          },
        ])
        .then(() => {})
        .catch(() => {});
    }
  };

  return (
    <div
      className="h-dvh w-full bg-black overflow-hidden flex justify-center"
      style={{
        WebkitTextSizeAdjust: 'none',
        WebkitOverflowScrolling: 'touch',
        textSizeAdjust: 'none',
        fontFamily: 'Space Grotesk, sans-serif',
      }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
        <div
          className="absolute left-0 top-0 w-[402px] h-[864px] origin-top-left overflow-hidden"
          style={{ ...screenBg, transform: `scale(${scale})` }}
        >
          <ZurueckKnopf onClick={() => setView(backView)} marker="kolonnenchat-zurueck" />

          <div className="absolute left-[20px] top-[97px] w-80 h-14" />

          {/* Titel wie im KI-Assistenten der Dispo: eigene Kopfzeile auf Hoehe
              des Zurueck-Knopfs (60 px, 50 px hoch), Text waagerecht mittig und
              senkrecht auf die Knopfmitte ausgerichtet. */}
          <div className="absolute left-0 right-0 top-[60px] h-[50px] flex items-center justify-center pointer-events-none">
            <span className="text-[#E3F654] text-[10px] font-bold font-['Space_Grotesk'] leading-4 whitespace-nowrap">
              {chatTitle}
            </span>
          </div>

          <div
            className="absolute left-0 w-[402px] px-5 pt-4 overflow-y-auto overscroll-none"
            style={{ top: `${VERLAUF_OBEN}px`, height: `${verlaufHoehe}px`, transition: 'height 460ms cubic-bezier(0.22,1,0.36,1)' }}
            data-tutorial="kolonnenchat-verlauf"
          >
            <div className="flex flex-col gap-4 pb-4">
              {chatMessages.length === 0 && (
                <div className="text-[#868786] text-sm font-medium leading-5 px-4 py-3">
                  {t('misc.noMessagesYet')}
                </div>
              )}
              {chatMessages.map((message) => {
                const isMe = message.sender === 'me';
                const senderName = isMe ? '' : (message.sender || t('misc.colleague'));
                return (
                <div key={message.id} className={`flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}>
                  {!isMe && (
                    <div className="w-24 h-4 relative">
                      <div className="absolute left-4 top-0 text-[#868786] text-xs font-medium leading-4 whitespace-nowrap">
                        {senderName}
                      </div>
                    </div>
                  )}

                  <div
                    className={`w-fit max-w-64 min-h-[52px] px-4 py-3 rounded-xl flex items-center ${
                      isMe ? 'bg-[#e3f654]' : 'bg-[#242425]'
                    }`}
                  >
                    <div className={`text-base font-normal leading-5 whitespace-pre-wrap break-words ${isMe ? 'text-black' : 'text-white'}`}>
                      {message.text}
                    </div>
                  </div>

                  <div className="w-14 h-4 relative">
                    <div className="absolute left-4 top-0 text-[#868786] text-xs font-normal leading-4 whitespace-nowrap">
                      {message.time}
                    </div>
                  </div>
                </div>
              );
              })}
            </div>
          </div>

          <form
            onSubmit={handleSend}
            data-tutorial="kolonnenchat-eingabe"
            className="absolute left-[20px] w-[362px] bg-black/60 inline-flex justify-start items-end gap-3"
            style={{ bottom: `${eingabeUnten}px`, height: `${feldHoehe}px`, transition: 'bottom 460ms cubic-bezier(0.22,1,0.36,1), height 160ms ease-out' }}
          >
            <label
              className="flex-1 px-4 bg-[#242425] rounded-[20px] outline outline-1 outline-offset-[-1px] outline-[#3f3f46] inline-flex items-center"
              style={{ height: `${feldHoehe}px`, transition: 'height 160ms ease-out' }}
            >
              <textarea
                ref={feldRef}
                rows={1}
                value={inputText}
                data-tutorial="kolonnenchat-feld"
                onChange={textAendern}
                // Klick UND Fokus fahren die Tastatur hoch: der Tutorial-Cursor
                // klickt, ein Fokus-Ereignis bleibt in versteckten Tabs aus.
                onFocus={() => { if (imRahmen()) setTastaturOben(true); }}
                onClick={() => { if (imRahmen()) setTastaturOben(true); }}
                onKeyDown={(e) => {
                  // Enter schickt ab, Umschalt+Enter macht eine neue Zeile.
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e); }
                }}
                placeholder={t('misc.writeMessagePlaceholder')}
                className="w-full bg-transparent text-white text-base font-normal leading-6 placeholder:text-[#868786] outline-none resize-none overflow-y-auto"
                style={{ maxHeight: `${EINGABE_HOEHE_MAX - EINGABE_INNEN}px` }}
              />
            </label>
            <button
              type="submit"
              data-tutorial="kolonnenchat-senden"
              className={`w-12 h-12 shrink-0 rounded-full flex justify-center items-center transition-colors ${
                hasInput ? 'bg-[#E3F754] opacity-100' : 'bg-[#e3f654] opacity-50'
              }`}
              disabled={!hasInput}
            >
              <SendIcon />
            </button>
          </form>
        </div>
      </div>

      <Bildschirmtastatur
        oben={tastaturOben}
        aktiveTaste={tasteFuer(getipptesZeichen)}
        ebene={tastaturEbene}
        vorschlaege={vorschlaegeFuer(inputText)}
      />

      <TrisarFooter className="fixed bottom-0 left-0 right-0 h-10 bg-black z-30" />
    </div>
  );
}
