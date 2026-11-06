import { useEffect, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { hasSupabaseAdminConfig, supabase, supabaseAdmin } from '../../services/supabase';
import { useI18n } from '../../i18n';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 913;

const screenBg = {
  backgroundImage: "url('/icon/_Icon_Schwarz/screen-bg-radial.svg')",
};

// Auswahl für Antrieb/Kraftstoff — steuert auch die EV-Erkennung der
// KI-Fahrzeugplanung (Elektro => Reichweiten- und Ladeplanung).
const FUEL_TYPES = ['E10', 'Super 95', 'Super Plus', 'Diesel B7', 'Diesel B10', 'Elektro', 'Plug-in-Hybrid'];

// Anzeige-Labels für die Antriebsauswahl: der gespeicherte value bleibt exakt
// der FUEL_TYPES-String, nur die Anzeige läuft über t().
const FUEL_TYPE_LABEL_KEYS = {
  'E10': 'erstellen.fuelE10',
  'Super 95': 'erstellen.fuelSuper95',
  'Super Plus': 'erstellen.fuelSuperPlus',
  'Diesel B7': 'erstellen.fuelDieselB7',
  'Diesel B10': 'erstellen.fuelDieselB10',
  'Elektro': 'erstellen.fuelElektro',
  'Plug-in-Hybrid': 'erstellen.fuelPluginHybrid',
};

// Fahrzeugbild-Upload wie beim Profilbild in den Einstellungen: Datei wird
// als Data-URL eingelesen (In-Memory-Demo, kein Storage) und leicht skaliert.
const readFileAsDataUrl = (file, t) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error(t('erstellen.errorFileReadFailed')));
  reader.readAsDataURL(file);
});

const prepareVehicleImageDataUrl = async (file, t) => {
  const sourceDataUrl = await readFileAsDataUrl(file, t);
  const image = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('erstellen.errorImageLoadFailed')));
    img.src = sourceDataUrl;
  });
  const maxSide = 1000;
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  if (scale >= 1) return sourceDataUrl;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
};

const Box = ({ x, y, w, h = 56, children, className = '' }) => (
  <div
    className={`absolute border-2 border-[#e3f654] ${className}`}
    style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
  >
    {children}
  </div>
);

const datumKurz = (wert) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(wert || ''));
  return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
};

// Aufsicht des Fahrzeugs (Front oben, 120 x 240) mit Marke, wie WagenAufsicht der Fahrer-App.
function FahrzeugSkizze({ stelle, hoehe = 110 }) {
  const x = Math.min(101, Math.max(19, Number(stelle?.x)));
  const y = Math.min(221, Math.max(19, Number(stelle?.y)));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return (
    <div className="flex flex-col items-center shrink-0">
      <svg viewBox="0 0 120 240" style={{ height: `${hoehe}px`, width: `${(hoehe * 120) / 240}px` }}>
        <rect x="5" y="40" width="13" height="36" fill="#1c1c1d" />
        <rect x="102" y="40" width="13" height="36" fill="#1c1c1d" />
        <rect x="5" y="164" width="13" height="36" fill="#1c1c1d" />
        <rect x="102" y="164" width="13" height="36" fill="#1c1c1d" />
        <rect x="6" y="84" width="14" height="9" fill="#1c1c1d" />
        <rect x="100" y="84" width="14" height="9" fill="#1c1c1d" />
        <rect x="16" y="4" width="88" height="232" rx="24" fill="#f7f7f7" stroke="#1c1c1d" strokeWidth="3" />
        <path d="M31 100 L89 100 L83 72 L37 72 Z" fill="#1c1c1d" />
        <path d="M31 148 L89 148 L83 178 L37 178 Z" fill="#1c1c1d" />
        <circle cx={x} cy={y} r="17" fill="#e3f754" stroke="#1c1c1d" strokeWidth="2.5" />
        <circle cx={x} cy={y} r="5" fill="#1c1c1d" />
      </svg>
      {stelle?.geschaetzt && <span className="text-[#71717b] text-[9px] mt-1">ungefähre Stelle</span>}
    </div>
  );
}

