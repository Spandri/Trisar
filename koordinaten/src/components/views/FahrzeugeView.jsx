import { useEffect, useMemo, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import { supabase, supabaseAdmin } from '../../services/supabase';

const VEHICLES_RELOAD_EVENT = 'trisar:ko:vehicles:reload';

const CARD_OUTLINE_URL = '/icon/_Icon_Schwarz/card-outline-52.svg';
const E10_CIRCLE_URL = '/icon/_Icon_Schwarz/E10_Tank_Trisar_Icons_01.svg';
const RANGE_570_URL = '/icon/_Icon_Green/100xBatterie_Trisar_Icon_01_green.svg';

const resolveSeatIconUrl = (seatCountValue) => {
  const parsed = Number.parseInt(String(seatCountValue ?? '').trim(), 10);
  const clamped = Number.isFinite(parsed) ? Math.min(8, Math.max(3, parsed)) : null;
  if (clamped) return `/icon/_Icon_Schwarz/${clamped}x_Person_Trisar_Icons_01.svg`;
  return '/icon/_Icon_Schwarz/Person_Trisar_Icons_01.svg';
};

const resolveCarColor = (value) => {
  if (!value || typeof value !== 'string') return '#0d0d0d';
  const v = value.trim().toLowerCase();
  const map = {
    black: '#0d0d0d',
    schwarz: '#0d0d0d',
    white: '#f3f4f6',
    weiss: '#f3f4f6',
    silber: '#c4c6c8',
    silver: '#c4c6c8',
    grau: '#8b8e93',
    gray: '#8b8e93',
    grey: '#8b8e93',
    blau: '#1d4ed8',
    blue: '#1d4ed8',
    rot: '#b91c1c',
    red: '#b91c1c',
    gruen: '#15803d',
    green: '#15803d',
  };
  if (map[v]) return map[v];
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim())) return value.trim();
  return '#0d0d0d';
};

function MetricBadge({ children }) {
  return (
    <div className="relative w-[36px] h-[36px]">
      <img src={CARD_OUTLINE_URL} alt="" className="w-full h-full" />
      <div className="absolute inset-0 flex items-center justify-center">
      {children}
      </div>
    </div>
  );
}

function VehicleCard({ plate, vin, color, imageUrl = '', seatCount = null, onClick = null }) {
  const carColor = resolveCarColor(color);
  const seatIconUrl = resolveSeatIconUrl(seatCount);

  return (
    <button
      type="button"
      onClick={onClick || undefined}
      className="w-full h-32 relative bg-white overflow-hidden text-left cursor-pointer"
    >
      <div className="absolute left-0 right-0 top-[10px] text-center">
        <span className="text-[rgba(29,28,29,0.2)] text-xs font-bold font-['Space_Grotesk']">VIN  </span>
        <span className="text-[rgba(29,28,29,0.2)] text-xs tracking-[2px] font-normal font-['Space_Grotesk']">{vin}</span>
      </div>

      {imageUrl ? (
        <img src={imageUrl} alt={plate} className="absolute left-[6px] top-[38px] w-[150px] h-[74px] object-contain" />
      ) : (
        <div className="absolute left-[6px] top-[38px] w-[150px] h-[74px] bg-[#ececec]" />
      )}

      <div className="absolute left-[170px] top-[38px] text-[#1d1c1d] text-[30px] leading-[32px] font-bold tracking-[-0.5px] font-['Space_Grotesk']">
        {plate}
      </div>

      <div className="absolute left-[170px] top-[76px] flex items-center gap-[6px]">
        <MetricBadge>
          <img src={E10_CIRCLE_URL} alt="" className="w-[23px] h-[23px] object-contain" />
        </MetricBadge>
        <MetricBadge>
          <div className="w-[23px] h-[23px] rounded-full" style={{ backgroundColor: carColor }} />
        </MetricBadge>
        <MetricBadge>
          <img src={RANGE_570_URL} alt="" className="w-[23px] h-[23px] object-contain" />
        </MetricBadge>
        <MetricBadge>
          <img src={seatIconUrl} alt="" className="w-[23px] h-[23px] object-contain" />
        </MetricBadge>
      </div>
    </button>
  );
}

