import { BISHER_PUFFER_MIN } from '../../demo/risikoErgebnisse';

// Bausteine fuer "Risiko je Fahrt": Ereignis-Kacheln, Dash, Verlaufskurve,
// Streudiagramm und Fahrzeit-Verteilung. Farben wie im Engine-Block.

import {
  DUNKEL, GRUEN, KLASSE_FARBE, LIME, ROT, fensterAus, luftFarbe, minuten, zahl,
} from './risikoFarben';

// --- Ereignis-Kacheln -----------------------------------------------------------
export function EreignisKacheln({ ereignisse, klein = false, onOeffnen, marker }) {
  if (!ereignisse?.length) return null;
  const breite = klein ? 130 : 150;
  const hoehe = klein ? 98 : 132;
  return (
    <div
      className="flex gap-[12px] overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-tutorial={marker}
    >
      {ereignisse.map((e) => {
        const eigen = e.quelleArt === 'eigen';
        const k = e.kachelWerte;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onOeffnen?.(e)}
            className="shrink-0 flex flex-col justify-between text-left border-2 border-solid"
            style={{
              width: `${breite}px`,
              height: `${hoehe}px`,
              padding: klein ? '10px 12px' : '14px 16px',
              borderColor: eigen ? '#fefffe' : LIME,
              background: eigen ? '#fefffe' : 'transparent',
              color: eigen ? DUNKEL : LIME,
            }}
          >
            <span className={klein ? 'text-[11px] leading-[13px]' : 'text-[13px] leading-[16px]'}>
              {k.name}{eigen ? ' · von dir' : ''}
            </span>
            <span
              className={`font-bold tracking-[-0.5px] whitespace-nowrap ${klein ? 'leading-[28px]' : 'leading-[36px]'}`}
              style={{ fontSize: `${(klein ? 24 : 32) * (String(k.gross).length > 6 ? 0.75 : 1)}px` }}
            >
              {k.gross}
            </span>
            <span className={klein ? 'text-[11px] leading-[13px]' : 'text-[12px] leading-[15px]'}>{k.klein}</span>
          </button>
        );
      })}
    </div>
  );
}

// --- Sicherheitsband: ein Feld je Stunde ------------------------------------------
export function SicherheitsBand({ verlauf, breite = 326 }) {
  const n = verlauf.length;
  const b = breite / n;
  const marken = [6, 10, 14, 18, 22];
  return (
    <svg width={breite} height={34} className="block" aria-hidden="true">
      {verlauf.map((s, i) => (
        <rect key={s.h} x={i * b + 1} y={0} width={b - 2} height={16} fill={luftFarbe(s.luft_p10)} />
      ))}
      {marken.map((h) => (
        <text key={h} x={(h - 6) * b + b / 2} y={31} fill={LIME} fontSize={10} textAnchor="middle">
          {String(h).padStart(2, '0')}
        </text>
      ))}
    </svg>
  );
}

// --- Dash im KI Planer ------------------------------------------------------------
export function PufferDash({ option, ereignisAnzahl, onOeffnen }) {
  if (!option) return null;
  const knapp = option.knappste_stunde;
  const knappFarbe = luftFarbe(option.verlauf.find((s) => s.h === knapp)?.luft_p10);
  return (
    <button
      type="button"
      onClick={onOeffnen}
      data-tutorial="planer-puffer-dash"
      className="w-full text-left border-2 border-solid px-[16px] py-[14px]"
      style={{ borderColor: LIME, color: LIME }}
    >
      <div className="flex items-center justify-between">
        <p className="text-[16px] font-bold">Puffer je Fahrt</p>
        <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[28px]" />
      </div>
      <div className="grid grid-cols-3 mt-[12px]">
        <div>
          <p className="text-[28px] font-bold leading-[32px] tracking-[-0.5px]">{zahl(option.puffer_mittel)}</p>
          <p className="text-[12px] leading-[15px] opacity-75">Ø min<br />{`bisher mind. ${BISHER_PUFFER_MIN}`}</p>
        </div>
        <div>
          <p className="text-[28px] font-bold leading-[32px] tracking-[-0.5px]" style={{ color: option.hoch.length ? ROT : LIME }}>
            {zahl(option.hoch.length)}
          </p>
          <p className="text-[12px] leading-[15px] opacity-75">Fahrten<br />hohes Risiko</p>
        </div>
        <div>
          <p className="text-[28px] font-bold leading-[32px] tracking-[-0.5px]">{zahl(ereignisAnzahl)}</p>
          <p className="text-[12px] leading-[15px] opacity-75">Ereignisse<br />eingerechnet</p>
        </div>
      </div>
      <div className="flex items-baseline justify-between mt-[14px]">
        <p className="text-[12px] font-medium">Sicherheit über den Tag</p>
        {knapp != null ? (
          <p className="text-[11px]" style={{ color: knappFarbe }}>{`knappste Zeit ${knapp}–${knapp + 1} Uhr`}</p>
        ) : null}
      </div>
      <div className="mt-[6px]"><SicherheitsBand verlauf={option.verlauf} /></div>
    </button>
  );
}