// Schadensbericht wie in der Fahrer-App (VehicleView), fuer die Dispo nur zum Lesen.
// Fotos oeffnen sich gross in einem neuen Tab.
function SchadensBericht({ schaeden, blockRef }) {
  return (
    <div ref={blockRef} className="absolute left-5 w-[362px] bg-white p-[24px]" style={{ top: '822px' }}>
      <h3 className="text-[#1d1c1c] text-[18px] font-bold tracking-[-0.5px] mb-[10px]">
        Schadensbericht{schaeden.length ? ` (${schaeden.length})` : ''}
      </h3>
      <div className="w-full h-[1px] bg-[#dddcdc] mb-[10px]" />
      {!schaeden.length && (
        <div className="text-[#71717b] text-[14px] tracking-[-0.5px]">Keine Schäden gemeldet.</div>
      )}
      {schaeden.map((schaden, index) => {
        const bilder = (schaden.image_urls?.length ? schaden.image_urls : [schaden.image_url]).filter((u) => u && !String(u).startsWith('blob:'));
        return (
          <div key={schaden.id || index} className="mb-[10px]">
            <div className="flex items-baseline justify-between mb-[6px]">
              <span className="text-[#1d1c1c] text-[15px] font-bold tracking-[-0.5px]">{datumKurz(schaden.report_date)}</span>
              {(schaden.melder || schaden.reported_by_driver) && (
                <span className="text-[#71717b] text-[11px] tracking-[-0.3px]">
                  {schaden.melder ? `gemeldet von ${schaden.melder}` : 'vom Fahrer gemeldet'}
                </span>
              )}
            </div>
            <div className="flex gap-[14px] mb-[10px]">
              <div className="flex-1 min-w-0">
                <div className="text-[#1d1c1c] text-[11px] font-bold tracking-[-0.5px] mb-[4px] uppercase">{schaden.part_name || ''}</div>
                <div className="text-[#1d1c1c] text-[14px] font-bold tracking-[-0.5px] whitespace-pre-wrap">{schaden.description}</div>
              </div>
              {schaden.stelle ? <FahrzeugSkizze stelle={schaden.stelle} /> : null}
            </div>
            {bilder.length > 0 && (
              <div className="flex gap-[4px] mb-[10px]">
                {bilder.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="flex-1 min-w-0">
                    <img src={url} alt="Schadensfoto" className="w-full h-[96px] object-cover bg-[#f4f4f4]" />
                  </a>
                ))}
              </div>
            )}
            {index < schaeden.length - 1 && <div className="w-full h-[1px] bg-[#dddcdc] mb-[10px]" />}
          </div>
        );
      })}
    </div>
  );
}

