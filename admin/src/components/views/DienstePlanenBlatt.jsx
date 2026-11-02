// "Dienste planen" in der Fahrerliste: Dienstzeit fuer die ausgewaehlten Fahrer
// setzen. Gestaltung wie der KI-Planer (Lime, eckig, Space Grotesk) statt der
// Datums- und Zeitfelder des Browsers: Tag als Kacheln, Vorlagen mit Uhrzeit,
// Zeiten mit Plus und Minus in 15-Minuten-Schritten.
// Die Tutorial-Markierungen (dienste-sheet, dienst-vorlagen, dienst-vorlage-*,
// dienst-abbrechen, dienst-anwenden) bleiben wie bisher.

const LIME = '#E3F654';
const SCHRITT_MIN = 15;

const zuMinuten = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
const zuUhrzeit = (min) => {
  const tag = 24 * 60;
  const x = ((min % tag) + tag) % tag;
  return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
};
// Dauer in Stunden, ueber Mitternacht gerechnet (Nachtdienst 22–06 = 8 h).
const dauerText = (start, ende) => {
  const a = zuMinuten(start);
  const b = zuMinuten(ende);
  if (a == null || b == null) return '';
  const d = ((b - a) + 24 * 60) % (24 * 60) || 24 * 60;
  const h = Math.floor(d / 60);
  const m = d % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
};

function Zeit({ titel, wert, onWert, start }) {
  // Ohne Wert beginnt Plus und Minus bei einer sinnvollen Uhrzeit.
  const ausgang = zuMinuten(wert) ?? zuMinuten(start);
  const aendern = (delta) => onWert(zuUhrzeit(ausgang + delta));
  const knopf = 'w-[44px] h-[44px] border-2 flex items-center justify-center text-[22px] font-bold leading-none';
  return (
    <div className="border-2 px-[12px] pt-[8px] pb-[10px]" style={{ borderColor: LIME }}>
      <span className="block text-[12px] font-medium" style={{ color: 'rgba(227,246,84,0.8)' }}>{titel}</span>
      <div className="mt-[6px] flex items-center justify-between gap-[8px]">
        <button type="button" onClick={() => aendern(-SCHRITT_MIN)} className={knopf} style={{ borderColor: LIME, color: LIME }} aria-label={`${titel} 15 Minuten früher`}>–</button>
        <span className="text-[30px] font-bold tabular-nums tracking-[-0.5px]" style={{ color: wert ? LIME : 'rgba(227,246,84,0.35)' }}>{wert || start}</span>
        <button type="button" onClick={() => aendern(SCHRITT_MIN)} className={knopf} style={{ borderColor: LIME, color: LIME }} aria-label={`${titel} 15 Minuten später`}>+</button>
      </div>
    </div>
  );
}

export default function DienstePlanenBlatt({
  t,
  anzahl,
  tage,            // [{ iso, wochentag, datum }] der Planungshorizont
  datum, onDatum,
  start, onStart,
  ende, onEnde,
  vorlagen,
  fehler,
  speichert,
  onAnwenden,
  onSchliessen,
}) {
  const aktiveVorlage = vorlagen.find((v) => v.start === start && v.end === ende)?.key || null;
  return (
    <div data-tutorial="dienste-sheet" className="absolute left-0 right-0 bottom-0 bg-black border-t-2 px-[20px] pt-[20px] pb-[22px] max-h-[calc(100dvh-20px)] overflow-y-auto font-['Space_Grotesk']" style={{ borderColor: LIME }}>
      <div className="flex items-baseline justify-between">
        <div className="text-[30px] font-bold leading-tight tracking-[-0.5px]" style={{ color: LIME }}>{t('fahrer.planServices')}</div>
        <div className="text-[13px] font-medium text-white/70">
          {anzahl > 0 ? t('fahrer.driversSelected', { n: anzahl }) : t('fahrer.noneSelected')}
        </div>
      </div>

      {/* Tag */}
      <div className="mt-[16px] grid grid-cols-3 gap-[8px]">
        {tage.map((tag) => {
          const aktiv = tag.iso === datum;
          return (
            <button
              key={tag.iso}
              type="button"
              onClick={() => onDatum(tag.iso)}
              className="h-[56px] border-2 flex flex-col items-center justify-center"
              style={{ borderColor: LIME, background: aktiv ? LIME : 'transparent', color: aktiv ? '#000' : LIME }}
            >
              <span className="text-[12px] font-medium leading-[14px]">{tag.wochentag}</span>
              <span className="text-[18px] font-bold leading-[22px]">{tag.datum}</span>
            </button>
          );
        })}
      </div>

      {/* Vorlagen */}
      <div data-tutorial="dienst-vorlagen" className="mt-[10px] grid grid-cols-4 gap-[8px]">
        {vorlagen.map((v) => {
          const aktiv = v.key === aktiveVorlage;
          return (
            <button
              key={v.key}
              type="button"
              data-tutorial={`dienst-vorlage-${v.key}`}
              onClick={() => { onStart(v.start); onEnde(v.end); }}
              className="h-[56px] border-2 flex flex-col items-center justify-center"
              style={{ borderColor: LIME, background: aktiv ? LIME : 'transparent', color: aktiv ? '#000' : LIME }}
            >
              <span className="text-[14px] font-bold leading-[17px]">{t(v.labelKey)}</span>
              <span className="text-[11px] leading-[14px] opacity-80 tabular-nums">{`${v.start.slice(0, 2)}–${v.end.slice(0, 2)}`}</span>
            </button>
          );
        })}
      </div>

      {/* Zeiten */}
      <div className="mt-[10px] grid grid-cols-2 gap-[8px]">
        <Zeit titel={t('fahrer.serviceStart')} wert={start} onWert={onStart} start="08:00" />
        <Zeit titel={t('fahrer.serviceEnd')} wert={ende} onWert={onEnde} start="16:00" />
      </div>
      <div className="mt-[8px] h-[16px] text-[12px] text-white/60 tabular-nums">
        {start && ende ? `${dauerText(start, ende)} Dienst${zuMinuten(ende) <= zuMinuten(start) ? ', endet am Folgetag' : ''}` : ''}
      </div>

      {fehler ? (
        <div className="mt-[8px] text-[#FF8E8E] text-[13px] whitespace-pre-line font-medium">{fehler}</div>
      ) : null}

      <div className="mt-[12px] grid grid-cols-2 gap-[8px]">
        <button
          type="button"
          onClick={onSchliessen}
          data-tutorial="dienst-abbrechen"
          className="h-[51px] border-2 border-white/30 text-white text-[16px] font-medium"
        >
          {t('fahrer.cancel')}
        </button>
        <button
          type="button"
          onClick={onAnwenden}
          data-tutorial="dienst-anwenden"
          disabled={speichert}
          className="h-[51px] text-black text-[16px] font-bold disabled:opacity-60"
          style={{ background: LIME }}
        >
          {speichert ? t('fahrer.saving') : t('fahrer.applyToDrivers', { n: anzahl || 0 })}
        </button>
      </div>
    </div>
  );
}
