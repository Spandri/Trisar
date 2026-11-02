import { useEffect, useRef, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import TrisarFooter from '../ui/TrisarFooter';
import { hasSupabaseAdminConfig, supabase, supabaseAdmin } from '../../services/supabase';

const BASE_WIDTH = 402;
const BASE_HEIGHT = 913;

const screenBg = {
  backgroundImage: "url('/icon/_Icon_Schwarz/screen-bg-radial.svg')",
};

const Box = ({ x, y, w, h = 56, children, className = '' }) => (
  <div
    className={`absolute border-2 border-[#e3f654] ${className}`}
    style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }}
  >
    {children}
  </div>
);

export default function FahrzeugErstellenView({ setView, initialVehicle = null, onSaved = null }) {
  const [scale, setScale] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState('');

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
  const imageUrlRef = useRef(null);

  const isEditMode = Boolean(initialVehicle?.id);

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
      setFeedback('Bitte Marke & Modell angeben.');
      return;
    }

    const parsedSeatCount = seatCount.trim() ? Number(seatCount) : null;
    if (seatCount.trim() && (!Number.isInteger(parsedSeatCount) || parsedSeatCount < 0)) {
      setFeedback('Beifahreranzahl muss eine positive ganze Zahl sein.');
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
        throw new Error('Kein Fahrzeug aktualisiert (ID nicht gefunden oder keine Schreibrechte).');
      }
      setFeedback(isEditMode ? 'Fahrzeug erfolgreich aktualisiert.' : 'Fahrzeug erfolgreich erstellt.');
      if (typeof onSaved === 'function') onSaved(savedVehicle);
      if (isEditMode) {
        window.setTimeout(() => setView('fahrzeugListe'), 200);
      } else {
        resetForm();
      }
    } catch (error) {
      setFeedback(`Fahrzeug konnte nicht ${isEditMode ? 'aktualisiert' : 'gespeichert'} werden: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="h-dvh w-full bg-black overflow-y-auto overflow-x-hidden flex justify-center overscroll-none"
      style={{ WebkitTextSizeAdjust: 'none', WebkitOverflowScrolling: 'touch', textSizeAdjust: 'none', fontFamily: 'Space Grotesk, sans-serif' }}
    >
      <div className="relative shrink-0" style={{ width: `${BASE_WIDTH * scale}px`, height: `${BASE_HEIGHT * scale}px` }}>
        <div className="absolute left-0 top-0 w-[402px] origin-top-left" style={{ ...screenBg, transform: `scale(${scale})`, height: `${BASE_HEIGHT}px` }}>
          <BackCircleButton onClick={() => setView('fahrzeugListe')} className="absolute left-5 top-[60px]" />

          <div className="absolute left-0 top-[20px] w-[402px]">
            <h1 className={`absolute left-5 top-[124px] text-[#e2f754] tracking-[-0.5px] font-bold whitespace-nowrap ${isEditMode ? 'text-[36px] leading-[36px]' : 'text-[42px] leading-[42px]'}`}>
              {isEditMode ? 'Fahrzeug bearbeiten' : 'Fahrzeug erstellen'}
            </h1>

            <Box x={20} y={184} w={178}>
              <input
                ref={brandModelRef}
                value={brandModel}
                onChange={(event) => setBrandModel(event.target.value)}
                placeholder="Marke & Modell"
                className={inputClass}
              />
              <button type="button" onClick={() => brandModelRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={204} y={184} w={178}>
              <input
                ref={trimRef}
                value={trim}
                onChange={(event) => setTrim(event.target.value)}
                placeholder="Modell Variante"
                className={inputClass}
              />
              <button type="button" onClick={() => trimRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={252} w={361}>
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

            <Box x={20} y={320} w={361}>
              <input
                ref={licensePlateRef}
                value={licensePlate}
                onChange={(event) => setLicensePlate(event.target.value)}
                placeholder="Kennzeichen"
                className={inputClass}
              />
              <button type="button" onClick={() => licensePlateRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={388} w={361}>
              <input
                ref={colorRef}
                value={color}
                onChange={(event) => setColor(event.target.value)}
                placeholder="Farbe"
                className={inputClass}
              />
              <button type="button" onClick={() => colorRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={456} w={361}>
              <input
                ref={seatCountRef}
                value={seatCount}
                onChange={(event) => setSeatCount(event.target.value.replace(/[^\d]/g, ''))}
                placeholder="Beifahreranzahl"
                className={inputClass}
              />
              <button type="button" onClick={() => seatCountRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={524} w={361}>
              <input
                ref={fuelTypeRef}
                value={fuelType}
                onChange={(event) => setFuelType(event.target.value)}
                placeholder="Kraftstoff"
                className={inputClass}
              />
              <button type="button" onClick={() => fuelTypeRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <Box x={20} y={592} w={361}>
              <input
                ref={imageUrlRef}
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                placeholder="Bild URL"
                className={inputClass}
              />
              <button type="button" onClick={() => imageUrlRef.current?.focus()} className="absolute right-3 top-1/2 -translate-y-1/2">
                <img src="/icon/_Icon_Lime/Arrow-kurz_Trisar_Icons_01_Lime.svg" alt="" className="w-[10px] h-[13px]" />
              </button>
            </Box>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={saveVehicle}
              className="absolute left-5 top-[664px] w-[362px] h-14 bg-[#dbee4a] disabled:opacity-70"
            >
              <span className="text-[#0e1008] text-[16px] leading-6 tracking-[0.5px] font-medium">
                {isSubmitting ? 'Speichern ...' : isEditMode ? 'Fahrzeug speichern' : 'Fahrzeug erstellen'}
              </span>
            </button>

            <div className="absolute left-5 top-[736px] w-[362px] min-h-[56px] px-3 py-2 border border-[#7f8a2b] text-[#c8d85d] text-[12px] leading-[1.3]">
              {feedback || (isEditMode ? 'Fahrzeugdaten ändern und speichern.' : 'Fahrzeugdaten eintragen und speichern.')}
            </div>

            <TrisarFooter className="absolute left-0 right-0 top-[833px] h-10 bg-black" />
          </div>
        </div>
      </div>
    </div>
  );
}