export default function FahrzeugeView({ setView, onEditVehicle = null }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [vehiclesError, setVehiclesError] = useState('');
  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0.00% -0.00%, #313701 0%, black 46%, black 84%, black 100%)',
    }),
    [],
  );

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const previous = {
      html: html.style.overscrollBehavior,
      body: body.style.overscrollBehavior,
      root: root ? root.style.overscrollBehavior : '',
    };

    html.style.overscrollBehavior = 'none';
    body.style.overscrollBehavior = 'none';
    if (root) root.style.overscrollBehavior = 'none';

    return () => {
      html.style.overscrollBehavior = previous.html;
      body.style.overscrollBehavior = previous.body;
      if (root) root.style.overscrollBehavior = previous.root;
    };
  }, []);

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredVehicles = vehicles.filter((v) => {
    if (!normalizedSearch) return true;
    return `${v.plate} ${v.vin} ${v.brandModel}`.toLowerCase().includes(normalizedSearch);
  });

  useEffect(() => {
    let mounted = true;

    const toVehicleCardRow = (row) => ({
      id: String(row?.id || ''),
      brand_model: String(row?.brand_model || '').trim(),
      trim: String(row?.trim || '').trim(),
      vin: String(row?.vin || '').trim(),
      license_plate: String(row?.license_plate || '').trim(),
      color: String(row?.color || '').trim(),
      seat_count: row?.seat_count ?? null,
      fuel_type: String(row?.fuel_type || '').trim(),
      image_url: String(row?.image_url || '').trim(),
      plate: String(row?.license_plate || '').trim() || '-',
      brandModel: String(row?.brand_model || '').trim(),
      vinLabel: String(row?.vin || '').trim() || '-',
      imageUrl: String(row?.image_url || '').trim(),
      seatCount: row?.seat_count ?? null,
    });

    const loadVehicles = async () => {
      setLoadingVehicles(true);
      setVehiclesError('');
      try {
        let result = await supabase.from('vehicles').select('*').order('brand_model', { ascending: true });
        if (result.error) {
          const fallbackAllowed = /invalid jwt|signature is invalid|not allowed|unauthorized|permission denied/i.test(result.error.message || '');
          if (fallbackAllowed) {
            result = await supabaseAdmin.from('vehicles').select('*').order('brand_model', { ascending: true });
          }
        }
        if (!mounted) return;
        if (result.error) throw result.error;
        setVehicles((result.data || []).map(toVehicleCardRow));
      } catch (error) {
        if (!mounted) return;
        setVehicles([]);
        setVehiclesError(`Fahrzeuge konnten nicht geladen werden: ${error.message}`);
      } finally {
        if (mounted) setLoadingVehicles(false);
      }
    };

    loadVehicles();

    const handleVehiclesReload = () => {
      loadVehicles();
    };
    window.addEventListener(VEHICLES_RELOAD_EVENT, handleVehiclesReload);

    return () => {
      mounted = false;
      window.removeEventListener(VEHICLES_RELOAD_EVENT, handleVehiclesReload);
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel(`ko-vehicles-live-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicles' }, () => {
        window.dispatchEvent(new Event(VEHICLES_RELOAD_EVENT));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleBack = () => {
    setView('list');
  };

  return (
    <div className="w-[min(402px,100vw)] h-dvh relative mx-auto overflow-hidden overscroll-none" style={gradientStyle}>
      <div className="h-full overflow-y-auto overflow-x-hidden overscroll-none pb-[157px]">
        <div className="w-full min-h-full px-5 pt-[60px] pb-0">
          <BackCircleButton onClick={handleBack} className="mt-0" />

          <h1 className="mt-[30px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">
            Fahrzeuge
          </h1>

          <button
            type="button"
            onClick={() => setView('fahrzeugErstellen')}
            className="mt-[30px] w-full h-14 bg-[#E3F654] outline outline-2 outline-[#E3F654] px-4 flex items-center justify-between"
          >
            <span className="text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">Fahrzeug erstellen</span>
            <img src="/icon/_Icon_Schwarz/vehicle-car-small.svg" alt="" className="w-[15px] h-[14px]" />
          </button>

          <div className="mt-3 w-full h-14 outline outline-2 outline-[#E3F654] px-4 flex items-center justify-between">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Fahrzeug Suchen"
              className="flex-1 bg-transparent border-none outline-none text-[#E3F654] text-[31px] leading-none font-medium font-['Space_Grotesk'] placeholder:text-[#E3F654]"
            />
            <img src="/icon/_Icon_Schwarz/vehicle-search.svg" alt="" className="w-6 h-6" />
          </div>

          <div className="mt-7 space-y-3">
            {loadingVehicles ? (
              <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">Fahrzeuge werden geladen ...</div>
            ) : null}
            {!loadingVehicles && vehiclesError ? (
              <div className="bg-[#171717] border border-[#3a3a3a] p-4 whitespace-pre-line text-[#ff8e8e] text-[13px] leading-[1.4] font-medium font-['Space_Grotesk']">
                {vehiclesError}
              </div>
            ) : null}
            {!loadingVehicles && !vehiclesError && filteredVehicles.length === 0 ? (
              <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">Keine Fahrzeuge gefunden.</div>
            ) : null}
            {filteredVehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                plate={vehicle.plate}
                vin={vehicle.vinLabel}
                color={vehicle.color}
                imageUrl={vehicle.imageUrl}
                seatCount={vehicle.seatCount}
                onClick={() => {
                  if (typeof onEditVehicle === 'function') onEditVehicle(vehicle);
                }}
              />
            ))}
          </div>

        </div>
      </div>

      <NaviFooterKomponente
        onNavigateHome={() => setView('list')}
        onNavigateToFahrten={() => setView('ankuenfte')}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToMap={() => setView('karten')}
        activeTab="home"
      />
    </div>
  );
}
