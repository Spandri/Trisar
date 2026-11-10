import { useEffect, useMemo, useRef, useState } from 'react';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import BackCircleButton from '../ui/BackCircleButton';
import FahrtAdd from './FahrtAdd';
import { askDatabaseAssistant, invalidateDatabaseAssistantCache } from '../../services/kiAssistant';
import { supabase } from '../../services/supabase';
import { demoStore } from '../../demo/demoClient';
import { DEMO_MODE } from '../../datenquelle';
import { useI18n } from '../../i18n';
import { gaesteTeile, gaesteText } from '../../shared/gaesteAnzeige';
import {
  neuplanungStatus, neuplanungZielSetzen, stoerungenNachAnnahme, stoerungText,
} from '../../demo/stoerungDemo';

// Telefonnummern in Antworten des Assistenten werden zu Links: ein Tipp ruft an.
const TELEFON_RE = /(\+?\d[\d ()/-]{6,}\d)/g;
const mitKlickbarenNummern = (text) => {
  const teile = String(text || '').split(TELEFON_RE);
  if (teile.length === 1) return text;
  return teile.map((teil, index) => (
    index % 2 === 1 ? (
      <a
        key={`tel-${index}`}
        href={`tel:${teil.replace(/[^\d+]/g, '')}`}
        data-tutorial="ki-telefon"
        className="text-[#E3F654] underline underline-offset-2"
      >
        {teil}
      </a>
    ) : teil
  ));
};

// Mindestzeit, die der KI-Assistent vor einer Antwort nachdenkt.
const DENKZEIT_MS = 3000;

const kiIconSrc = '/icon/_Icon_Lime/KI_Trisar_Icons_01_Lime.svg';
const sendIconSrc = '/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg';
// v2: Demo-Assistent mit Beispielbuchung. Der v1-Verlauf enthielt noch die
// pauschale "deaktiviert"-Antwort und wird beim Laden verworfen.
const CHAT_STORAGE_KEY = 'koordinator_ki_chat_messages_v2';
const LEGACY_CHAT_STORAGE_KEYS = ['koordinator_ki_chat_messages_v1'];
const LEGACY_DEMO_TEXT_RE = /Online-Demo deaktiviert/i;
const buildDefaultMessages = (t) => [
  {
    id: 'init',
    role: 'assistant',
    text: t('assist.initGreeting'),
    time: '17:13',
  },
];

// Gespeicherten Verlauf an den aktuellen Demo-Stand anpassen: Die Demo-Daten
// leben nur im Speicher (Reload = Zuruecksetzen). Verweist eine gebuchte
// Vorschau auf eine Fahrt, die es nicht mehr gibt, startet der Chat neu.
const restoreStoredMessages = (parsed, t) => {
  const cleaned = parsed
    .filter((msg) => msg && !msg.pending && !LEGACY_DEMO_TEXT_RE.test(String(msg.text || '')))
    .map((msg) => (msg.bookingStatus === 'saving' ? { ...msg, bookingStatus: 'pending' } : msg));
  // Nur in der Demo: dort leben die Fahrten im Speicher und sind nach Reload weg.
  const jobs = Array.isArray(demoStore?.jobs) ? demoStore.jobs : [];
  const hasStaleBooking = DEMO_MODE && cleaned.some((msg) => (
    msg.bookingStatus === 'booked'
    && !jobs.some((job) => String(job?.id || '') === String(msg.bookingRideId || ''))
  ));
  if (hasStaleBooking || cleaned.length === 0) return buildDefaultMessages(t);
  if (cleaned.length === 1 && cleaned[0]?.id === 'init') return buildDefaultMessages(t);
  return cleaned;
};

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

