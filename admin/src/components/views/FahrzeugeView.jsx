import { useEffect, useMemo, useState } from 'react';
import BackCircleButton from '../ui/BackCircleButton';
import NaviFooterKomponente from '../navigation/NaviFooterKomponente';
import { supabase, supabaseAdmin } from '../../services/supabase';
import { ColorBadge, EnergyBadge, FuelBadge, SeatBadge, demoFillPercent } from '../../shared/vehicleBadges';
import { useI18n } from '../../i18n';

const VEHICLES_RELOAD_EVENT = 'trisar:admin:vehicles:reload';


// Karosserieform aus Modell/Variante ableiten (die vehicles-Tabelle führt
// keine eigene Spalte dafür) — Basis für den Karosserie-Filter.
const resolveBodyType = (vehicle) => {
  const text = `${vehicle?.brand_model || ''} ${vehicle?.trim || ''}`.toLowerCase();
  if (/\b(ix|x1|x2|x3|x5|x6|x7|xm)\b/.test(text) || text.includes('ix3')) return 'suv';
  if (text.includes('van') || text.includes('tourer') || text.includes('multivan')) return 'van';
  if (text.includes('coup')) return 'coupe';
  return 'limosine';
};

const sortVehicles = (rows, sortKey, sortDesc) => {
  const factor = sortDesc ? -1 : 1;
  const value = (v) => {
    if (sortKey === 'model') return `${v.brand_model} ${v.trim}`.trim().toLowerCase();
    if (sortKey === 'seats') return Number.parseInt(v.seat_count ?? 0, 10) || 0;
    if (sortKey === 'fill') {
      const parsed = Number.parseFloat(v.battery_fuel_percent);
      return Number.isFinite(parsed) ? parsed : demoFillPercent(v.vin);
    }
    return String(v.plate || '').toLowerCase();
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * factor;
    return String(va).localeCompare(String(vb), 'de') * factor;
  });
};

function VehicleCard({ plate, vin, color, imageUrl = '', seatCount = null, fuelType = '', fillPercent = null, fullRangeKm = null, onClick = null, marker }) {
  return (
    <button
      type="button"
      onClick={onClick || undefined}
      data-tutorial={marker}
      className="w-full h-32 relative bg-white overflow-hidden text-left cursor-pointer"
    >
      <div className="absolute z-10 left-0 right-0 top-[10px] text-center">
        <span className="text-[rgba(29,28,29,0.2)] text-xs font-bold font-['Space_Grotesk']">VIN  </span>
        <span className="text-[rgba(29,28,29,0.2)] text-xs tracking-[2px] font-normal font-['Space_Grotesk']">{vin}</span>
      </div>

      {imageUrl ? (
        <img
          src={imageUrl}
          alt={plate}
          className="absolute left-[6px] top-[38px] w-[150px] h-[74px] object-contain"
          onError={(event) => {
            // Bilddatei (noch) nicht vorhanden: grauer Platzhalter statt Broken-Icon.
            event.currentTarget.style.visibility = 'hidden';
            event.currentTarget.parentElement?.querySelector('[data-image-fallback]')?.style.removeProperty('display');
          }}
        />
      ) : null}
      <div
        data-image-fallback
        className="absolute left-[6px] top-[38px] w-[150px] h-[74px] bg-[#ececec] -z-0"
        style={imageUrl ? { display: 'none' } : undefined}
      />

      <div className="absolute left-[170px] top-[38px] text-[#1d1c1d] text-[30px] leading-[32px] font-bold tracking-[-0.5px] font-['Space_Grotesk']">
        {plate}
      </div>

      <div className="absolute left-[170px] top-[76px] flex items-center gap-[6px]">
        <FuelBadge fuelType={fuelType} />
        <ColorBadge color={color} />
        <EnergyBadge fuelType={fuelType} seed={vin} fillPercent={fillPercent} fullRangeKm={fullRangeKm} />
        <SeatBadge seatCount={seatCount} />
      </div>
    </button>
  );
}

