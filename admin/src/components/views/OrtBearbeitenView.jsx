// Eigenen Ort anlegen oder bearbeiten (aus dem Karten Filter heraus).
// Adresse wie beim Fahrt erstellen suchen, danach den Pin auf der Karte auf die
// Einfahrt schieben. lat/lng kommen vom Pin, die Adresse bleibt die gesuchte.
// Reinfahr- und Rausfahr-Radius werden live als Kreise um den Pin gezeigt.
import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { useI18n } from '../../i18n';
import { demoConfirm, tutorialLaeuft } from '../ui/demoDialoge';
import { adresseAufloesen, karteBereitstellen } from '../../shared/karte/maplibreKarte';
import { ortKreiseZeigen } from '../../shared/karte/ortKreise';
import { ORT_ICONS, ortIconUrl, ortLoeschen, ortSpeichern, radienPruefen, STANDARD_RADIEN } from '../../shared/orte';

const GREEN = '#E3F654';
const ROW_HEIGHT = 56;
const KARTE_HOEHE = 240;
// Muenchen, solange noch keine Adresse gewaehlt ist.
const MITTE_VORGABE = { lat: 48.137154, lng: 11.576124 };

// Zwei Felder nebeneinander fuer Reinfahr-/Rausfahr-Radius in Metern.
// Wird auch im Karten Filter fuer die Standard-Radien benutzt.
export function RadiusFeld({ left, top, label, value, onChange, onCommit, marker }) {
  const inputRef = useRef(null);
  return (
    <div
      data-tutorial={marker}
      className="absolute w-[175px] h-14 border-2 border-[#E3F654] flex items-center px-3 gap-2"
      style={{ left: `${left}px`, top: `${top}px` }}
      onClick={() => inputRef.current?.focus()}
    >
      <span className="shrink-0 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']">{label}</span>
      <input
        ref={inputRef}
        type="number"
        inputMode="numeric"
        min="10"
        step="1"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={() => onCommit?.()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="w-full min-w-0 bg-transparent border-none outline-none text-right text-base leading-6 tracking-[0.5px] text-[#E3F654] font-medium font-['Space_Grotesk']"
      />
      <span className="shrink-0 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']">m</span>
    </div>
  );
}

// Eingabezeile wie beim Fahrt erstellen (FormRow): Rahmen, Beschriftung halbtransparent.
function TextZeile({ top, label, value, onChange, onFocus, onBlur, onReset, marker }) {
  const { t } = useI18n();
  const gefuellt = String(value || '').trim().length > 0;
  return (
    <div
      className="w-[362px] h-14 absolute border-2 inline-flex justify-start items-center gap-1 overflow-hidden"
      style={{ left: '20px', top: `${top}px`, borderColor: GREEN }}
    >
      <div className="relative flex-1 self-stretch p-1 flex justify-start items-center">
        <div className="flex-1 self-stretch px-3 pr-10 flex justify-start items-center gap-4 min-w-0">
          <div className="shrink-0 opacity-50 text-[16px] font-medium leading-6 tracking-[0.5px]" style={{ color: GREEN, fontFamily: 'Space Grotesk' }}>
            {label}
          </div>
          <input
            data-tutorial={marker}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onFocus={onFocus}
            onBlur={onBlur}
            className="w-full min-w-0 bg-transparent border-none outline-none text-[16px] font-medium leading-6 tracking-[0.5px]"
            style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
          />
        </div>
        <div className="absolute right-[12px] top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center">
          {gefuellt ? (
            <button type="button" onClick={onReset} className="flex items-center justify-center" aria-label={t('fahrt.resetField', { label })}>
              <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
            </button>
          ) : (
            <div className="pointer-events-none">
              <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const zahlOderNull = (wert) => {
  const zahl = Number(wert);
  return Number.isFinite(zahl) ? zahl : null;
};

export default function OrtBearbeitenView({ ort = null, onClose = () => {}, onFetchPlaceSuggestions = async () => [] }) {
  const { t } = useI18n();
  const istNeu = !ort?.id;
  const [name, setName] = useState(ort?.name || '');
  const [adresse, setAdresse] = useState(ort?.adresse || '');
  const [pin, setPin] = useState(() => {
    const lat = zahlOderNull(ort?.lat);
    const lng = zahlOderNull(ort?.lng);
    return lat !== null && lng !== null ? { lat, lng } : null;
  });
  const [rein, setRein] = useState(String(ort?.radius_rein_m ?? STANDARD_RADIEN.radius_rein_m));
  const [raus, setRaus] = useState(String(ort?.radius_raus_m ?? STANDARD_RADIEN.radius_raus_m));
  const [icon, setIcon] = useState(ort?.icon || 'pin');
  const [vorschlaege, setVorschlaege] = useState([]);
  const [vorschlaegeOffen, setVorschlaegeOffen] = useState(false);
  const [hinweis, setHinweis] = useState('');
  const [sucht, setSucht] = useState(false);
  const [speichert, setSpeichert] = useState(false);

  const kartenFeldRef = useRef(null);
  const karteRef = useRef(null);
  const pinMarkerRef = useRef(null);
  const anfrageRef = useRef(null);
  const anfrageNrRef = useRef(0);
  const iconRef = useRef(icon);

  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
    }),
    [],
  );

  // Karte einmal anlegen. Tipp auf die Karte setzt den Pin dorthin.
  useEffect(() => {
    const KARTE = karteBereitstellen();
    if (!kartenFeldRef.current || karteRef.current) return undefined;
    const start = pin || MITTE_VORGABE;
    const karte = new KARTE.Map(kartenFeldRef.current, { center: start, zoom: pin ? 16 : 12 });
    karteRef.current = karte;
    karte.addListener('click', (event) => {
      const ziel = event?.domEvent?.target;
      if (ziel?.closest?.('.maplibregl-marker')) return;
      const lat = Number(event?.latLng?.lat?.());
      const lng = Number(event?.latLng?.lng?.());
      if (Number.isFinite(lat) && Number.isFinite(lng)) setPin({ lat, lng });
    });
    return () => {
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = null;
      karte.abbauen();
      karteRef.current = null;
    };
    // Nur beim Oeffnen: die Startposition kommt aus dem Ort.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pin (verschiebbar) mit dem gewaehlten Icon in Lime.
  useEffect(() => {
    iconRef.current = icon;
    const karte = karteRef.current;
    if (!karte) return;
    if (!pin) {
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = null;
      return;
    }
    if (!pinMarkerRef.current) {
      const bild = document.createElement('img');
      bild.alt = '';
      Object.assign(bild.style, { width: '34px', height: '34px', display: 'block', cursor: 'grab' });
      const marker = new maplibregl.Marker({ element: bild, draggable: true, anchor: 'center' });
      marker.on('dragend', () => {
        const stelle = marker.getLngLat();
        setPin({ lat: stelle.lat, lng: stelle.lng });
      });
      marker.setLngLat([pin.lng, pin.lat]).addTo(karte.karte);
      pinMarkerRef.current = marker;
    } else {
      pinMarkerRef.current.setLngLat([pin.lng, pin.lat]);
    }
    const element = pinMarkerRef.current.getElement();
    if (element && element.src !== ortIconUrl(icon, true)) element.src = ortIconUrl(icon, true);
  }, [pin, icon]);

  // Kreise live mitzeigen.
  useEffect(() => {
    const karte = karteRef.current;
    if (!karte) return;
    ortKreiseZeigen(karte, pin ? { ...pin, radius_rein_m: Number(rein) || 0, radius_raus_m: Number(raus) || 0 } : null, 'ort-bearbeiten');
  }, [pin, rein, raus]);

  useEffect(() => () => {
    if (anfrageRef.current) clearTimeout(anfrageRef.current);
  }, []);

  const adresseTippen = (wert) => {
    setAdresse(wert);
    setHinweis('');
    const getippt = String(wert || '').trim();
    if (anfrageRef.current) clearTimeout(anfrageRef.current);
    if (!getippt) {
      setVorschlaege([]);
      return;
    }
    setVorschlaegeOffen(true);
    const nummer = anfrageNrRef.current + 1;
    anfrageNrRef.current = nummer;
    anfrageRef.current = setTimeout(async () => {
      const optionen = await onFetchPlaceSuggestions(getippt);
      if (anfrageNrRef.current !== nummer) return;
      setVorschlaege(Array.isArray(optionen) ? optionen : []);
    }, 250);
  };

  const adresseWaehlen = async (text) => {
    setAdresse(text);
    setVorschlaege([]);
    setVorschlaegeOffen(false);
    setSucht(true);
    const punkt = await adresseAufloesen(text);
    setSucht(false);
    if (!punkt || !Number.isFinite(Number(punkt.lat)) || !Number.isFinite(Number(punkt.lng))) {
      setHinweis(t('orte.fehlerPin'));
      return;
    }
    const neu = { lat: Number(punkt.lat), lng: Number(punkt.lng) };
    setPin(neu);
    const karte = karteRef.current;
    if (karte?.karte) karte.karte.easeTo({ center: [neu.lng, neu.lat], zoom: 16, duration: 600 });
  };

  const speichern = async () => {
    if (speichert) return;
    const sauberName = name.trim();
    if (!sauberName) {
      setHinweis(t('orte.fehlerName'));
      return;
    }
    if (!adresse.trim()) {
      setHinweis(t('orte.fehlerAdresse'));
      return;
    }
    if (!pin) {
      setHinweis(t('orte.fehlerPin'));
      return;
    }
    const pruefung = radienPruefen(rein, raus);
    if (pruefung) {
      setHinweis(t(pruefung === 'rein' ? 'orte.fehlerRein' : pruefung === 'raus' ? 'orte.fehlerRaus' : 'orte.fehlerRadien'));
      return;
    }
    setHinweis('');
    setSpeichert(true);
    const ergebnis = await ortSpeichern({
      id: ort?.id || null,
      name: sauberName,
      adresse: adresse.trim(),
      lat: pin.lat,
      lng: pin.lng,
      radius_rein_m: Number(rein),
      radius_raus_m: Number(raus),
      icon,
    });
    setSpeichert(false);
    if (!ergebnis.ok) {
      if (ergebnis.art === 'doppelt') setHinweis(t('orte.fehlerDoppelt'));
      else if (ergebnis.art === 'radien') setHinweis(t('orte.fehlerRadien'));
      else setHinweis(`${t('filter.levelSaveError')}${ergebnis.meldung ? `: ${ergebnis.meldung}` : ''}`);
      return;
    }
    onClose();
  };

  const loeschen = async () => {
    if (!ort?.id) return;
    if (!demoConfirm(t('orte.loeschenFrage', { name: ort.name }))) return;
    const ergebnis = await ortLoeschen(ort.id);
    if (!ergebnis.ok) {
      setHinweis(`${t('filter.levelSaveError')}${ergebnis.meldung ? `: ${ergebnis.meldung}` : ''}`);
      return;
    }
    onClose();
  };

  const nameTop = 186;
  const adresseTop = nameTop + 68;
  const karteTop = adresseTop + 68;
  const pinHinweisTop = karteTop + KARTE_HOEHE + 8;
  const radienTop = pinHinweisTop + 32;
  const iconLabelTop = radienTop + ROW_HEIGHT + 24;
  const iconTop = iconLabelTop + 32;
  const hinweisTop = iconTop + 52 + 16;
  const speichernTop = hinweisTop + (hinweis ? 48 : 4);
  const loeschenTop = speichernTop + 68;
  const seitenHoehe = (istNeu ? speichernTop : loeschenTop) + ROW_HEIGHT + 120;

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden" style={gradientStyle}>
      <div className="h-full overflow-y-auto overscroll-none pb-[70px]" style={{ touchAction: 'pan-y', WebkitOverflowScrolling: 'touch' }}>
        <div className="relative" style={{ height: `${seitenHoehe}px` }}>
          <div className="absolute inset-x-0 top-[20px]">
            <BackCircleButton onClick={onClose} marker="ort-zurueck" className="absolute left-[20px] top-[40px]" />

            <h1 className="absolute left-[20px] top-[120px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">
              {istNeu ? t('orte.neuTitel') : t('orte.bearbeitenTitel')}
            </h1>

            <TextZeile
              top={nameTop}
              label={t('orte.name')}
              value={name}
              onChange={(wert) => {
                setName(wert);
                setHinweis('');
              }}
              onReset={() => setName('')}
              marker="ort-name"
            />

            <TextZeile
              top={adresseTop}
              label={t('orte.adresse')}
              value={adresse}
              onChange={adresseTippen}
              onFocus={() => setVorschlaegeOffen(true)}
              onBlur={() => setTimeout(() => {
                if (tutorialLaeuft()) return;
                setVorschlaegeOffen(false);
              }, 120)}
              onReset={() => {
                setAdresse('');
                setVorschlaege([]);
              }}
              marker="ort-adresse"
            />

            <div
              className="absolute left-[20px] w-[362px] border-2 border-[#E3F654] overflow-hidden bg-black"
              style={{ top: `${karteTop}px`, height: `${KARTE_HOEHE}px` }}
            >
              <div ref={kartenFeldRef} data-tutorial="ort-karte" className="absolute inset-0" />
            </div>

            <div
              className="absolute left-[20px] w-[362px] h-6 text-sm leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk'] truncate"
              style={{ top: `${pinHinweisTop}px` }}
            >
              {sucht ? t('orte.sucht') : pin ? t('orte.pinHinweis') : t('orte.pinFehlt')}
            </div>

            <RadiusFeld left={20} top={radienTop} label={t('orte.rein')} value={rein} onChange={setRein} marker="ort-rein" />
            <RadiusFeld left={207} top={radienTop} label={t('orte.raus')} value={raus} onChange={setRaus} marker="ort-raus" />

            <div
              className="absolute left-[20px] w-[362px] h-6 text-base leading-6 tracking-[0.5px] text-[#E3F654]/60 font-medium font-['Space_Grotesk']"
              style={{ top: `${iconLabelTop}px` }}
            >
              {t('orte.icon')}
            </div>
            {ORT_ICONS.map((eintrag, index) => {
              const gewaehlt = eintrag.key === icon;
              return (
                <button
                  key={eintrag.key}
                  type="button"
                  data-tutorial={`ort-icon-${eintrag.key}`}
                  onClick={() => setIcon(eintrag.key)}
                  aria-label={t(`orte.icon_${eintrag.key}`)}
                  aria-pressed={gewaehlt}
                  className={`absolute w-[52px] h-[52px] border-2 flex items-center justify-center transition-colors ${gewaehlt ? 'border-[#E3F654]' : 'border-[#E3F654]/30'}`}
                  style={{ left: `${20 + index * 62}px`, top: `${iconTop}px` }}
                >
                  <img src={gewaehlt ? eintrag.lime : eintrag.grau} alt="" className="w-[30px] h-[30px] object-contain" />
                </button>
              );
            })}

            {hinweis ? (
              <div
                className="absolute left-[20px] w-[362px] text-sm leading-5 text-[#ff6b6b] font-medium font-['Space_Grotesk']"
                style={{ top: `${hinweisTop}px` }}
              >
                {hinweis}
              </div>
            ) : null}

            <button
              type="button"
              onClick={speichern}
              disabled={speichert}
              data-tutorial="ort-speichern"
              className="absolute left-[20px] w-[362px] h-14 bg-[#E3F654] border-2 border-[#E3F654] flex items-center px-3 disabled:opacity-60"
              style={{ top: `${speichernTop}px` }}
            >
              <span className="flex-1 text-left text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">{t('orte.speichern')}</span>
              <img src="/icon/_Icon_Schwarz/Arrow_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
            </button>

            {!istNeu ? (
              <button
                type="button"
                onClick={loeschen}
                data-tutorial="ort-loeschen"
                className="absolute left-[20px] w-[362px] h-14 bg-[#ff6b6b] border-2 border-[#ff6b6b] flex items-center px-3"
                style={{ top: `${loeschenTop}px` }}
              >
                <span className="flex-1 text-left text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">{t('orte.loeschen')}</span>
                <img src="/icon/_Icon_Schwarz/Arrow_Nav_Trisar_Icons_01.svg" alt="" className="w-[34px] h-[20px]" />
              </button>
            ) : null}

            {vorschlaegeOffen && vorschlaege.length > 0 ? (
              <div
                className="absolute left-[20px] w-[362px] max-h-[180px] overflow-y-auto rounded-2xl border border-[#4a4f22] bg-[#151607] z-[120]"
                style={{ top: `${adresseTop + ROW_HEIGHT + 4}px` }}
              >
                {vorschlaege.map((option, index) => (
                  <button
                    key={`ort-adresse-${index}-${option}`}
                    type="button"
                    data-tutorial={`ort-vorschlag-${index}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      adresseWaehlen(option);
                    }}
                    className="w-full px-3 py-3 text-left text-[13px] font-medium border-b last:border-b-0 border-[#2a2d15]"
                    style={{ color: GREEN, fontFamily: 'Space Grotesk' }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <TrisarFooter className="absolute bottom-0 left-0 right-0 h-10 bg-black" />
    </div>
  );
}
