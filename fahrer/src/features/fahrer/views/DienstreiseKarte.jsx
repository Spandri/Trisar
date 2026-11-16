// Dienstreise in der Fahrtenliste (Entwurf 13.11.): sieht aus wie eine Fahrt. Lime-Etikett "Dienstreise"
// mit Koffer, Kacheln Start (Zug/Flug) und Ziel, Startzeit gross, darunter Zug- bzw. Flugnummer.
// Anfrage: Ablehnen/Annehmen darunter. Antippen oeffnet die Ansicht mit Karte (DienstreiseDetail).

import {
  REISE_KARTE, abschnittIcon, hm, minutenSpaet, reiseNummer, startIcon, useVerbindung, zeitFarbe, zielIcon,
} from '../../../shared/dienstreise';
import { SpaetKachel } from './ZugHalte';

const LIME = '#e2f754';
const s = { fontFamily: 'Space Grotesk' };

export default function DienstreiseKarte({ reise, onAntworten, onOpen }) {
  const offen = reise.status === 'pending';
  // Mit Umstiegen: Hauptzug (erster Fern-/Regionalzug oder Flug) und Zahl der Umstiege.
  const teile = reise.abschnitte || [];
  const haupt = teile.find((a) => a.art === 'zug' || a.art === 'flug') || teile[0];
  const nummer = teile.length > 1
    ? `${haupt?.nummer || ''} · ${teile.length - 1} ${teile.length - 1 === 1 ? 'Umstieg' : 'Umstiege'}`.replace(/^ · /, '')
    : reiseNummer(reise);
  const ersterIcon = teile.length ? abschnittIcon(teile[0].art) : startIcon(reise);
  // Ohne Umstiege: Live-Abfahrt (wie in der Detailansicht). Verspaetet: Zeit orange, daneben "+5".
  const v = useVerbindung(teile.length > 1 ? null : reise);
  const startZeit = (teile.length > 1 ? '' : v?.abfahrt) || hm(reise.start_zeit);
  const spaet = teile.length > 1 ? 0 : minutenSpaet(v?.abfahrt_plan, v?.abfahrt);
  return (
    <div className="flex flex-col gap-[12px]">
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(reise)}
        onKeyDown={(e) => { if (e.key === 'Enter') onOpen(reise); }}
        className="relative w-[362px] bg-[#1a1a1a] border-2 border-[#e3f754] cursor-pointer touch-manipulation"
        style={{ height: REISE_KARTE }}
        data-tutorial={`dienstreise-${reise.id}`}
      >
        <div className="absolute left-1/2 -translate-x-1/2 top-[-2px] min-w-[90px] h-[29px] px-[10px] gap-[8px] bg-[#e3f754] flex items-center justify-center">
          <span className="text-black text-[18px] font-bold tracking-[-0.5px] leading-none" style={s}>Dienstreise</span>
          <img src="/icon/_Icon_Schwarz/Rollkoffer_Trisar_Icons_01.svg" alt="" className="w-[18px] h-[18px] object-contain" />
        </div>
        <div className="absolute w-[70px] h-[70px] bg-[#242525] rounded-[12px] flex items-center justify-center" style={{ left: 31, top: 40 }}>
          <img src={ersterIcon} alt="" className="w-[30px] h-[30px] object-contain" />
        </div>
        <div className="absolute w-[70px] h-[70px] bg-[#242525] rounded-[12px] flex items-center justify-center" style={{ left: 254, top: 40 }}>
          <img src={zielIcon(reise)} alt="" className="w-[30px] h-[30px] object-contain" />
        </div>
        <div className="absolute text-[#868786] text-[10px] font-bold tracking-[-0.5px] text-center" style={{ ...s, left: '50%', transform: 'translateX(-50%)', top: 45, width: 60 }}>START</div>
        <div className="absolute flex items-center justify-center gap-[6px] whitespace-nowrap" style={{ ...s, left: '50%', transform: 'translate(-50%, -50%)', top: 75 }}>
          <span className="text-[30px] font-bold tracking-[-0.5px] leading-none" style={{ color: spaet ? zeitFarbe(spaet) : LIME }}>{startZeit}</span>
          <SpaetKachel min={spaet} />
        </div>
        {nummer ? (
          <div className="absolute text-[#f4f5f4] opacity-50 text-[10px] text-center tracking-[-0.5px]" style={{ ...s, left: '50%', transform: 'translateX(-50%)', top: 93, width: 130 }}>{nummer}</div>
        ) : null}
        <div className="absolute left-[20px] right-[19px] grid grid-cols-[minmax(0,1fr)_29px_minmax(0,1fr)] gap-x-[18px] items-center" style={{ ...s, top: 125 }}>
          <div className="text-left text-white text-[16px] font-bold tracking-[-0.5px] leading-[20px] break-words min-w-0">{reise.start_name}</div>
          <div className="w-[29px] h-[20px] flex items-center justify-center">
            <img src="/icon/_Icon_Lime/Arrow_Trisar_Icons_01_Lime.svg" alt="" className="w-[29px] h-[20px] object-contain scale-[1.15]" />
          </div>
          <div className="text-right text-white text-[16px] font-bold tracking-[-0.5px] leading-[20px] break-words min-w-0">{reise.ziel_name}</div>
        </div>
      </div>

      {offen ? (
        <div className="flex gap-[6px]">
          <button type="button" onClick={() => onAntworten(reise.id, false)} className="w-[178px] h-[51px] border-2 border-[#ff6f63] flex items-center justify-center">
            <span className="text-[24px] font-bold tracking-[-0.5px] leading-none text-[#ff6f63]" style={s}>Ablehnen</span>
          </button>
          <button type="button" onClick={() => onAntworten(reise.id, true)} className="w-[178px] h-[51px] bg-[#e3f754] flex items-center justify-center">
            <span className="text-[24px] font-bold tracking-[-0.5px] leading-none text-black" style={s}>Annehmen</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
