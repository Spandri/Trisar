import { useEffect, useMemo, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
import { askDatabaseAssistant, invalidateDatabaseAssistantCache } from '../../services/kiAssistant';
import { supabase } from '../../services/supabase';

const kiIconSrc = '/icon/_Icon_Lime/KI_Trisar_Icons_01_Lime.svg';
const sendIconSrc = '/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg';
const CHAT_STORAGE_KEY = 'koordinator_ki_chat_messages_v1';
const DEFAULT_MESSAGES = [
  {
    id: 'init',
    role: 'assistant',
    text: 'Hallo! Ich bin dein KI-Assistent. Wie kann ich dir heute helfen?',
    time: '17:13',
  },
];

const toDisplayDate = (isoDate) => {
  const raw = String(isoDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '--.--';
  return `${raw.slice(8, 10)}.${raw.slice(5, 7)}`;
};

const toCreateRidePayload = (proposal) => ({
  datum: String(proposal?.datum || '').trim(),
  startZeit: String(proposal?.startZeit || '').trim(),
  start: String(proposal?.start || '').trim(),
  ziel: String(proposal?.ziel || '').trim(),
  fahrgaeste: String(proposal?.fahrgaeste || '').trim(),
  anonymeGaeste: String(proposal?.anonymeGaeste || '0').trim(),
  fahrerNamen: Array.isArray(proposal?.fahrerNamen)
    ? proposal.fahrerNamen.map((value) => String(value || '').trim()).filter(Boolean)
    : [],
  konvoi: String(proposal?.konvoi || '').trim(),
  flugnummer: String(proposal?.flugnummer || '').trim(),
  notes: String(proposal?.notes || '').trim(),
  aktuellerStatus: 'offen',
});

const hasMinimumBookingData = (proposal) => {
  const payload = toCreateRidePayload(proposal);
  return Boolean(payload.start && payload.ziel && payload.startZeit);
};

const BookingPreviewCard = ({ proposal }) => {
  const payload = toCreateRidePayload(proposal);
  const guestLabel = payload.fahrgaeste || 'Noch keine Gäste angegeben';
  const driverLabel = payload.fahrerNamen.length > 0 ? payload.fahrerNamen.join(', ') : 'Fahrer fehlt';
  const dateLabel = toDisplayDate(payload.datum);
  return (
    <div className="w-full max-w-[362px] min-h-36 bg-white text-black p-[18px] relative">
      <div className="pr-[86px] text-[24px] leading-[26px] font-bold font-['Space_Grotesk'] break-words">{guestLabel}</div>
      <div className="mt-[5px] text-xs leading-4 font-medium font-['Space_Grotesk'] opacity-80 break-words">{payload.start} - {payload.ziel}</div>
      <div className="mt-[5px] text-base leading-6 font-bold font-['Space_Grotesk'] break-words">{driverLabel}</div>
      <div className="absolute right-4 top-[18px] text-right">
        <div className="text-base leading-5 font-bold font-['Space_Grotesk']">{dateLabel}</div>
        <div className="text-base leading-5 font-normal font-['Space_Grotesk']">{payload.startZeit || '--:--'}</div>
      </div>
      <div className="absolute right-4 bottom-[18px]">
        <img src={sendIconSrc} alt="" className="w-[34px] h-[21px] scale-[1.2]" />
      </div>
    </div>
  );
};

const IconCopy = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="none" stroke="currentColor" strokeWidth="2" d="M9 9h10v10H9z" />
    <path fill="none" stroke="currentColor" strokeWidth="2" d="M5 15V5h10" />
  </svg>
);

const IconEdit = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="none" stroke="currentColor" strokeWidth="2" d="M4 20l4.2-1 9.6-9.6a1.6 1.6 0 0 0 0-2.2l-1-1a1.6 1.6 0 0 0-2.2 0L5 15.8 4 20z" />
    <path fill="none" stroke="currentColor" strokeWidth="2" d="M13 7l4 4" />
  </svg>
);

