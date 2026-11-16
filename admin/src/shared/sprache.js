// Sprache fuer den Voice-Modus im KI-Assistenten (13.11.).
// Erkennung und Vorlesen laufen im Browser (Web Speech API), nichts geht an fremde Dienste
// ausser dem, was der Browser selbst fuer die Erkennung nutzt. Der Pegel fuer die Kugel
// kommt beim Zuhoeren vom Mikrofon, beim Vorlesen aus den Wortgrenzen der Stimme.

const erkennungKlasse = () => (typeof window !== 'undefined'
  ? (window.SpeechRecognition || window.webkitSpeechRecognition || null)
  : null);

export const spracheMoeglich = () => Boolean(erkennungKlasse()) && typeof window.speechSynthesis !== 'undefined';

// --- Satzende wie bei ChatGPT --------------------------------------------
// ChatGPT schickt nicht nach einer festen Pause ab, sondern schaetzt, ob der Satz fertig
// klingt („semantic VAD“). Klingt er offen („und“, „äh“, „zum“ am Ende), wird lange
// gewartet. Die Wartezeit zaehlt ab dem letzten Wort UND dem letzten hoerbaren Ton.
const OFFENE_ENDEN = new Set([
  'und', 'oder', 'aber', 'sondern', 'dann', 'also', 'weil', 'dass', 'wenn', 'ob', 'damit', 'bevor', 'nachdem', 'sowie',
  'äh', 'ähm', 'ehm', 'hm', 'hmm', 'öh', 'öhm', 'mh', 'quasi', 'sozusagen',
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'mein', 'meine', 'dein', 'sein', 'seine', 'ihr', 'ihre', 'unser', 'unsere',
  'zu', 'zum', 'zur', 'von', 'vom', 'nach', 'mit', 'für', 'bei', 'beim', 'an', 'am', 'auf', 'in', 'im', 'ins',
  'um', 'ab', 'bis', 'über', 'unter', 'vor', 'hinter', 'neben', 'zwischen', 'gegen', 'ohne', 'durch', 'aus',
  'ich', 'du', 'er', 'sie', 'wir', 'soll', 'sollen', 'kann', 'muss', 'will', 'möchte', 'bitte', 'noch', 'auch',
  'erstelle', 'buche', 'schick', 'schicke', 'sag', 'sage', 'schreib', 'schreibe', 'lösche', 'setze', 'verschiebe',
  'halb', 'viertel', 'uhr', 'morgen', 'heute', 'übermorgen',
]);
const KURZ_FERTIG = /^(ja|jap|jo|nein|nee|ne|nö|ok|okay|stopp|stop|danke|genau|passt|richtig|falsch|abbrechen)$/i;