// --- Fächer: Luft je Stunde über alle Verläufe -----------------------------------
// Je Verlauf zählt der knappste Anschluss der Stunde. Neun leicht deckende Bänder
// (5–95 %, 10–90 % … 45–55 %) ergeben den Farbverlauf, Linie = Median.
// Stunden ohne Anschluss bleiben offen.
export function LuftFaecher({ faecher, gewaehlt, onWaehlen, breite = 326, hoehe = 170 }) {
  const f = (faecher || []).filter((p) => p.n && p.q?.length === 19);
  if (!f.length) return null;
  const x0 = 28; const x1 = breite - 4; const y0 = hoehe - 22; const ym = 8;
  const werte = f.flatMap((p) => [p.q[0], p.q[18]]);
  const max = Math.max(20, Math.ceil(Math.max(...werte, 0) / 10) * 10);
  const min = Math.max(-30, Math.min(0, Math.floor(Math.min(...werte, 0) / 10) * 10));
  const X = (h) => x0 + ((h - 6) / 17) * (x1 - x0);
  const Y = (v) => y0 - ((Math.max(v, min) - min) / (max - min)) * (y0 - ym);
  const stuecke = f.reduce((acc, p, i) => {
    if (i && p.h === f[i - 1].h + 1) acc[acc.length - 1].push(p); else acc.push([p]);
    return acc;
  }, []);
  const band = (lo, hi, farbe) => stuecke.map((seg) => (seg.length === 1 ? (
    <rect key={`${lo}-${seg[0].h}`} x={X(seg[0].h) - 3} y={Y(seg[0].q[hi])} width={6} height={Y(seg[0].q[lo]) - Y(seg[0].q[hi])} fill={farbe} />
  ) : (
    <polygon
      key={`${lo}-${seg[0].h}`}
      points={[...seg.map((p) => `${X(p.h)},${Y(p.q[hi])}`), ...seg.slice().reverse().map((p) => `${X(p.h)},${Y(p.q[lo])}`)].join(' ')}
      fill={farbe}
    />
  )));
  const schichten = (farbe) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => band(k, 18 - k, farbe));
  const achse = min < 0 ? [min, ...(-min / (max - min) > 0.15 ? [0] : []), max] : [0, max / 2, max];
  return (
    <svg width={breite} height={hoehe} className="block">
      <defs>
        <clipPath id="faecher-ueber"><rect x={0} y={0} width={breite} height={Y(0)} /></clipPath>
        <clipPath id="faecher-unter"><rect x={x0} y={Y(0)} width={x1 - x0} height={y0 - Y(0) + 1} /></clipPath>
      </defs>
      {achse.map((v) => <text key={v} x={0} y={Y(v) + 4} fill={LIME} fontSize={10}>{zahl(v)}</text>)}
      {[6, 10, 14, 18, 22].map((h) => (
        <text key={h} x={X(h)} y={hoehe - 6} fill={LIME} fontSize={10} textAnchor="middle">{String(h).padStart(2, '0')}</text>
      ))}
      <line x1={x0} x2={x1} y1={Y(0)} y2={Y(0)} stroke="rgba(255,255,255,.35)" strokeDasharray="3 3" />
      <g clipPath="url(#faecher-ueber)">{schichten('rgba(227,246,84,.12)')}</g>
      {min < 0 ? <g clipPath="url(#faecher-unter)">{schichten('rgba(255,111,99,.2)')}</g> : null}
      {stuecke.map((seg) => (
        <polyline key={seg[0].h} points={seg.map((p) => `${X(p.h)},${Y(p.p50)}`).join(' ')} fill="none" stroke="#fff" strokeWidth={1.8} />
      ))}
      {gewaehlt != null ? <line x1={X(gewaehlt)} x2={X(gewaehlt)} y1={ym} y2={y0} stroke="rgba(255,255,255,.4)" /> : null}
      {f.map((p) => <circle key={p.h} cx={X(p.h)} cy={Y(p.p50)} r={gewaehlt === p.h ? 5 : 2.6} fill="#fff" />)}
      {f.map((p) => (
        <rect
          key={`t${p.h}`}
          x={X(p.h) - 9}
          y={ym}
          width={18}
          height={y0 - ym}
          fill="transparent"
          className="cursor-pointer"
          onClick={() => onWaehlen?.(p.h)}
        />
      ))}
    </svg>
  );
}