export default function KiAssistentView({ setView, onCreateRide, onOpenRideEditorById }) {
  const [inputText, setInputText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [composerHeight, setComposerHeight] = useState(48);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [layoutHeight] = useState(window.innerHeight);
  const [isCompactDevice, setIsCompactDevice] = useState(window.matchMedia('(max-width: 1024px)').matches);
  const chatScrollRef = useRef(null);
  const inputRef = useRef(null);
  const stableViewportHeightRef = useRef(window.innerHeight);
  const [messages, setMessages] = useState(() => {
    try {
      const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
      if (!raw) return DEFAULT_MESSAGES;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return DEFAULT_MESSAGES;
      return parsed;
    } catch {
      return DEFAULT_MESSAGES;
    }
  });

  const hasInput = inputText.trim().length > 0;
  const COMPOSER_GAP = 12;
  const HEADER_TOP = 60;
  const HEADER_HEIGHT = 50;
  const CHAT_TOP = HEADER_TOP + HEADER_HEIGHT;

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
    }),
    [],
  );

  useEffect(() => {
    const invalidate = () => {
      invalidateDatabaseAssistantCache();
    };
    const channel = supabase
      .channel(`ko-ki-live-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'guests' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_guests' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_notes' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'convoy_assignments' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'convoys' }, invalidate)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_live_locations' }, invalidate)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setView('list');
  };

  const handleSend = () => {
    const text = inputText.trim();
    if (!text || isSending) return;
    const nowLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const userMessageId = `msg-user-${Date.now()}`;
    const pendingAssistantId = `msg-ai-pending-${Date.now() + 1}`;
    const sourceMessages = editingMessageId
      ? messages.filter((msg, index, arr) => {
          if (msg.id === editingMessageId) return false;
          const editIndex = arr.findIndex((entry) => entry.id === editingMessageId);
          const maybeAssistant = editIndex >= 0 ? arr[editIndex + 1] : null;
          if (maybeAssistant && maybeAssistant.role === 'assistant' && msg.id === maybeAssistant.id) return false;
          return true;
        })
      : messages;
    const historyForModel = sourceMessages.map((msg) => ({ role: msg.role, text: msg.text }));

    setMessages([
      ...sourceMessages,
      {
        id: userMessageId,
        role: 'user',
        text,
        time: nowLabel,
      },
      {
        id: pendingAssistantId,
        role: 'assistant',
        text: '',
        pending: true,
        time: nowLabel,
      },
    ]);
    setEditingMessageId(null);
    setInputText('');

    setIsSending(true);
    askDatabaseAssistant({ prompt: text, chatHistory: historyForModel })
      .then((result) => {
        const answerText = typeof result === 'string' ? result : result?.answer;
        const bookingProposal = result?.action?.type === 'booking_proposal' ? result?.action?.proposal : null;
        setMessages((prev) => prev.map((msg) => (
          msg.id === pendingAssistantId
            ? {
                ...msg,
                text: answerText || 'Ich konnte dazu keine Antwort erzeugen.',
                pending: false,
                bookingProposal,
                bookingStatus: bookingProposal ? 'pending' : undefined,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              }
            : msg
        )));
      })
      .catch((error) => {
        setMessages((prev) => prev.map((msg) => (
          msg.id === pendingAssistantId
            ? {
                ...msg,
                text: `Fehler: ${error?.message || 'Unbekannter KI-Fehler'}`,
                pending: false,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              }
            : msg
        )));
      })
      .finally(() => {
        setIsSending(false);
      });
  };

  const handleCopyMessage = async (messageId, text) => {
    const value = String(text || '').trim();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedMessageId(messageId);
      window.setTimeout(() => setCopiedMessageId((current) => (current === messageId ? null : current)), 1200);
    } catch {
      // ignore copy errors silently
    }
  };

  const handleEditMessage = (messageId, text) => {
    setEditingMessageId(messageId);
    setInputText(String(text || ''));
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setInputText('');
  };

  const handleBookingConfirm = async (messageId, proposal) => {
    if (!hasMinimumBookingData(proposal)) {
      setMessages((prev) => ([
        ...prev,
        {
          id: `msg-ai-booking-error-${Date.now()}`,
          role: 'assistant',
          text: 'Für diese Buchung fehlen noch Pflichtfelder (Start, Ziel oder Zeit).',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]));
      return;
    }

    setMessages((prev) => prev.map((msg) => (
      msg.id === messageId ? { ...msg, bookingStatus: 'saving' } : msg
    )));

    try {
      if (typeof onCreateRide !== 'function') {
        throw new Error('Buchungsfunktion ist nicht verbunden.');
      }
      const payload = toCreateRidePayload(proposal);
      const result = await onCreateRide(payload, { aiBooked: true });
      if (!result?.ok) {
        throw new Error(result?.error || 'Buchung fehlgeschlagen.');
      }
      setMessages((prev) => ([
        ...prev.map((msg) => (
          msg.id === messageId
            ? { ...msg, bookingStatus: 'booked', bookingRideId: String(result?.rideId || '').trim() || null }
            : msg
        )),
        {
          id: `msg-ai-booked-${Date.now()}`,
          role: 'assistant',
          text: 'Fahrt wurde gebucht. In Alle Fahrten ist sie jetzt mit KI-Badge markiert.',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]));
    } catch (error) {
      setMessages((prev) => ([
        ...prev.map((msg) => (
          msg.id === messageId ? { ...msg, bookingStatus: 'pending' } : msg
        )),
        {
          id: `msg-ai-booking-failed-${Date.now()}`,
          role: 'assistant',
          text: `Buchung fehlgeschlagen: ${error?.message || 'Unbekannter Fehler'}`,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]));
    }
  };

  const handleBookingCancel = (messageId) => {
    setMessages((prev) => prev.map((msg) => (
      msg.id === messageId ? { ...msg, bookingStatus: 'cancelled' } : msg
    )));
  };

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');

    const prevHtmlOverflow = html.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehavior;
    const prevHtmlTouchAction = html.style.touchAction;
    const prevBodyOverflow = body.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    const prevBodyTouchAction = body.style.touchAction;
    const prevRootOverflow = root ? root.style.overflow : '';
    const prevRootOverscroll = root ? root.style.overscrollBehavior : '';

    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    html.style.touchAction = 'none';
    body.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'none';
    body.style.touchAction = 'none';
    if (root) {
      root.style.overflow = 'hidden';
      root.style.overscrollBehavior = 'none';
    }

    return () => {
      html.style.overflow = prevHtmlOverflow;
      html.style.overscrollBehavior = prevHtmlOverscroll;
      html.style.touchAction = prevHtmlTouchAction;
      body.style.overflow = prevBodyOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
      body.style.touchAction = prevBodyTouchAction;
      if (root) {
        root.style.overflow = prevRootOverflow;
        root.style.overscrollBehavior = prevRootOverscroll;
      }
    };
  }, []);

  useEffect(() => {
    let lastTouchY = 0;

    const onTouchStart = (event) => {
      if (!event.touches || event.touches.length === 0) return;
      lastTouchY = event.touches[0].clientY;
    };

    const onTouchMove = (event) => {
      const scroller = chatScrollRef.current;
      if (!scroller || !event.touches || event.touches.length === 0) return;

      const target = event.target;
      const isInsideChat = target instanceof Node && scroller.contains(target);
      if (!isInsideChat) {
        event.preventDefault();
        return;
      }

      const currentY = event.touches[0].clientY;
      const deltaY = currentY - lastTouchY;
      lastTouchY = currentY;

      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;

      if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
        event.preventDefault();
      }
    };

    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = 'auto';
    const contentHeight = Math.min(field.scrollHeight, 140);
    field.style.height = `${contentHeight}px`;
    setComposerHeight(Math.max(52, contentHeight));
  }, [inputText]);

  useEffect(() => {
    const onResize = () => setIsCompactDevice(window.matchMedia('(max-width: 1024px)').matches);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) {
      setKeyboardInset(0);
      return undefined;
    }

    const updateKeyboardState = () => {
      const baseLayoutHeight = stableViewportHeightRef.current;
      const viewportBottom = viewport.height + viewport.offsetTop;
      const nextInset = Math.max(0, baseLayoutHeight - viewportBottom);
      setKeyboardInset(nextInset);

      if (nextInset < 40 && !isInputFocused) {
        stableViewportHeightRef.current = window.innerHeight;
      }

      if (isInputFocused) {
        window.scrollTo(0, 0);
      }
    };

    updateKeyboardState();
    viewport.addEventListener('resize', updateKeyboardState);
    viewport.addEventListener('scroll', updateKeyboardState);
    return () => {
      viewport.removeEventListener('resize', updateKeyboardState);
      viewport.removeEventListener('scroll', updateKeyboardState);
    };
  }, [isInputFocused]);

  const isMobileKeyboardMode = isCompactDevice && isInputFocused && keyboardInset > 80;

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // ignore storage errors
    }
  }, [messages]);

  const defaultComposerBottom = 175;
  const composerBottom = isMobileKeyboardMode
    ? (keyboardInset + 8)
    : defaultComposerBottom;
  const chatBottom = composerBottom + composerHeight + COMPOSER_GAP;

  const lastMessageSignature = useMemo(() => {
    const last = messages[messages.length - 1];
    if (!last) return '';
    return `${last.id}|${last.role}|${last.pending ? '1' : '0'}|${last.text || ''}|${last.bookingStatus || ''}`;
  }, [messages]);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;

    const scrollToBottom = () => {
      scroller.scrollTop = scroller.scrollHeight + 200;
    };

    const rafId = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(rafId);
  }, [messages.length, lastMessageSignature, isInputFocused]);

  return (
    <div
      className="fixed inset-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] overflow-hidden overscroll-none"
      style={{ ...gradientStyle, height: `${layoutHeight}px` }}
    >
      <div className="absolute left-0 right-0 z-50 px-[20px] flex items-center justify-between" style={{ top: `${HEADER_TOP}px`, height: `${HEADER_HEIGHT}px` }}>
        <BackCircleButton onClick={handleBack} />
        <div className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-2">
          <img src={kiIconSrc} alt="" className="w-[14px] h-[13px]" />
          <span className="text-[#E3F654] text-[10px] font-bold font-['Space_Grotesk'] leading-4">KI-Assistent</span>
        </div>
      </div>

      <div
        ref={chatScrollRef}
        className="absolute left-0 right-0 overflow-y-auto overflow-x-hidden overscroll-none px-[20px] space-y-4 z-20"
        style={{ top: `${CHAT_TOP}px`, bottom: `${chatBottom}px`, touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
      >
        {messages.map((message) => {
          if (message.role === 'user') {
            return (
              <div key={message.id} className="w-[314px] ml-auto">
                <div className="px-3 pt-3 pb-2 bg-[#E3F654] rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-md">
                  <div
                    className="text-black text-base font-medium font-['Space_Grotesk'] leading-5"
                    style={{ userSelect: 'text', WebkitUserSelect: 'text', WebkitTouchCallout: 'default' }}
                  >
                    {message.text}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-black/60 text-[10px] font-normal font-['Space_Grotesk'] leading-4">{message.time}</div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        aria-label="Nachricht kopieren"
                        title="Nachricht kopieren"
                        onClick={() => handleCopyMessage(message.id, message.text)}
                        className="h-7 w-7 inline-flex items-center justify-center text-black/90 hover:text-black transition-colors"
                      >
                        <IconCopy className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Nachricht bearbeiten"
                        title="Nachricht bearbeiten"
                        onClick={() => handleEditMessage(message.id, message.text)}
                        className="h-7 w-7 inline-flex items-center justify-center text-black/90 hover:text-black transition-colors"
                      >
                        <IconEdit className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          return (
            message.pending ? (
              <div key={message.id} className="w-[314px] px-1 py-1">
                <div className="inline-flex items-center">
                  <img src={kiIconSrc} alt="" className="w-[20px] h-[19px] animate-pulse" />
                </div>
              </div>
            ) : (
              <div key={message.id}>
                <div className="w-[314px] px-3 pt-3 pb-2 bg-[#242525] rounded-tl-2xl rounded-tr-2xl rounded-bl-md rounded-br-2xl outline outline-1 outline-offset-[-1px] outline-[#3A3A3A]">
                  <div className="inline-flex items-center gap-1.5 mb-3">
                    <img src={kiIconSrc} alt="" className="w-[14px] h-[13px]" />
                    <span className="text-[#E3F654] text-[10px] font-bold font-['Space_Grotesk'] leading-4">KI-Assistent</span>
                  </div>
                  <div
                    className="text-white text-base font-normal font-['Space_Grotesk'] leading-5"
                    style={{ userSelect: 'text', WebkitUserSelect: 'text', WebkitTouchCallout: 'default' }}
                  >
                    {message.text}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-white/40 text-[10px] font-normal font-['Space_Grotesk'] leading-4">{message.time}</div>
                    <button
                      type="button"
                      aria-label="KI-Antwort kopieren"
                      title="KI-Antwort kopieren"
                      onClick={() => handleCopyMessage(message.id, message.text)}
                      className="h-7 w-7 inline-flex items-center justify-center text-white/90 hover:text-white transition-colors"
                    >
                      <IconCopy className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {message.bookingProposal ? (
                  <div className="mt-3 flex flex-col items-center">
                    <BookingPreviewCard proposal={message.bookingProposal} />
                    {message.bookingStatus === 'pending' ? (
                      <div className="mt-3 flex items-center gap-3 w-full max-w-[362px]">
                        <button
                          type="button"
                          onClick={() => handleBookingConfirm(message.id, message.bookingProposal)}
                          className="flex-1 h-[51px] bg-[#e3f754] flex items-center justify-center"
                        >
                          <span className="text-black text-[24px] font-bold tracking-[-0.5px] leading-none font-['Space_Grotesk']">buchen</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleBookingCancel(message.id)}
                          className="flex-1 h-[51px] border-2 border-[#ff6f63] flex items-center justify-center"
                        >
                          <span className="text-[#ff6f63] text-[24px] font-bold tracking-[-0.5px] leading-none font-['Space_Grotesk']">nicht buchen</span>
                        </button>
                      </div>
                    ) : null}
                    {message.bookingStatus === 'saving' ? (
                      <div className="mt-3 text-[#E3F654] text-[11px] font-medium font-['Space_Grotesk']">Buchung wird gespeichert...</div>
                    ) : null}
                    {message.bookingStatus === 'booked' ? (
                      <div className="mt-3 w-full max-w-[362px]">
                        <div className="text-[#59BE80] text-[11px] font-medium font-['Space_Grotesk']">Gebucht</div>
                        <button
                          type="button"
                          onClick={() => {
                            const rideId = String(message?.bookingRideId || '').trim();
                            if (!rideId || typeof onOpenRideEditorById !== 'function') return;
                            onOpenRideEditorById(rideId);
                          }}
                          className="mt-2 w-full h-11 bg-[#E3F654] text-black text-sm font-bold font-['Space_Grotesk']"
                        >
                          Fahrt bearbeiten
                        </button>
                      </div>
                    ) : null}
                    {message.bookingStatus === 'cancelled' ? (
                      <div className="mt-3 text-white/70 text-[11px] font-medium font-['Space_Grotesk']">Buchung verworfen</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          );
        })}
      </div>

      <div
        className="absolute left-1/2 -translate-x-1/2 w-[362px] bg-black/60 inline-flex justify-start items-end gap-3 z-50"
        style={{ bottom: `${composerBottom}px`, height: `${composerHeight}px` }}
      >
        {editingMessageId ? (
          <div className="absolute -top-8 left-0 right-0 flex items-center justify-between px-1">
            <div className="text-[10px] text-[#E3F654] font-bold font-['Space_Grotesk']">Bearbeiten aktiv</div>
            <button
              type="button"
              onClick={handleCancelEdit}
              className="text-[10px] text-white/80 font-bold font-['Space_Grotesk']"
            >
              Abbrechen
            </button>
          </div>
        ) : null}
        <label className="flex-1 h-full px-4 py-0 bg-[#242425] rounded-[20px] outline outline-1 outline-offset-[-1px] outline-[#3f3f46] inline-flex items-center">
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onFocus={() => {
              setIsInputFocused(true);
              window.scrollTo(0, 0);
            }}
            onBlur={() => setIsInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            autoCorrect="on"
            autoCapitalize="sentences"
            autoComplete="on"
            spellCheck
            placeholder="Nachricht schreiben..."
            rows={1}
            className="w-full my-auto bg-transparent text-white text-base font-normal placeholder:text-[#868786] outline-none resize-none overflow-hidden leading-6"
          />
        </label>
        <button
          type="button"
          onClick={handleSend}
          onMouseDown={(e) => e.preventDefault()}
          onTouchStart={(e) => e.preventDefault()}
          className={`w-12 h-12 rounded-full flex justify-center items-center transition-colors ${
            hasInput && !isSending ? 'bg-[#E3F754] opacity-100' : 'bg-[#e3f654] opacity-50'
          }`}
          disabled={!hasInput || isSending}
        >
          <img src={sendIconSrc} alt="" className="w-[20px] h-[20px]" />
        </button>
      </div>

      {!isMobileKeyboardMode ? (
        <NaviFooterKomponente
          onNavigateHome={() => setView('list')}
          onNavigateToFahrten={() => setView('ankuenfte')}
          onNavigateToAddFahrt={() => setView('fahrtAdd')}
          onNavigateToKi={() => setView('kiAssistent')}
          onNavigateToMap={() => setView('karten')}
          activeTab="ki"
        />
      ) : null}
    </div>
  );
}