export default function FahrzeugeView({ setView, onEditVehicle = null, filters = {}, onChangeFilters = () => {} }) {
  const { t } = useI18n();
  // Suchtext lebt im geteilten Filter-State: er bleibt erhalten, bis er per
  // X-Button (oder "Filter Löschen") geleert wird.
  const searchTerm = String(filters?.search || '');
  const setSearchTerm = (value) => onChangeFilters((prev) => ({ ...(prev || {}), search: value }));
  const [vehicles, setVehicles] = useState([]);
  const [loadingVehicles, setLoadingVehicles] = useState(true);
  const [vehiclesError, setVehiclesError] = useState('');
  const gradientStyle = useMemo(
    () => ({
      background: 'radial-gradient(ellipse 141.42% 102.21% at 0% 0%, #0048cf 0%, #00369b 11.415%, #002468 22.83%, #001b4e 28.537%, #001234 34.244%, #00091a 39.952%, #00050d 42.805%, #000000 45.659%, #000000 83.626%, #000000 100%)',
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

  // Suche über alle Fahrzeugfelder; ";" trennt mehrere Suchbegriffe (ODER),
  // z. B. "ix3;i7" findet beide Baureihen.
  const searchTerms = searchTerm
    .toLowerCase()
    .split(';')
    .map((term) => term.trim())
    .filter(Boolean);

  const vehicleHaystack = (v) => [
    v.plate,
    v.vin,
    v.brand_model,
    v.trim,
    v.color,
    v.fuel_type,
    v.seat_count == null ? '' : `${v.seat_count} sitze`,
    resolveBodyType(v),
  ].join(' ').toLowerCase();
  const activeBodyTypes = [
    filters?.vehicleLimosine ? 'limosine' : null,
    filters?.vehicleSuv ? 'suv' : null,
    filters?.vehicleVan ? 'van' : null,
    filters?.vehicleCoupe ? 'coupe' : null,
  ].filter(Boolean);

  const filteredVehicles = sortVehicles(
    vehicles.filter((v) => {
      if (searchTerms.length > 0) {
        const haystack = vehicleHaystack(v);
        if (!searchTerms.some((term) => haystack.includes(term))) return false;
      }
      // Ohne Auswahl gilt kein Karosserie-Filter (alle Fahrzeuge sichtbar).
      if (activeBodyTypes.length > 0 && !activeBodyTypes.includes(resolveBodyType(v))) return false;
      return true;
    }),
    filters?.sortKey || 'plate',
    Boolean(filters?.sortDesc),
  );

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
      battery_fuel_percent: row?.battery_fuel_percent ?? null,
      range_km: row?.range_km ?? null,
      fuel_type: String(row?.fuel_type || '').trim(),
      image_url: String(row?.image_url || '').trim(),
      plate: String(row?.license_plate || '').trim() || '-',
      brandModel: String(row?.brand_model || '').trim(),
      vinLabel: String(row?.vin || '').trim() || '-',
      imageUrl: String(row?.image_url || '').trim(),
      seatCount: row?.seat_count ?? null,
      batteryFuelPercent: row?.battery_fuel_percent ?? null,
      rangeKm: row?.range_km ?? null,
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
        setVehiclesError(String(error.message || error));
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
      .channel(`admin-vehicles-live-${Date.now()}`)
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
          <div className="relative">
            <BackCircleButton onClick={handleBack} className="mt-0" marker="fahrzeuge-zurueck" />
            <button
              type="button"
              onClick={() => setView('fahrzeugFilter')}
              data-tutorial="fahrzeuge-filter-knopf"
              aria-label={t('filter.filterButton')}
              className="absolute right-0 top-0 w-[50px] h-[50px] flex items-center justify-center"
            >
              <img src="/icon/_Icon_Schwarz/karten-layer-button.svg" alt="" className="w-[50px] h-[50px]" />
            </button>
          </div>

          <h1 data-tutorial="fahrzeuge-liste" className="mt-[30px] text-[#E3F654] text-[42px] leading-[42px] font-bold font-['Space_Grotesk']">
            {t('filter.vehiclesTitle')}
          </h1>

          <button
            type="button"
            onClick={() => setView('fahrzeugErstellen')}
            className="mt-[24px] w-full h-14 bg-[#E3F654] border-2 border-[#E3F654] px-4 flex items-center justify-between"
          >
            <span className="text-[#1d1c1d] text-base font-medium font-['Space_Grotesk'] tracking-wide">{t('filter.createVehicle')}</span>
            <img src="/icon/_Icon_Schwarz/vehicle-car-small.svg" alt="" className="w-6 h-6 object-contain" />
          </button>

          <div className="mt-3 w-full h-14 border-2 border-[#E3F654] px-4 flex items-center justify-between">
            <input
              type="text"
              value={searchTerm}
              data-tutorial="fahrzeuge-suche"
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={t('filter.vehicleSearchPlaceholder')}
              className="flex-1 bg-transparent border-none outline-none text-[#E3F654] text-base font-medium font-['Space_Grotesk'] placeholder:text-[#E3F654]"
            />
            {searchTerm.trim().length > 0 ? (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label={t('filter.resetSearch')}
                className="w-6 h-6 flex items-center justify-center"
              >
                <img src="/icon/_Icon_Green/clear-field-green.svg" alt="" className="w-5 h-5" />
              </button>
            ) : (
              <img src="/icon/_Icon_Schwarz/vehicle-search.svg" alt="" className="w-6 h-6" />
            )}
          </div>

          <div className="mt-[24px] space-y-3">
            {loadingVehicles ? (
              <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">{t('filter.vehiclesLoading')}</div>
            ) : null}
            {!loadingVehicles && vehiclesError ? (
              <div className="bg-[#171717] border border-[#3a3a3a] p-4 whitespace-pre-line text-[#ff8e8e] text-[13px] leading-[1.4] font-medium font-['Space_Grotesk']">
                {t('filter.vehiclesLoadError', { message: vehiclesError })}
              </div>
            ) : null}
            {!loadingVehicles && !vehiclesError && filteredVehicles.length === 0 ? (
              <div className="text-[#E3F654] text-[16px] font-medium font-['Space_Grotesk']">{t('filter.noVehiclesFound')}</div>
            ) : null}
            {filteredVehicles.map((vehicle) => (
              <VehicleCard
                key={vehicle.id}
                marker={`fahrzeug-${vehicle.id}`}
                plate={vehicle.plate}
                vin={vehicle.vinLabel}
                color={vehicle.color}
                imageUrl={vehicle.imageUrl}
                seatCount={vehicle.seatCount}
                fuelType={vehicle.fuel_type}
                fillPercent={vehicle.batteryFuelPercent}
                fullRangeKm={vehicle.rangeKm}
                fillPercent={vehicle.battery_fuel_percent}
                fullRangeKm={vehicle.range_km}
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
        onNavigateToVehicles={() => setView('fahrzeugListe')}
        onNavigateToProfile={() => setView('alleFahrer')}
        onNavigateToAddFahrt={() => setView('fahrtAdd')}
        onNavigateToKi={() => setView('kiAssistent')}
        onNavigateToPlanung={() => setView('kiPlaner')}
        onNavigateToMap={() => setView('karten')}
        activeTab="vehicles"
      />
    </div>
  );
}