const BookingPreviewCard = ({ proposal, onOeffnen }) => {
  const { t } = useI18n();
  const payload = toCreateRidePayload(proposal);
  // Gemeinsame Regel: nur anonyme Gaeste als "N Anonyme Gäste", sonst Namen plus "+ N".
  const gaeste = gaesteTeile(payload.fahrgaeste.split(','), payload.anonymeGaeste);
  const guestLabel = (gaeste.namen.length || gaeste.anonym)
    ? gaesteText(gaeste.namen, gaeste.anonym, t)
    : t('assist.noGuestsYet');
  const driverLabel = payload.fahrerNamen.length > 0 ? payload.fahrerNamen.join(', ') : t('assist.driverMissing');
  const dateLabel = toDisplayDate(payload.datum);
  const Huelle = onOeffnen ? 'button' : 'div';
  return (
    <Huelle
      {...(onOeffnen ? { type: 'button', onClick: onOeffnen } : {})}
      className="block text-left w-full max-w-[362px] min-h-36 bg-white text-black p-[18px] relative"
    >
      <div className="pr-[86px] text-[24px] leading-[26px] font-bold font-['Space_Grotesk'] break-words">{guestLabel}</div>
      <div className="mt-[5px] pr-[86px] text-xs leading-4 font-medium font-['Space_Grotesk'] opacity-80 break-words">{payload.start} - {payload.ziel}</div>
      <div className="mt-[5px] text-base leading-6 font-bold font-['Space_Grotesk'] break-words">{driverLabel}</div>
      <div className="absolute right-4 top-[18px] text-right">
        <div className="text-base leading-5 font-bold font-['Space_Grotesk']">{dateLabel}</div>
        <div className="text-base leading-5 font-normal font-['Space_Grotesk']">{payload.startZeit || '--:--'}</div>
      </div>
      <div className="absolute right-4 bottom-[18px]">
        <img src={sendIconSrc} alt="" className="w-[34px] h-[21px] scale-[1.2]" />
      </div>
    </Huelle>
  );
};

const IconCopy = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="none" stroke="currentColor" strokeWidth="2" d="M9 9h10v10H9z" />
    <path fill="none" stroke="currentColor" strokeWidth="2" d="M5 15V5h10" />
  </svg>
);

const IconCheck = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square" d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

// Bearbeiten-Stift, gefuellt: zeigt an, dass genau diese Nachricht gerade
// bearbeitet wird.
const IconEditAktiv = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" d="M4 20l4.2-1 9.6-9.6a1.6 1.6 0 0 0 0-2.2l-1-1a1.6 1.6 0 0 0-2.2 0L5 15.8 4 20z" />
  </svg>
);

const abbrechenIconSrc = '/icon/_Icon_Schwarz/Abbrechen_Rund_Trisar_01.svg';
// Dauer des Tropfen-Uebergangs, gleich wie in index.css (.ki-aktionen).
const ABBRECHEN_WANDEL_MS = 860;

const IconEdit = ({ className = '' }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path fill="none" stroke="currentColor" strokeWidth="2" d="M4 20l4.2-1 9.6-9.6a1.6 1.6 0 0 0 0-2.2l-1-1a1.6 1.6 0 0 0-2.2 0L5 15.8 4 20z" />
    <path fill="none" stroke="currentColor" strokeWidth="2" d="M13 7l4 4" />
  </svg>
);