// Wie lange nach dem letzten Wort und Ton gewartet wird, bevor der Satz abgeschickt wird.
export function endeWartezeit(text, { frage = false } = {}) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return Infinity;
  const woerter = t.split(/\s+/);
  const letztes = woerter[woerter.length - 1].replace(/[.,!?;:…"„“]+$/g, '');
  if (frage && woerter.length <= 3 && (istJa(t) || istNein(t))) return 700;
  if (woerter.length === 1 && KURZ_FERTIG.test(letztes)) return 900;
  if (/[,\-–…]$/.test(t) || OFFENE_ENDEN.has(letztes)) return 3500;
  if (woerter.length <= 2) return 2500;
  if (/[.!?]$/.test(t)) return 1300;
  return 1800;
}

// --- Zuhoeren ---------------------------------------------------------------
// Hoert dauerhaft zu, meldet Zwischentext und den fertigen Satz, sobald er fertig klingt.
// letzteStimme(): Zeitpunkt (ms) des letzten hoerbaren Tons vom Mikrofon.
export function erkennungStarten({ onZwischen, onSatz, onFehler, letzteStimme = () => 0, frage = false }) {
  const ErkennungKlasse = erkennungKlasse();
  if (!ErkennungKlasse) {
    onFehler?.('nicht_unterstuetzt');
    return { stoppen() {}, jetztSenden() {} };
  }
  let aktiv = true;
  let text = '';
  let zwischen = '';
  let letztesWort = 0;
  let unveraendertSeit = 0;
  const rec = new ErkennungKlasse();
  rec.lang = 'de-DE';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  const ganz = () => `${text} ${zwischen}`.replace(/\s+/g, ' ').trim();
  const abschliessen = () => {
    const satz = ganz();
    text = '';
    zwischen = '';
    if (satz && aktiv) {
      aktiv = false;
      try { rec.abort(); } catch { /* schon aus */ }
      onSatz?.(satz);
    }
  };

  // Alle 100 ms pruefen, ob der Satz fertig ist.
  const pruefer = window.setInterval(() => {
    if (!aktiv) return;
    const satz = ganz();
    if (!satz) return;
    const jetzt = Date.now();
    const ruhe = jetzt - Math.max(letztesWort, letzteStimme() || 0);
    // Ton ohne neue Woerter (Rauschen, Musik) haelt den Satz hoechstens 6 s offen.
    const zuLange = jetzt - unveraendertSeit > 6000 && jetzt - letztesWort > 1500;
    if (ruhe >= endeWartezeit(satz, { frage }) || zuLange) abschliessen();
  }, 100);

  rec.onresult = (ev) => {
    let fertig = '';
    let offen = '';
    for (let i = ev.resultIndex; i < ev.results.length; i += 1) {
      const r = ev.results[i];
      if (r.isFinal) fertig += r[0].transcript;
      else offen += r[0].transcript;
    }
    const vorher = ganz();
    if (fertig) text = `${text} ${fertig}`;
    zwischen = offen;
    const nachher = ganz();
    letztesWort = Date.now();
    if (nachher !== vorher) unveraendertSeit = letztesWort;
    onZwischen?.(nachher);
  };
  rec.onerror = (ev) => {
    if (ev.error === 'no-speech' || ev.error === 'aborted') return;
    onFehler?.(ev.error);
  };
  // Chrome beendet die Erkennung nach einer Weile Stille. Solange aktiv, neu starten.
  rec.onend = () => {
    if (!aktiv) return;
    try { rec.start(); } catch { /* laeuft schon */ }
  };
  try { rec.start(); } catch (e) { onFehler?.(String(e?.message || e)); }

  return {
    // Kugel antippen beim Zuhoeren: sofort abschicken, ohne zu warten.
    jetztSenden() { abschliessen(); },
    stoppen() {
      aktiv = false;
      window.clearInterval(pruefer);
      try { rec.abort(); } catch { /* schon aus */ }
    },
  };
}

// --- Mikrofon-Pegel ----------------------------------------------------------
// Liefert 0..1, geglaettet. Fuer die Kugel, nicht fuer die Erkennung.
export async function pegelStarten(onPegel) {
  let strom = null;
  let ctx = null;
  let rahmen = 0;
  try {
    strom = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    ctx = new Ctx();
    const quelle = ctx.createMediaStreamSource(strom);
    const analyse = ctx.createAnalyser();
    analyse.fftSize = 512;
    quelle.connect(analyse);
    const daten = new Uint8Array(analyse.fftSize);
    const schritt = () => {
      analyse.getByteTimeDomainData(daten);
      let summe = 0;
      for (let i = 0; i < daten.length; i += 1) {
        const v = (daten[i] - 128) / 128;
        summe += v * v;
      }
      const rms = Math.sqrt(summe / daten.length);
      onPegel(Math.min(1, Math.max(0, (rms - 0.01) * 7)));
      rahmen = window.requestAnimationFrame(schritt);
    };
    schritt();
  } catch {
    onPegel(0);
    return { stoppen() {}, erlaubt: false };
  }
  return {
    erlaubt: true,
    stoppen() {
      window.cancelAnimationFrame(rahmen);
      strom?.getTracks().forEach((t) => t.stop());
      ctx?.close().catch(() => {});
    },
  };
}

// --- Vorlesen ----------------------------------------------------------------
let stimmeCache = null;
function deutscheStimme() {
  if (stimmeCache) return stimmeCache;
  const alle = window.speechSynthesis.getVoices().filter((v) => /^de(-|_|$)/i.test(v.lang));
  const gut = (v) => /premium|enhanced|natural|neural|google/i.test(v.name);
  stimmeCache = alle.find(gut) || alle.find((v) => /anna|helena|petra|markus/i.test(v.name)) || alle[0] || null;
  return stimmeCache;
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.onvoiceschanged = () => { stimmeCache = null; };
}

// Antworttext so umbauen, dass er sich gut vorlesen laesst.
export function zumVorlesen(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/(\d{1,2}):00\b/g, '$1 Uhr')
    .replace(/(\d{1,2}):(\d{2})\b/g, '$1 Uhr $2')
    .replace(/\s*[–—]\s*/g, ' bis ')
    .replace(/[„“”"]/g, '')
    .replace(/\n+/g, '. ')
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .trim();
}

// Liest vor, meldet Pegel-Stoesse bei jedem Wort. Gibt Promise zurueck, die nach dem Ende aufloest.
export function vorlesen(text, { onPegel } = {}) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const satz = zumVorlesen(text);
  if (!satz) return { fertig: Promise.resolve(), stoppen() {} };
  const u = new SpeechSynthesisUtterance(satz);
  u.lang = 'de-DE';
  const stimme = deutscheStimme();
  if (stimme) u.voice = stimme;
  u.rate = 1.05;
  let rahmen = 0;
  let stoss = 0;
  let laeuft = true;
  // Ohne Zugriff auf den Ton: jedes Wort gibt einen Stoss, dazwischen klingt er ab.
  const schritt = () => {
    if (!laeuft) return;
    stoss *= 0.9;
    onPegel?.(Math.min(1, 0.15 + stoss));
    rahmen = window.requestAnimationFrame(schritt);
  };
  u.onboundary = () => { stoss = 0.55 + Math.random() * 0.35; };
  const fertig = new Promise((resolve) => {
    const ende = () => {
      laeuft = false;
      window.cancelAnimationFrame(rahmen);
      onPegel?.(0);
      resolve();
    };
    u.onend = ende;
    u.onerror = ende;
  });
  synth.speak(u);
  schritt();
  return {
    fertig,
    stoppen() {
      laeuft = false;
      synth.cancel();
    },
  };
}

// Kurze Antworten auf eine Rueckfrage erkennen.
export const istJa = (t) => /^(ja|jap|jo|jawohl|genau|passt|ok|okay|klar|mach( das)?|bitte|senden|buchen|abschicken|richtig|stimmt)\b/i.test(String(t || '').trim());
export const istNein = (t) => /^(nein|nee|ne|nö|nicht|stopp|abbrechen|lass( es)?|falsch)\b/i.test(String(t || '').trim());
