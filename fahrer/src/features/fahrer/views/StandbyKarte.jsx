// Standby-Karte in der Fahrtenliste (Entwurf 12.11.): Lime-Etikett "Standby", Ort, Zeitfenster.
// Zustaende: Anfrage (Ablehnen/Annehmen), angenommen, vor Ort (Gast drin), mit Gast (Gast abgesetzt),
// Rueckweg (Mit Gast | Bei Standby), vorbei (grauer Rand).

import { STANDBY_KARTE, hm, standbyVorbei } from '../../../shared/standby';

const LIME = '#E3F654';
const ROT = '#FF6F63';
const ORANGE = '#FFCD8A';
const GRAU = '#868687';
const s = { fontFamily: 'Space Grotesk' };
const uhr = (iso) => (iso ? new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' }) : '');

const GrosserKnopf = ({ text, farbe, onClick }) => (
  <button type="button" onClick={onClick} className="w-[362px] h-[56px] flex items-center justify-between pl-[18px] pr-[16px]" style={{ background: farbe }}>
    <span className="font-bold text-black" style={{ ...s, fontSize: 22 }}>{text}</span>
    <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[19px]" />
  </button>
);

const KnopfPaar = ({ links, rechts, onLinks, onRechts }) => (
  <div className="flex gap-[6px]">
    <button type="button" onClick={onLinks} className="w-[178px] h-[51px] border-2 border-[#ff6f63] flex items-center justify-center">
      <span className="text-[24px] font-bold tracking-[-0.5px] leading-none" style={{ ...s, color: ROT }}>{links}</span>
    </button>
    <button type="button" onClick={onRechts} className="w-[178px] h-[51px] bg-[#e3f754] flex items-center justify-center">
      <span className="text-[24px] font-bold tracking-[-0.5px] leading-none text-black" style={s}>{rechts}</span>
    </button>
  </div>
);

export default function StandbyKarte({ standby, onAntworten, onMelden }) {
  const offen = standby.status === 'pending';
  const vorbei = !offen && standbyVorbei(standby);
  const z = standby.zustand;
  const rand = offen ? 'transparent' : vorbei ? GRAU : z === 'mit_gast' ? ORANGE : LIME;
  const von = hm(standby.von_eigen || standby.von);
  const bis = hm(standby.bis_eigen || standby.bis);

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="relative w-[362px] bg-[#1a1a1a] border-2" style={{ borderColor: rand, minHeight: STANDBY_KARTE }}>
        <div className="absolute left-1/2 -translate-x-1/2 top-0 px-4 h-[34px] flex items-center font-bold text-black" style={{ ...s, background: LIME, fontSize: 18 }}>Standby</div>
        <div className="pt-[54px] px-[16px] pb-[20px]">
          <div className="flex items-center gap-[14px]">
            <div className="w-[64px] h-[64px] rounded-[16px] bg-[#242525] flex items-center justify-center shrink-0">
              <img src="/icon/_Icon_Grau/Pin_Nav_Trisar_Icons_01_grau.svg" alt="" className="w-[30px] h-[30px]" />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-white truncate" style={{ ...s, fontSize: 24, lineHeight: '26px' }}>{standby.ort_name}</div>
              {standby.adresse && standby.adresse !== standby.ort_name ? (
                <div className="font-bold truncate" style={{ ...s, fontSize: 15, color: GRAU }}>{standby.adresse}</div>
              ) : null}
            </div>
          </div>
          <div className="font-bold leading-none mt-[18px]" style={{ ...s, fontSize: 38, color: LIME }}>{von} – {bis}</div>
          {!offen && !vorbei && z === 'mit_gast' ? (
            <div className="font-bold mt-[14px]" style={{ ...s, fontSize: 18, color: ORANGE }}>Mit Gast unterwegs seit {uhr(standby.zustand_seit)}</div>
          ) : null}
        </div>
      </div>

      {offen ? <KnopfPaar links="Ablehnen" rechts="Annehmen" onLinks={() => onAntworten(standby.id, false)} onRechts={() => onAntworten(standby.id, true)} /> : null}
      {!offen && !vorbei && z === 'vor_ort' ? <GrosserKnopf text="Gast drin" farbe={LIME} onClick={() => onMelden(standby.id, 'gast_drin')} /> : null}
      {!offen && !vorbei && z === 'mit_gast' ? <GrosserKnopf text="Gast abgesetzt" farbe={ORANGE} onClick={() => onMelden(standby.id, 'abgesetzt')} /> : null}
      {!offen && !vorbei && z === 'rueckweg' ? (
        <KnopfPaar links="Mit Gast" rechts="Bei Standby" onLinks={() => onMelden(standby.id, 'gast_drin')} onRechts={() => onMelden(standby.id, 'zurueck')} />
      ) : null}
    </div>
  );
}
