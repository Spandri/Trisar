import React from 'react';
import { REIHE_1, REIHE_2, REIHE_3, ZAHL_1, ZAHL_2, ZAHL_3 } from './tastaturHelfer';

// Wird vom Login-Trailer und vom Notiz-Blatt der Fahrer-App genutzt.
// Bildschirmtastatur im iOS-Stil (deutsches Layout) — nur fuer den Demo-
// Trailer, in dem sich der Login selbst ausfuellt. Masse und Aufbau sind am
// Original abgemessen: Vorschlagsleiste, drei Buchstabenreihen in
// Grossbuchstaben, Shift und Backspace 1,5 Tastenbreiten mit 28 px Seitenluft,
// Sonderzeile mit 123 / Sondertaste / Leertaste (Kuerzel "DE") / Return,
// darunter der Streifen mit Globus links, Mikrofon rechts und Homebar.
//
// Heller Look wie auf dem iPhone: eine Web-App setzt keine dunkle
// keyboardAppearance, also zeigt iOS die helle Tastatur.
//
// Sie haengt mit position: fixed am unteren Rand des SICHTBAREN Bereichs. Die
// Login-Flaeche darueber ist 950 px hoch, der Bildschirm aber nur ~874 px —
// mit absolute/bottom-0 lagen Sonderzeile und Homebar ausserhalb des Displays.

// Statt der iOS-Emoji-Taste sitzt der TRISAR-Pfeil auf der Sondertaste.
const TASTATUR_ARROW_URL = '/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg';

const TASTE_HOEHE = 44;
const tastenSchatten = '0 1px 0 rgba(0,0,0,0.28)';
const tastenBasis = 'flex items-center justify-center rounded-[6px] bg-white text-black';

// Angeschlagene Taste: kurz eingedrueckt und grau, wie auf dem iPhone.
const gedruecktStil = {
  background: '#b9bcc4',
  boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.22)',
  transform: 'scale(0.96)',
};
const anschlagUebergang = 'background 90ms ease-out, transform 90ms ease-out, box-shadow 90ms ease-out';

const Taste = ({ kind, gedrueckt = false }) => (
  <span
    className={`flex-1 min-w-0 ${tastenBasis}`}
    style={{
      height: TASTE_HOEHE,
      boxShadow: tastenSchatten,
      fontSize: '22px',
      fontWeight: 400,
      lineHeight: 1,
      transition: anschlagUebergang,
      ...(gedrueckt ? gedruecktStil : null),
    }}
  >
    {kind}
  </span>
);

const Sondertaste = ({ children, breite, flex = false, schrift = '16px', gedrueckt = false }) => (
  <span
    className={`${tastenBasis} ${flex ? 'flex-1 min-w-0 relative' : ''}`}
    style={{
      height: TASTE_HOEHE,
      width: flex ? undefined : breite,
      boxShadow: tastenSchatten,
      fontSize: schrift,
      lineHeight: 1,
      transition: anschlagUebergang,
      ...(gedrueckt ? gedruecktStil : null),
    }}
  >
    {children}
  </span>
);