export default function FahrzeugErstellenView({ setView, initialVehicle = null, onSaved = null }) {
  const { t } = useI18n();
  const [scale, setScale] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');
  // Gemeldete Schaeden dieses Fahrzeugs (nur beim Bearbeiten).
  const [schaeden, setSchaeden] = useState([]);
  const [schadenHoehe, setSchadenHoehe] = useState(0);
  const schadenRef = useRef(null);

  const [brandModel, setBrandModel] = useState('');
  const [trim, setTrim] = useState('');
  const [vin, setVin] = useState('');
  const [licensePlate, setLicensePlate] = useState('');
  const [color, setColor] = useState('');
  const [seatCount, setSeatCount] = useState('');
  const [fuelType, setFuelType] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  const brandModelRef = useRef(null);
  const trimRef = useRef(null);
  const vinRef = useRef(null);
  const licensePlateRef = useRef(null);
  const colorRef = useRef(null);
  const seatCountRef = useRef(null);
  const fuelTypeRef = useRef(null);
  const imageFileRef = useRef(null);

  const isEditMode = Boolean(initialVehicle?.id);

  useEffect(() => {
    if (!initialVehicle?.id) { setSchaeden([]); return undefined; }
    let aktiv = true;
    supabase.from('vehicle_damages').select('*').eq('vehicle_id', initialVehicle.id)
      .order('report_date', { ascending: false }).order('created_at', { ascending: false })
      .then(async ({ data }) => {
        const liste = data || [];
        // Namen der meldenden Fahrer dazuholen (reported_by -> profiles).
        const ids = [...new Set(liste.map((d) => d.reported_by).filter(Boolean))];
        let namen = {};
        if (ids.length) {
          const { data: profile } = await supabase.from('profiles').select('id,first_name,last_name').in('id', ids);
          namen = Object.fromEntries((profile || []).map((p) => [p.id, [p.first_name, p.last_name].filter(Boolean).join(' ')]));
        }
        if (aktiv) setSchaeden(liste.map((d) => ({ ...d, melder: namen[d.reported_by] || '' })));
      });
    return () => { aktiv = false; };
  }, [initialVehicle?.id]);

  useEffect(() => {
    const el = schadenRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const beobachter = new ResizeObserver(() => setSchadenHoehe(el.offsetHeight));
    beobachter.observe(el);
    setSchadenHoehe(el.offsetHeight);
    return () => beobachter.disconnect();
  }, [isEditMode, schaeden]);
  // Seite waechst mit dem Schadensbericht (beginnt bei 20 + 822).
  const seitenHoehe = isEditMode ? Math.max(BASE_HEIGHT, 20 + 822 + schadenHoehe + 70) : BASE_HEIGHT;

  useEffect(() => {
    const updateScale = () => setScale(Math.min(window.innerWidth / BASE_WIDTH, 1));
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  useEffect(() => {
    setBrandModel(String(initialVehicle?.brand_model || '').trim());
    setTrim(String(initialVehicle?.trim || '').trim());
    setVin(String(initialVehicle?.vin || '').trim());
    setLicensePlate(String(initialVehicle?.license_plate || '').trim());
    setColor(String(initialVehicle?.color || '').trim());
    setSeatCount(
      initialVehicle?.seat_count === null || initialVehicle?.seat_count === undefined
        ? ''
        : String(initialVehicle.seat_count),
    );
    setFuelType(String(initialVehicle?.fuel_type || '').trim());
    setImageUrl(String(initialVehicle?.image_url || '').trim());
    setFeedback('');
  }, [initialVehicle]);

  const inputClass =
    'absolute left-4 right-12 top-1/2 -translate-y-1/2 bg-transparent border-none outline-none text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium placeholder:text-[#8a9728] placeholder:opacity-90';

  const resetForm = () => {
    setBrandModel('');
    setTrim('');
    setVin('');
    setLicensePlate('');
    setColor('');
    setSeatCount('');
    setFuelType('');
    setImageUrl('');
  };

  const saveVehicle = async () => {
    if (!brandModel.trim()) {
      setFeedback(t('erstellen.errorBrandModelRequired'));
      return;
    }

    const parsedSeatCount = seatCount.trim() ? Number(seatCount) : null;
    if (seatCount.trim() && (!Number.isInteger(parsedSeatCount) || parsedSeatCount < 0)) {
      setFeedback(t('erstellen.errorSeatCountInvalid'));
      return;
    }

    setIsSubmitting(true);
    setFeedback('');

    const payload = {
      brand_model: brandModel.trim(),
      trim: trim.trim() || null,
      vin: vin.trim() || null,
      license_plate: licensePlate.trim() || null,
      color: color.trim() || null,
      seat_count: parsedSeatCount,
      fuel_type: fuelType.trim() || null,
      image_url: imageUrl.trim() || null,
    };

    try {
      let result = null;
      if (isEditMode) {
        result = await supabase
          .from('vehicles')
          .update(payload)
          .eq('id', initialVehicle.id)
          .select('*');
        const updatedRows = Array.isArray(result.data) ? result.data : [];
        const missingRowWithoutError = !result.error && updatedRows.length === 0;
        if (missingRowWithoutError && hasSupabaseAdminConfig) {
          result = await supabaseAdmin
            .from('vehicles')
            .update(payload)
            .eq('id', initialVehicle.id)
            .select('*');
        }
      } else {
        result = await supabase.from('vehicles').insert([payload]).select('*').single();
      }
      if (result.error) {
        const fallbackAllowed = /invalid jwt|signature is invalid|not allowed|unauthorized|permission denied/i.test(result.error.message || '');
        if (fallbackAllowed) {
          if (isEditMode) {
            result = await supabaseAdmin
              .from('vehicles')
              .update(payload)
              .eq('id', initialVehicle.id)
              .select('*');
          } else {
            result = await supabaseAdmin.from('vehicles').insert([payload]).select('*').single();
          }
        }
      }
      if (result.error) throw result.error;
      const savedVehicle = Array.isArray(result.data) ? (result.data[0] || null) : (result.data || null);
      if (isEditMode && !savedVehicle) {
        throw new Error(t('erstellen.errorVehicleNotUpdated'));
      }
      setFeedback(isEditMode ? t('erstellen.vehicleUpdated') : t('erstellen.vehicleCreated'));
      if (typeof onSaved === 'function') onSaved(savedVehicle);
      if (isEditMode) {
        window.setTimeout(() => setView('fahrzeugListe'), 200);
      } else {
        resetForm();
      }
    } catch (error) {
      setFeedback(isEditMode
        ? t('erstellen.vehicleUpdateError', { error: error.message })
        : t('erstellen.vehicleSaveError', { error: error.message }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
    <div
      className="h-dvh w-full bg-black overflow-y-auto overflow-x-hidden flex justify-center overscroll-none"
      style={{ WebkitTextSizeAdjust: 'none', WebkitOverflowScrolling: 'touch', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${seitenHoehe * scale}px` }}>
        <div className="absolute left-0 top-0 w-[402px] origin-top-left" style={{ ...screenBg, transform: `scale(${scale})`, height: `${seitenHoehe}px` }}>
          <BackCircleButton onClick={() => setView('fahrzeugListe')} className="absolute left-5 top-[60px]" />

          <div className="absolute left-0 top-[20px] w-[402px]">
            <h1 className={`absolute left-5 top-[120px] text-[#e2f754] tracking-[-0.5px] font-bold whitespace-nowrap ${isEditMode ? 'text-[36px] leading-[36px]' : 'text-[42px] leading-[42px]'}`}>
              {isEditMode ? t('erstellen.vehicleEditTitle') : t('erstellen.vehicleCreateTitle')}
            </h1>

            <Box x={20} y={186} w={178}>
              <input
                ref={brandModelRef}
                value={brandModel}
                onChange={(event) => setBrandModel(event.target.value)}
                placeholder={t('erstellen.brandModel')}
                className={inputClass}
              />
              <button type="button" onClick={() => brandModelRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={204} y={186} w={178}>
              <input
                ref={trimRef}
                value={trim}
                onChange={(event) => setTrim(event.target.value)}
                placeholder={t('erstellen.trim')}
                className={inputClass}
              />
              <button type="button" onClick={() => trimRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={254} w={362}>
              <input
                ref={vinRef}
                value={vin}
                onChange={(event) => setVin(event.target.value)}
                placeholder="VIN"
                className={inputClass}
              />
              <button type="button" onClick={() => vinRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={322} w={362}>
              <input
                ref={licensePlateRef}
                value={licensePlate}
                onChange={(event) => setLicensePlate(event.target.value)}
                placeholder={t('erstellen.licensePlate')}
                className={inputClass}
              />
              <button type="button" onClick={() => licensePlateRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={390} w={362}>
              <input
                ref={colorRef}
                value={color}
                onChange={(event) => setColor(event.target.value)}
                placeholder={t('erstellen.color')}
                className={inputClass}
              />
              <button type="button" onClick={() => colorRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={458} w={362}>
              <input
                ref={seatCountRef}
                value={seatCount}
                onChange={(event) => setSeatCount(event.target.value.replace(/[^\d]/g, ''))}
                placeholder={t('erstellen.seatCount')}
                className={inputClass}
              />
              <button type="button" onClick={() => seatCountRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={526} w={362}>
              <select
                ref={fuelTypeRef}
                value={fuelType}
                onChange={(event) => setFuelType(event.target.value)}
                className={`${inputClass} appearance-none cursor-pointer ${fuelType ? '' : 'opacity-90'}`}
              >
                <option value="" disabled hidden>{t('erstellen.fuelType')}</option>
                {FUEL_TYPES.map((option) => (
                  <option key={option} value={option} className="bg-[#101010] text-[#e3f654]">
                    {t(FUEL_TYPE_LABEL_KEYS[option])}
                  </option>
                ))}
                {fuelType && !FUEL_TYPES.includes(fuelType) ? (
                  <option value={fuelType} className="bg-[#101010] text-[#e3f654]">{fuelType}</option>
                ) : null}
              </select>
              <button type="button" onClick={() => fuelTypeRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px] rotate-90" />
              </button>
            </Box>

            <Box x={20} y={594} w={362}>
              <button
                type="button"
                onClick={() => imageFileRef.current?.click()}
                className="absolute left-4 right-12 top-1/2 -translate-y-1/2 text-left text-[#8a9728] text-[16px] leading-6 tracking-[0.5px] font-medium overflow-hidden text-ellipsis whitespace-nowrap"
              >
                {imageUrl ? t('erstellen.vehicleImageChange') : t('erstellen.vehicleImageUpload')}
              </button>
              {imageUrl ? (
                <img src={imageUrl} alt="" className="absolute right-11 top-1/2 -translate-y-1/2 h-[40px] w-[64px] object-contain" />
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (imageUrl) setImageUrl('');
                  else imageFileRef.current?.click();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2"
                aria-label={imageUrl ? t('erstellen.vehicleImageRemove') : t('erstellen.vehicleImageUpload')}
              >
                {imageUrl ? (
                  <span className="text-[#f55757] text-[16px] font-bold leading-none">×</span>
                ) : (
                  <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
                )}
              </button>
              <input
                ref={imageFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  try {
                    setImageUrl(await prepareVehicleImageDataUrl(file, t));
                    setFeedback('');
                  } catch (uploadError) {
                    setFeedback(uploadError?.message || t('erstellen.errorImageReadFailed'));
                  }
                }}
              />
            </Box>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={saveVehicle}
              className="absolute left-5 top-[674px] w-[362px] h-14 bg-[#dbee4a] disabled:opacity-70"
            >
              <span className="text-[#0e1008] text-[16px] leading-6 tracking-[0.5px] font-medium">
                {isSubmitting ? t('erstellen.saving') : isEditMode ? t('erstellen.vehicleSave') : t('erstellen.vehicleCreateTitle')}
              </span>
            </button>

            <div className="absolute left-5 top-[742px] w-[362px] min-h-[56px] px-3 py-2 border border-[#7f8a2b] text-[#c8d85d] text-[12px] leading-[1.3]">
              {feedback || (isEditMode ? t('erstellen.vehicleEditHint') : t('erstellen.vehicleCreateHint'))}
            </div>

            {isEditMode && (
              <SchadensBericht schaeden={schaeden} blockRef={schadenRef} />
            )}

          </div>
        </div>
      </div>
    </div>
    {/* Footer fest am unteren Rand — ausserhalb des skalierten Inhalts, weil
        position: fixed sich sonst am transform-Elternteil ausrichten wuerde. */}
    <TrisarFooter className="fixed bottom-0 left-1/2 -translate-x-1/2 w-[min(402px,100vw)] h-10 bg-black z-[70]" />
    </>
  );
}
