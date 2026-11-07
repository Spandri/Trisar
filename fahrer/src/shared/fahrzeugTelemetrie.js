import { useEffect, useState } from 'react';

// Gemeinsame Logik fuer die Fahrzeugdaten aus dem OBD-Tracker (vehicle_telemetry_live
// und vehicle_telemetry_events). Identische Kopie in der Fahrer-App.

const zeitKurz = (iso) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
};

export const EVENT_KEYS = {
  ignition_on: 'telemetrie.ev.ignition_on',
  ignition_off: 'telemetrie.ev.ignition_off',
  trip_start: 'telemetrie.ev.trip_start',
  trip_end: 'telemetrie.ev.trip_end',
  idling_start: 'telemetrie.ev.idling_start',
  idling_end: 'telemetrie.ev.idling_end',
  unplugged: 'telemetrie.ev.unplugged',
  plugged_in: 'telemetrie.ev.plugged_in',
  harsh_acceleration: 'telemetrie.ev.harsh_acceleration',
  harsh_braking: 'telemetrie.ev.harsh_braking',
  harsh_cornering: 'telemetrie.ev.harsh_cornering',
  overspeeding: 'telemetrie.ev.overspeeding',
  crash: 'telemetrie.ev.crash',
  towing: 'telemetrie.ev.towing',
  jamming: 'telemetrie.ev.jamming',
  alarm: 'telemetrie.ev.alarm',
};

// Laedt den letzten Stand und die juengsten Ereignisse eines Fahrers und haelt
// beides per Realtime aktuell (Rueckfall: alle 30 s neu laden).
export const useFahrzeugTelemetrie = (supabase, driverId, { eventLimit = 3 } = {}) => {
  const [live, setLive] = useState(null);
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!supabase || !driverId) { setLive(null); setEvents([]); return undefined; }
    let aktiv = true;
    const laden = async () => {
      const [liveRes, evRes] = await Promise.all([
        supabase.from('vehicle_telemetry_live').select('*').eq('driver_id', driverId).maybeSingle(),
        supabase.from('vehicle_telemetry_events').select('id, event_type, value, captured_at')
          .eq('driver_id', driverId).order('captured_at', { ascending: false }).limit(eventLimit),
      ]);
      if (!aktiv) return;
      if (!liveRes.error) setLive(liveRes.data ? { ...liveRes.data, zeit: zeitKurz(liveRes.data.captured_at) } : null);
      if (!evRes.error) setEvents((evRes.data || []).map((e) => ({ ...e, zeit: zeitKurz(e.captured_at) })));
    };
    laden();
    const kanal = supabase
      .channel(`fahrzeug-telemetrie-${driverId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vehicle_telemetry_live', filter: `driver_id=eq.${driverId}` }, laden)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'vehicle_telemetry_events', filter: `driver_id=eq.${driverId}` }, laden)
      .subscribe();
    const timer = window.setInterval(laden, 30_000);
    return () => {
      aktiv = false;
      window.clearInterval(timer);
      supabase.removeChannel(kanal);
    };
  }, [supabase, driverId, eventLimit]);

  return { live, events };
};

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dezimal = (v) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

// Anzeigezeilen aus dem letzten Stand. Nur Felder, die das Fahrzeug liefert.
export const telemetrieZeilen = (live, t) => {
  if (!live) return [];
  const zeilen = [];
  if (typeof live.ignition === 'boolean') {
    zeilen.push({ key: 'ignition', label: t('telemetrie.ignition'), value: t(live.ignition ? 'telemetrie.on' : 'telemetrie.off') });
  }
  const rpm = num(live.rpm);
  if (rpm !== null) zeilen.push({ key: 'rpm', label: t('telemetrie.rpm'), value: `${Math.round(rpm)}` });
  const speed = num(live.obd_speed_kph);
  if (speed !== null) zeilen.push({ key: 'speed', label: t('telemetrie.speed'), value: `${Math.round(speed)} km/h` });
  const fuel = num(live.fuel_level_pct);
  if (fuel !== null) zeilen.push({ key: 'fuel', label: t('telemetrie.fuel'), value: `${Math.round(fuel)} %`, warn: fuel < 15 });
  const oemFuel = num(live.oem_fuel_l);
  if (fuel === null && oemFuel !== null) zeilen.push({ key: 'fuel', label: t('telemetrie.fuel'), value: `${dezimal(oemFuel)} l` });
  const reichweite = num(live.oem_remaining_distance_km);
  if (reichweite !== null) zeilen.push({ key: 'range', label: t('telemetrie.range'), value: `${Math.round(reichweite).toLocaleString('de-DE')} km`, warn: reichweite < 50 });
  const coolant = num(live.coolant_c);
  if (coolant !== null) zeilen.push({ key: 'coolant', label: t('telemetrie.coolant'), value: `${Math.round(coolant)} °C`, warn: coolant > 110 });
  const volt = num(live.ext_voltage_v);
  if (volt !== null) zeilen.push({ key: 'voltage', label: t('telemetrie.voltage'), value: `${dezimal(volt)} V`, warn: volt > 0 && volt < 11.8 });
  const km = num(live.oem_mileage_km) ?? num(live.total_odometer_km);
  if (km !== null) zeilen.push({ key: 'odometer', label: t('telemetrie.odometer'), value: `${Math.round(km).toLocaleString('de-DE')} km` });
  const dtc = num(live.dtc_count);
  if (dtc !== null) zeilen.push({ key: 'dtc', label: t('telemetrie.dtc'), value: `${dtc}`, warn: dtc > 0 });
  const load = num(live.engine_load_pct);
  if (load !== null) zeilen.push({ key: 'load', label: t('telemetrie.load'), value: `${Math.round(load)} %` });
  const gsm = num(live.gsm_signal);
  if (gsm !== null) zeilen.push({ key: 'gsm', label: t('telemetrie.gsm'), value: `${gsm}/5` });
  return zeilen;
};
