import { FLAGGEN, FLAGGE_KREIS_URL, alleHabenFlagge } from '../../shared/flaggen';

// Drei Flaggen-Knoepfe (Figma Koordinator_Screen_Map 2832:12528, Filter_Map_Icon 35 x 35 mit Flagge 14 x 18).
// Umriss = noch nicht bei allen Ausgewaehlten, gefuellt = alle tragen diese Flagge.
// Tippen setzt die Flagge bei allen Ausgewaehlten, bei gefuellter Flagge nimmt es sie wieder weg.
// Zwei Arten: Setzen (ids + flaggeVon: gefuellt, wenn alle Ausgewaehlten die Flagge tragen) oder Filtern
// (nur = benutzte Flaggen, aktiv = gewaehlte Flagge, gefuellt nur die aktive).
export default function FlaggenKnoepfe({ ids = [], flaggeVon = () => null, onWahl, className = '', gesperrt = false, waagerecht = false, nur = null, aktiv, groesse = 35 }) {
  // Flagge waechst mit dem Kreis (35 -> 14 x 18).
  const fb = (groesse * 14) / 35;
  const fh = (groesse * 18) / 35;
  return (
    <div className={`flex ${waagerecht ? 'flex-row gap-[8px]' : (groesse > 35 ? 'flex-col gap-[6px]' : 'flex-col gap-[3px]')} ${className}`} data-tutorial="flaggen-knoepfe">
      {FLAGGEN.filter((f) => !nur || nur.includes(f.id)).map((flagge) => {
        const gefuellt = aktiv !== undefined ? aktiv.includes(flagge.id) : alleHabenFlagge(ids, flaggeVon, flagge.id);
        return (
          <button
            key={flagge.id}
            type="button"
            aria-label={flagge.name}
            aria-pressed={gefuellt}
            disabled={gesperrt}
            data-flagge={flagge.id}
            onClick={() => onWahl(gefuellt && aktiv === undefined ? null : flagge.id)}
            onTouchMove={(event) => event.preventDefault()}
            style={{ width: groesse, height: groesse }}
            className="relative p-0 border-0 bg-transparent touch-none select-none disabled:opacity-60"
          >
            <img src={FLAGGE_KREIS_URL} alt="" className="absolute inset-0" style={{ width: groesse, height: groesse }} />
            <img
              src={gefuellt ? flagge.voll : flagge.umriss}
              alt=""
              className="absolute max-w-none"
              style={{ left: (groesse - fb) / 2, top: (groesse - fh) / 2, width: fb, height: fh }}
            />
          </button>
        );
      })}
    </div>
  );
}
