-- Tank und Reichweite am Fahrzeug aus dem OBD-Tracker (18.11.2026).
--
-- Die Energie-Kachel (Web, iOS, Android, Fahrer und Dispo) zeigt vehicles.battery_fuel_percent
-- und rechnet die Restreichweite als Fuellstand x range_km (Reichweite bei vollem Tank).
-- Hat das Fahrzeug einen Tracker, schreibt dieser Trigger beide Felder aus vehicle_telemetry_live:
--   Fuellstand  = fuel_level_pct, sonst oem_fuel_l / tank_l.
--   range_km    = Restreichweite / Fuellstand (Auto oder geschaetzt), sonst tank_l / Verbrauch,
--                 sonst bleibt der Wert aus den Stammdaten.
-- So zeigen alle Apps die echten Werte, ohne dass sich dort etwas aendert.
-- Fahrzeug zum Tracker: obd_tracker.vehicle_id, sonst gleiche Fahrgestellnummer.

alter table public.vehicles
  add column if not exists tank_l numeric check (tank_l is null or tank_l between 5 and 250);

comment on column public.vehicles.tank_l is 'Tankgroesse in Litern (Dispo), fuer den Fuellstand aus OBD-Litern.';

create or replace function public.trisar_energie_werte(t public.vehicle_telemetry_live, p_tank numeric,
                                                       out pct integer, out voll integer)
language plpgsql immutable as $function$
declare
  rest numeric;
begin
  pct := case
    when t.fuel_level_pct between 0 and 100 then t.fuel_level_pct
    when t.oem_fuel_l >= 0 and p_tank > 0 then least(100, greatest(0, round(t.oem_fuel_l / p_tank * 100)))::integer
  end;
  if pct is null then
    return;
  end if;
  rest := coalesce(t.oem_remaining_distance_km, t.geschaetzte_reichweite_km);
  voll := case
    when rest > 0 and pct >= 5 then round(rest * 100 / pct)::integer
    when t.verbrauch_l_100km > 0 and p_tank > 0 then round(p_tank / t.verbrauch_l_100km * 100)::integer
  end;
end
$function$;

create or replace function public.trisar_fahrzeug_zum_tracker(p_imei text, p_vin text)
returns uuid
language sql stable security definer set search_path = public as $function$
  select coalesce(
    (select vehicle_id from public.obd_tracker where imei = p_imei and vehicle_id is not null),
    (select id from public.vehicles
      where coalesce(trim(p_vin), '') <> '' and upper(trim(vin)) = upper(trim(p_vin))
      order by created_at limit 1)
  )
$function$;

-- Neue Tracker-Werte: Fahrzeug nachziehen (nur wenn sich etwas aendert).
create or replace function public.trisar_fahrzeug_energie_aus_obd()
returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  vid uuid;
  tank numeric;
  w record;
begin
  vid := public.trisar_fahrzeug_zum_tracker(new.imei, new.vin);
  if vid is null then
    return null;
  end if;
  select tank_l into tank from public.vehicles where id = vid;
  select * into w from public.trisar_energie_werte(new, tank);
  if w.pct is null then
    return null;
  end if;
  update public.vehicles
     set battery_fuel_percent = w.pct,
         range_km = coalesce(w.voll, range_km)
   where id = vid
     and (battery_fuel_percent is distinct from w.pct
          or (w.voll is not null and range_km is distinct from w.voll));
  return null;
end
$function$;

drop trigger if exists trg_fahrzeug_energie_aus_obd on public.vehicle_telemetry_live;
create trigger trg_fahrzeug_energie_aus_obd
  after insert or update on public.vehicle_telemetry_live
  for each row execute function public.trisar_fahrzeug_energie_aus_obd();

-- Tankgroesse geaendert: sofort mit den letzten Tracker-Werten neu rechnen.
create or replace function public.trisar_fahrzeug_tank_geaendert()
returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  t public.vehicle_telemetry_live;
  w record;
begin
  select l.* into t
    from public.vehicle_telemetry_live l
   where public.trisar_fahrzeug_zum_tracker(l.imei, l.vin) = new.id
   order by l.captured_at desc nulls last
   limit 1;
  if t.imei is null then
    return new;
  end if;
  select * into w from public.trisar_energie_werte(t, new.tank_l);
  if w.pct is not null then
    new.battery_fuel_percent := w.pct;
    new.range_km := coalesce(w.voll, new.range_km);
  end if;
  return new;
end
$function$;

drop trigger if exists trg_fahrzeug_tank on public.vehicles;
create trigger trg_fahrzeug_tank
  before update of tank_l on public.vehicles
  for each row when (old.tank_l is distinct from new.tank_l)
  execute function public.trisar_fahrzeug_tank_geaendert();

revoke all on function public.trisar_fahrzeug_zum_tracker(text, text) from public, anon, authenticated;