// --- Streudiagramm: Puffer je Fahrt über den Tag ----------------------------------
export function PufferStreuung({ fahrten, ereignisse = [], breite = 326, hoehe = 190 }) {
  const x0 = 26; const x1 = breite - 4; const y0 = hoehe - 24; const ym = 6;
  const punkte = Object.values(fahrten || {})
    .filter((f) => f.luft && minuten(f.abfahrt) != null)
    .map((f) => ({ m: minuten(f.abfahrt), p: f.luft.puffer, k: f.klasse }));
  const max = Math.max(40, Math.ceil(Math.max(...punkte.map((p) => p.p), 0) / 10) * 10);
  const X = (m) => x0 + ((Math.min(Math.max(m, 360), 1440) - 360) / 1080) * (x1 - x0);
  const Y = (v) => y0 - (Math.max(0, v) / max) * (y0 - ym);
  // Nur Ereignisse, die die Engine eingerechnet hat; Name nur am ersten Zeitfenster.
  const baender = ereignisse.filter((e) => e.art === 'ereignis' && e.quelleArt === 'auto')
    .flatMap((e) => fensterAus(e.zeit).map(([a, b], i) => ({ a, b, name: i === 0 ? (e.kachelWerte?.name || e.kurz) : '' })));
  return (
    <svg width={breite} height={hoehe} className="block" aria-hidden="true">
      {baender.map((b) => (
        <g key={`${b.name}-${b.a}`}>
          <rect x={X(b.a)} y={ym} width={Math.max(2, X(b.b) - X(b.a))} height={y0 - ym} fill="rgba(255,111,99,.12)" />
          {b.name ? <text x={X(b.a) + 3} y={ym + 11} fill={ROT} fontSize={10}>{b.name}</text> : null}
        </g>
      ))}
      {[0, max / 2, max].map((v) => (
        <g key={v}>
          <line x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke="rgba(227,246,84,.18)" />
          <text x={0} y={Y(v) + 4} fill={LIME} fontSize={10}>{zahl(v)}</text>
        </g>
      ))}
      <text x={x0 + 4} y={Y(max) + 12} fill={LIME} fontSize={10}>min</text>
      {[6, 10, 14, 18, 22].map((h) => (
        <text key={h} x={X(h * 60)} y={hoehe - 6} fill={LIME} fontSize={10} textAnchor="middle">{String(h).padStart(2, '0')}</text>
      ))}
      <line x1={x0} x2={x1} y1={Y(BISHER_PUFFER_MIN)} y2={Y(BISHER_PUFFER_MIN)} stroke="#fff" strokeWidth={1.2} strokeDasharray="5 4" />
      {punkte.map((p, i) => <circle key={i} cx={X(p.m)} cy={Y(p.p)} r={3.4} fill={KLASSE_FARBE[p.k]} />)}
    </svg>
  );
}

// --- Fahrzeit-Verteilung einer Fahrt ----------------------------------------------
export function FahrzeitVerteilung({ fahrzeit, breite = 326 }) {
  const hist = fahrzeit?.hist || [];
  if (!hist.length) return null;
  const n = hist.length;
  const bw = breite / n;
  const max = Math.max(...hist, 1);
  const schritt = (fahrzeit.bis - fahrzeit.von) / n;
  const mitte = (i) => fahrzeit.von + (i + 0.5) * schritt;
  const farbe = (i) => (mitte(i) <= fahrzeit.p50 + 2 ? GRUEN : mitte(i) <= fahrzeit.p90 ? LIME : ROT);
  const xMed = ((fahrzeit.p50 - fahrzeit.von) / Math.max(1, fahrzeit.bis - fahrzeit.von)) * breite;
  return (
    <svg width={breite} height={70} className="block" aria-hidden="true">
      {hist.map((v, i) => (
        <rect key={i} x={i * bw + 1} y={52 - (v / max) * 48} width={bw - 2} height={(v / max) * 48} fill={farbe(i)} />
      ))}
      <line x1={xMed} x2={xMed} y1={0} y2={52} stroke={DUNKEL} strokeWidth={1.5} />
      <text x={0} y={66} fill={DUNKEL} fontSize={10} opacity={0.6}>{`${fahrzeit.von} min`}</text>
      <text x={breite} y={66} fill={DUNKEL} fontSize={10} opacity={0.6} textAnchor="end">{`${fahrzeit.bis} min`}</text>
    </svg>
  );
}