const Bildschirmtastatur = ({ oben, aktiveTaste = null, ebene = 'abc', istMail = false, vorschlaege = [] }) => {
  const zahlen = ebene === 'zahlen';
  const r1 = zahlen ? ZAHL_1 : REIHE_1;
  const r2 = zahlen ? ZAHL_2 : REIHE_2;
  const r3 = zahlen ? ZAHL_3 : REIHE_3;
  return (
  <div aria-hidden="true" className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none">
    <div
      className="w-[min(402px,100vw)] bg-[#d1d3d9] px-[3px] select-none"
      style={{
        transform: oben ? 'translateY(0)' : 'translateY(110%)',
        transition: 'transform 460ms cubic-bezier(0.22,1,0.36,1)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
      }}
    >
      {/* Vorschlagsleiste — Hoehe bleibt immer gleich, damit die Tastatur beim
          Wechsel zwischen den Feldern nicht springt. */}
      <div className="flex items-center h-[44px] text-black text-[17px]">
        {vorschlaege.map((wort, i) => (
          <React.Fragment key={wort}>
            {i > 0 ? <span className="w-px h-[22px] bg-black/20" /> : null}
            <span className="flex-1 text-center truncate px-2">{wort}</span>
          </React.Fragment>
        ))}
      </div>

      <div className="flex gap-[6px] mb-[11px]">
        {r1.map((k) => <Taste key={k} kind={k} gedrueckt={aktiveTaste === k} />)}
      </div>
      <div className="flex gap-[6px] mb-[11px]">
        {r2.map((k) => <Taste key={k} kind={k} gedrueckt={aktiveTaste === k} />)}
      </div>
      <div className="flex gap-[6px] mb-[11px] items-center">
        <Sondertaste breite={zahlen ? 62 : 45} schrift="16px">
          {zahlen ? '#+=' : (
            <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3 3.4 11.6a.6.6 0 0 0 .43 1.03H8v6.77c0 .33.27.6.6.6h6.8c.33 0 .6-.27.6-.6v-6.77h4.17a.6.6 0 0 0 .43-1.03L12 3z" />
            </svg>
          )}
        </Sondertaste>
        <div className={`flex gap-[6px] flex-1 ${zahlen ? 'px-[8px]' : 'px-[22px]'}`}>
          {r3.map((k) => <Taste key={k} kind={k} gedrueckt={aktiveTaste === k} />)}
        </div>
        <Sondertaste breite={zahlen ? 62 : 45}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6H9.4a1 1 0 0 0-.74.33l-4.2 5a1 1 0 0 0 0 1.34l4.2 5a1 1 0 0 0 .74.33H20a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1z" />
            <path d="m16.5 10-3.5 4M13 10l3.5 4" />
          </svg>
        </Sondertaste>
      </div>
      <div className="flex gap-[6px] items-center">
        {/* Umschalter: zeigt die jeweils ANDERE Ebene an, wie auf dem iPhone. */}
        <Sondertaste breite={43} gedrueckt={aktiveTaste === (zahlen ? 'ABC' : '123')}>
          {zahlen ? 'ABC' : '123'}
        </Sondertaste>
        <Sondertaste breite={43}>
          <img src={TASTATUR_ARROW_URL} alt="" className="w-[26px] h-auto object-contain" />
        </Sondertaste>
        <Sondertaste flex gedrueckt={aktiveTaste === 'leer'}>
          <span className="absolute right-[8px] bottom-[5px] text-[11px] tracking-[0.5px] text-black/35">DE</span>
        </Sondertaste>
        {/* E-Mail-Feld: iOS blendet @ und . als eigene Tasten ein. */}
        {istMail && !zahlen ? (
          <>
            <Sondertaste breite={43} schrift="20px" gedrueckt={aktiveTaste === '@'}>@</Sondertaste>
            <Sondertaste breite={43} schrift="20px" gedrueckt={aktiveTaste === '.'}>.</Sondertaste>
          </>
        ) : null}
        <Sondertaste breite={istMail && !zahlen ? 74 : 93}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-black/35">
            <path d="M20 6v5a3 3 0 0 1-3 3H5" />
            <path d="m8.5 10.5-3.5 3.5 3.5 3.5" />
          </svg>
        </Sondertaste>
      </div>

      {/* Streifen unter der Tastatur: Globus links, Mikrofon rechts, Homebar mittig */}
      <div className="relative h-[44px] text-[#3c3c43]">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="absolute left-[26px] top-[6px]">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
        </svg>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" className="absolute right-[26px] top-[6px]">
          <rect x="9" y="2.5" width="6" height="11" rx="3" />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5" />
        </svg>
        <span className="absolute left-1/2 -translate-x-1/2 bottom-[8px] w-[134px] h-[5px] rounded-full bg-black/80" />
      </div>
    </div>
  </div>
  );
};

export default Bildschirmtastatur;