export default function KiAssistentView({
  setView, onCreateRide, onOpenRideEditorById, onFetchPlaceSuggestions, onValidateFlight, onValidateTrain,
}) {
  // Vorschlag, der gerade im Fahrtformular angepasst wird.
  const [formular, setFormular] = useState(null);
  const { t } = useI18n();
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
      LEGACY_CHAT_STORAGE_KEYS.forEach((key) => window.localStorage.removeItem(key));
      const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
      if (!raw) return buildDefaultMessages(t);
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) return buildDefaultMessages(t);
      // Unbenutzter Chat (nur der Startgruß): bei Sprachwechsel neu erzeugen,
      // sonst bliebe der Gruß dauerhaft in der Erstsprache haengen.
      return restoreStoredMessages(parsed, t);
    } catch {
      return buildDefaultMessages(t);
    }
  });

  // Demo: Ist ein Tag mit vorgerechneter Störung angenommen, meldet der
  // Assistent die Störung und verlinkt auf die Neuplanung im Planer.
  useEffect(() => {
    // Nur in der Demo: die Stoerung ist vorgerechnet, im Live-Betrieb gibt es sie nicht.
    if (!DEMO_MODE) return undefined;
    let aktiv = true;
    stoerungenNachAnnahme().then((liste) => {
      if (!aktiv || !liste.length) return;
      setMessages((prev) => {
        const neu = liste
          .filter(({ iso }) => !prev.some((msg) => msg.id === `stoerung-${iso}`))
          .map(({ iso, tag }) => ({
            id: `stoerung-${iso}`,
            role: 'assistant',
            text: stoerungText(iso, tag.stoerung),
            time: tag.stoerung.meldung,
            stoerungTag: iso,
          }));
        return neu.length ? [...prev, ...neu] : prev;
      });
    });
    return () => { aktiv = false; };
  }, []);

  const hasInput = inputText.trim().length > 0;

  // Abbrechen-Knopf beim Bearbeiten: waehrend er aus dem Senden-Knopf heraus-
  // oder in ihn zurueckwaechst, laeuft der Tropfen-Uebergang (im-wandel).
  const bearbeitet = Boolean(editingMessageId);
  const [imWandel, setImWandel] = useState(false);
  const bearbeitetVorherRef = useRef(bearbeitet);
  useEffect(() => {
    if (bearbeitetVorherRef.current === bearbeitet) return undefined;
    bearbeitetVorherRef.current = bearbeitet;
    setImWandel(true);
    const timer = window.setTimeout(() => setImWandel(false), ABBRECHEN_WANDEL_MS);
    return () => window.clearTimeout(timer);
  }, [bearbeitet]);
  const COMPOSER_GAP = 12;
  const EINGABE_INNEN = 12;      // Luft ueber und unter dem Text
  const EINGABE_TEXT_MAX = 120;  // fuenf Zeilen, danach scrollt das Feld
  const HEADER_TOP = 60;
  const HEADER_HEIGHT = 50;
  // Der Verlauf beginnt 30 px unter dem Zurueck-Knopf, dort wo auf den
  // uebrigen Seiten der Titel steht. Vorher lag die erste Blase direkt an.
  const CHAT_TOP = HEADER_TOP + HEADER_HEIGHT + 30;

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  useEffect(() => {
    const invalidate = () => {
      invalidateDatabaseAssistantCache();
    };
    const channel = supabase
      .channel(`admin-ki-live-${Date.now()}`)
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
    // Die Demo antwortet sofort aus festen Texten. Ein echtes Modell braucht
    // einen Moment, also denkt der Assistent mindestens 3 s, bevor er antwortet.
    const nachdenken = new Promise((resolve) => { window.setTimeout(resolve, DENKZEIT_MS); });
    Promise.allSettled([askDatabaseAssistant({ prompt: text, chatHistory: historyForModel }), nachdenken])
      .then(([antwort]) => (antwort.status === 'fulfilled' ? antwort.value : Promise.reject(antwort.reason)))
      .then((result) => {
        // Demo-Antworten kommen als i18n-Key, damit sie in der Sprache des
        // Koordinators erscheinen; answer bleibt als deutscher Fallback.
        const answerText = typeof result === 'string'
          ? result
          : (result?.answerKey ? t(result.answerKey, result.answerVars) : result?.answer);
        const bookingProposal = result?.action?.type === 'booking_proposal' ? result?.action?.proposal : null;
        setMessages((prev) => prev.map((msg) => (
          msg.id === pendingAssistantId
            ? {
                ...msg,
                text: answerText || t('assist.noAnswerGenerated'),
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
                text: t('assist.errorWithMessage', { message: error?.message || t('assist.unknownAiError') }),
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
          text: t('assist.bookingMissingFields'),
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
        throw new Error(t('assist.bookingNotConnected'));
      }
      const payload = toCreateRidePayload(proposal);
      const result = await onCreateRide(payload, { aiBooked: true });
      if (!result?.ok) {
        throw new Error(result?.error || t('assist.bookingFailed'));
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
          text: t('assist.bookedInfo'),
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
          text: t('assist.bookingFailedWithMessage', { message: error?.message || t('assist.unknownError') }),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
      ]));
    }
  };

  const handleFormularGebucht = (messageId, rideId) => {
    setFormular(null);
    setMessages((prev) => ([
      ...prev.map((msg) => (
        msg.id === messageId
          ? { ...msg, bookingStatus: 'booked', bookingRideId: String(rideId || '').trim() || null }
          : msg
      )),
      {
        id: `msg-ai-booked-${Date.now()}`,
        role: 'assistant',
        text: t('assist.bookedInfo'),
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
    ]));
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
    // 12 px Luft ueber und unter dem Text, auch wenn das Feld mehrzeilig
    // waechst. Vorher wuchs die Blase nur um den Text selbst, ab der zweiten
    // Zeile klebte er am Rand. Nach fuenf Zeilen scrollt das Feld.
    field.style.height = 'auto';
    const contentHeight = Math.min(field.scrollHeight, EINGABE_TEXT_MAX);
    field.style.height = `${contentHeight}px`;
    field.style.overflowY = field.scrollHeight > EINGABE_TEXT_MAX ? 'auto' : 'hidden';
    setComposerHeight(Math.max(48, contentHeight + EINGABE_INNEN * 2));
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

  // Tutorial-Marker nur an der juengsten Buchungs-Vorschau, damit aeltere
  // Vorschlaege im Verlauf den Cursor nicht auf sich ziehen.
  const latestProposalMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.bookingProposal) return messages[index].id;
    }
    return null;
  }, [messages]);

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

  if (formular) {
    return (
      <FahrtAdd
        setView={setView}
        onCreateRide={onCreateRide}
        onFetchPlaceSuggestions={onFetchPlaceSuggestions}
        onValidateFlight={onValidateFlight}
        onValidateTrain={onValidateTrain}
        vorlage={toCreateRidePayload(formular.proposal)}
        onVorlageZurueck={() => setFormular(null)}
        onVorlageGebucht={(rideId) => handleFormularGebucht(formular.id, rideId)}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] overflow-hidden overscroll-none"
      style={{ ...gradientStyle, height: `${layoutHeight}px` }}
    >
      <div className="absolute left-0 right-0 z-50 px-[20px] flex items-center justify-between" style={{ top: `${HEADER_TOP}px`, height: `${HEADER_HEIGHT}px` }}>
        <BackCircleButton onClick={handleBack} marker="ki-zurueck" />
        <div data-tutorial="ki-assistent" className="absolute left-1/2 -translate-x-1/2 inline-flex items-center gap-2">
          <img src={kiIconSrc} alt="" className="w-[14px] h-[13px]" />
          <span className="text-[#E3F654] text-[10px] font-bold font-['Space_Grotesk'] leading-4">{t('assist.kiAssistant')}</span>
        </div>
      </div>

      <div
        ref={chatScrollRef}
        data-tutorial="ki-verlauf"
        className="ki-verlauf absolute left-0 right-0 overflow-y-auto overflow-x-hidden overscroll-none px-[20px] space-y-3 z-20"
        style={{ top: `${CHAT_TOP}px`, bottom: `${chatBottom}px`, touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}
      >
        {messages.map((message) => {
          const tutorialMarker = (name) => (message.id === latestProposalMessageId ? name : undefined);
          // Demo-Tutorial: die juengste fertige Antwort des Assistenten.
          const letzteAntwortId = [...messages].reverse().find((entry) => entry.role === 'assistant' && !entry.pending)?.id;
          if (message.role === 'user') {
            return (
              <div key={message.id} className={`w-[314px] ml-auto${editingMessageId === message.id ? ' ki-wird-bearbeitet' : ''}`}>
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
                        aria-label={t('assist.copyMessage')}
                        title={t('assist.copyMessage')}
                        onClick={() => handleCopyMessage(message.id, message.text)}
                        className={`ki-symbol-knopf h-7 w-7 inline-flex items-center justify-center text-black/90 hover:text-black transition-colors${copiedMessageId === message.id ? ' ist-aktiv' : ''}`}
                      >
                        {copiedMessageId === message.id
                          ? <IconCheck key="kopiert" className="ki-symbol ki-symbol-bestaetigt w-4 h-4" />
                          : <IconCopy key="kopieren" className="ki-symbol w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        aria-label={t('assist.editMessage')}
                        title={t('assist.editMessage')}
                        aria-pressed={editingMessageId === message.id}
                        onClick={() => handleEditMessage(message.id, message.text)}
                        className={`ki-symbol-knopf h-7 w-7 inline-flex items-center justify-center text-black/90 hover:text-black transition-colors${editingMessageId === message.id ? ' ist-aktiv' : ''}`}
                      >
                        {editingMessageId === message.id
                          ? <IconEditAktiv key="bearbeitet" className="ki-symbol ki-symbol-bestaetigt w-4 h-4" />
                          : <IconEdit key="bearbeiten" className="ki-symbol w-4 h-4" />}
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
              <div key={message.id} data-tutorial={message.id === letzteAntwortId ? 'ki-antwort' : undefined}>
                <div className="w-[314px] px-3 pt-3 pb-2 bg-[#242525] rounded-tl-2xl rounded-tr-2xl rounded-bl-md rounded-br-2xl outline outline-1 outline-offset-[-1px] outline-[#3A3A3A]">
                  <div className="inline-flex items-center gap-1.5 mb-3">
                    <img src={kiIconSrc} alt="" className="w-[14px] h-[13px]" />
                    <span className="text-[#E3F654] text-[10px] font-bold font-['Space_Grotesk'] leading-4">{t('assist.kiAssistant')}</span>
                  </div>
                  <div
                    className="text-white text-base font-normal font-['Space_Grotesk'] leading-5 whitespace-pre-line"
                    style={{ userSelect: 'text', WebkitUserSelect: 'text', WebkitTouchCallout: 'default' }}
                  >
                    {mitKlickbarenNummern(message.text)}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-white/40 text-[10px] font-normal font-['Space_Grotesk'] leading-4">{message.time}</div>
                    <button
                      type="button"
                      aria-label={t('assist.copyAiAnswer')}
                      title={t('assist.copyAiAnswer')}
                      onClick={() => handleCopyMessage(message.id, message.text)}
                      className={`ki-symbol-knopf h-7 w-7 inline-flex items-center justify-center text-white/90 hover:text-white transition-colors${copiedMessageId === message.id ? ' ist-aktiv' : ''}`}
                    >
                      {copiedMessageId === message.id
                        ? <IconCheck key="kopiert" className="ki-symbol ki-symbol-bestaetigt w-4 h-4 text-[#E3F654]" />
                        : <IconCopy key="kopieren" className="ki-symbol w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {message.stoerungTag ? (
                  <div className="mt-3 w-full max-w-[362px]">
                    {neuplanungStatus(message.stoerungTag) ? (
                      <div className="text-[#59BE80] text-[11px] font-medium font-['Space_Grotesk']">
                        {neuplanungStatus(message.stoerungTag) === 'uebernommen' ? 'Neuplanung übernommen, Fahrer sind informiert.' : 'Neuplanung abgelehnt.'}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      data-tutorial="ki-neuplanung"
                      onClick={() => {
                        neuplanungZielSetzen(message.stoerungTag);
                        setView('kiPlaner');
                      }}
                      className="mt-2 w-full h-[51px] bg-[#E3F654] flex items-center justify-center"
                    >
                      <span className="text-black text-[20px] font-bold tracking-[-0.5px] leading-none font-['Space_Grotesk']">Neuplanung im Planer ansehen</span>
                    </button>
                  </div>
                ) : null}

                {message.bookingProposal ? (
                  <div className="mt-3 flex flex-col items-center">
                    <div data-tutorial={tutorialMarker('ki-vorschlag')} className="w-full max-w-[362px]">
                      <BookingPreviewCard
                        proposal={message.bookingProposal}
                        onOeffnen={!DEMO_MODE && message.bookingStatus === 'pending'
                          ? () => setFormular({ id: message.id, proposal: message.bookingProposal })
                          : undefined}
                      />
                    </div>
                    {message.bookingStatus === 'pending' ? (
                      <div className="mt-3 flex items-center gap-3 w-full max-w-[362px]">
                        <button
                          type="button"
                          data-tutorial={tutorialMarker('ki-buchen')}
                          onClick={() => handleBookingConfirm(message.id, message.bookingProposal)}
                          className="flex-1 h-[51px] bg-[#e3f754] flex items-center justify-center"
                        >
                          <span className="text-black text-[24px] font-bold tracking-[-0.5px] leading-none font-['Space_Grotesk']">{t('assist.book')}</span>
                        </button>
                        <button
                          type="button"
                          data-tutorial={tutorialMarker('ki-nicht-buchen')}
                          onClick={() => handleBookingCancel(message.id)}
                          className="flex-1 h-[51px] border-2 border-[#ff6f63] flex items-center justify-center"
                        >
                          <span className="text-[#ff6f63] text-[24px] font-bold tracking-[-0.5px] leading-none font-['Space_Grotesk']">{t('assist.dontBook')}</span>
                        </button>
                      </div>
                    ) : null}
                    {message.bookingStatus === 'saving' ? (
                      <div className="mt-3 text-[#E3F654] text-[11px] font-medium font-['Space_Grotesk']">{t('assist.bookingSaving')}</div>
                    ) : null}
                    {message.bookingStatus === 'booked' ? (
                      <div className="mt-3 w-full max-w-[362px]">
                        <div className="text-[#59BE80] text-[11px] font-medium font-['Space_Grotesk']">{t('assist.booked')}</div>
                        <button
                          type="button"
                          data-tutorial={tutorialMarker('ki-fahrt-bearbeiten')}
                          onClick={() => {
                            const rideId = String(message?.bookingRideId || '').trim();
                            if (!rideId || typeof onOpenRideEditorById !== 'function') return;
                            onOpenRideEditorById(rideId);
                          }}
                          className="mt-2 w-full h-11 bg-[#E3F654] text-black text-sm font-bold font-['Space_Grotesk']"
                        >
                          {t('assist.editRide')}
                        </button>
                      </div>
                    ) : null}
                    {message.bookingStatus === 'cancelled' ? (
                      <div className="mt-3 text-white/70 text-[11px] font-medium font-['Space_Grotesk']">{t('assist.bookingDiscarded')}</div>
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
        <label className="flex-1 h-full px-4 py-0 bg-[#242425] rounded-[20px] outline outline-1 outline-offset-[-1px] outline-[#3f3f46] inline-flex items-center">
          <textarea
            ref={inputRef}
            data-tutorial="ki-eingabe"
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
            placeholder={t('assist.messagePlaceholder')}
            rows={1}
            className="w-full my-auto bg-transparent text-white text-base font-normal placeholder:text-[#868786] outline-none resize-none overflow-hidden leading-6"
          />
        </label>
        {/* Senden und — beim Bearbeiten — Abbrechen links daneben. Die Leiste
            wird dafuer um 60 px schmaler (48 px Knopf + 12 px Abstand). */}
        <div
          className={`ki-aktionen${bearbeitet ? ' mit-abbrechen' : ''}${imWandel ? ' im-wandel' : ''}${hasInput && !isSending ? '' : ' senden-gedimmt'}`}
        >
          <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
            <filter id="ki-goo-filter" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="weich" />
              <feColorMatrix in="weich" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
            </filter>
          </svg>
          <div className="ki-goo" aria-hidden="true">
            <span className="ki-goo-senden" />
            <span className="ki-goo-abbrechen" />
          </div>
          <button
            type="button"
            aria-label={t('assist.cancel')}
            title={t('assist.cancel')}
            data-tutorial="ki-abbrechen"
            onClick={handleCancelEdit}
            onMouseDown={(e) => e.preventDefault()}
            tabIndex={bearbeitet ? 0 : -1}
            className="ki-abbrechen"
          >
            <img src={abbrechenIconSrc} alt="" className="block w-full h-full" />
          </button>
          <button
            type="button"
            data-tutorial="ki-senden"
            onClick={handleSend}
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            className={`ki-senden w-12 h-12 rounded-full flex justify-center items-center transition-colors ${
              hasInput && !isSending ? 'bg-[#E3F754] opacity-100' : 'bg-[#e3f654] opacity-50'
            }`}
            disabled={!hasInput || isSending}
          >
            <img src={sendIconSrc} alt="" className="w-[20px] h-[20px]" />
          </button>
        </div>
      </div>

      {!isMobileKeyboardMode ? (
        <NaviFooterKomponente
          onNavigateHome={() => setView('list')}
          onNavigateToFahrten={() => setView('ankuenfte')}
          onNavigateToVehicles={() => setView('fahrzeugListe')}
          onNavigateToProfile={() => setView('alleFahrer')}
          onNavigateToAddFahrt={() => setView('fahrtAdd')}
          onNavigateToKi={() => setView('kiAssistent')}
          onNavigateToPlanung={() => setView('kiPlaner')}
          onNavigateToMap={() => setView('karten')}
          activeTab="ki"
        />
      ) : null}
    </div>
  );
}
