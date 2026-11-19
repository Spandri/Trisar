-- Modellvarianten mit Tank und Verbrauch (18.11.2026).
--
-- Jede Variante (Modell + Motorisierung + Baujahre) hat Tankgroesse und WLTP-Verbrauch
-- (bei Elektro nutzbare Akkukapazitaet und kWh/100 km). Quelle je Zeile, meist ADAC-Autokatalog.
-- Die Dispo waehlt am Fahrzeug die Variante (vehicles.variante_id).
-- Verbrauch der Variante gilt, bis TRISAR ihn selbst gelernt hat (fahrzeug_verbrauch, ab 50 km).
-- Ohne Variante und ohne gelernten Verbrauch bleibt die Reichweite leer, die Apps zeigen dann einen Strich.
-- vehicles.tank_l bleibt als Ausnahme fuer ein einzelnes Auto (z. B. Grosstank), sonst gilt die Variante.

create table if not exists public.fahrzeug_varianten (
  id uuid primary key default gen_random_uuid(),
  modell text not null,
  variante text not null,
  generation text not null default '',
  kraftstoff text,
  tank_l numeric check (tank_l is null or tank_l between 5 and 250),
  verbrauch_l_100km numeric check (verbrauch_l_100km is null or verbrauch_l_100km between 1 and 40),
  akku_kwh numeric check (akku_kwh is null or akku_kwh between 5 and 250),
  verbrauch_kwh_100km numeric check (verbrauch_kwh_100km is null or verbrauch_kwh_100km between 5 and 60),
  quelle text,
  erstellt timestamptz not null default now(),
  unique (modell, variante, generation)
);
alter table public.fahrzeug_varianten enable row level security;
drop policy if exists "alle_lesen" on public.fahrzeug_varianten;
create policy "alle_lesen" on public.fahrzeug_varianten for select to authenticated using (true);
drop policy if exists "dispo_schreiben" on public.fahrzeug_varianten;
create policy "dispo_schreiben" on public.fahrzeug_varianten for all to authenticated
  using (public.ist_dispo()) with check (public.ist_dispo());
grant select on public.fahrzeug_varianten to authenticated;
grant insert, update, delete on public.fahrzeug_varianten to authenticated;

alter table public.vehicles
  add column if not exists variante_id uuid references public.fahrzeug_varianten(id) on delete set null;

insert into public.fahrzeug_varianten
  (modell, variante, generation, kraftstoff, tank_l, verbrauch_l_100km, akku_kwh, verbrauch_kwh_100km, quelle)
values
  ('Audi A6 Limousine', '40 TDI', 'C8 08/20-06/23', 'Diesel B7', 63, 5.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8/315570/'),
  ('Audi A6 Limousine', '45 TDI quattro', 'C8 08/20-06/23', 'Diesel B7', 63, 6.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8/318388/'),
  ('Audi A6 Limousine', '50 TDI quattro', 'C8 08/20-06/23', 'Diesel B7', 63, 6.7, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8/316764/'),
  ('Audi A6 Limousine', '45 TFSI quattro', 'C8 08/20-06/23', 'Super 95', 63, 7.5, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8/314358/'),
  ('Audi A6 Limousine', '55 TFSI quattro', 'C8 08/20-06/23', 'Super 95', 63, 8.0, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8/314363/'),
  ('Audi A6 Limousine', '40 TFSI', 'C8 2020-2023', 'Super 95', null, null, null, null, 'nicht im ADAC-Katalog fuer DE-Limousine 2020+'),
  ('Audi A6 Limousine', '40 TDI', 'C8 Facelift 2023-2025', 'Diesel B7', 63, 5.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/331020/'),
  ('Audi A6 Limousine', '40 TDI quattro', 'C8 Facelift 2023-2025', 'Diesel B7', 63, 5.5, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/331021/'),
  ('Audi A6 Limousine', '45 TDI quattro', 'C8 Facelift 2023-2025', 'Diesel B7', 63, 6.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/329895/'),
  ('Audi A6 Limousine', '50 TDI quattro', 'C8 Facelift 2023-2025', 'Diesel B7', 63, 6.4, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/329896/'),
  ('Audi A6 Limousine', '45 TFSI', 'C8 Facelift 2023-2025', 'Super 95', 63, 7.1, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/329916/'),
  ('Audi A6 Limousine', '45 TFSI quattro', 'C8 Facelift 2023-2025', 'Super 95', 63, 7.5, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/329917/'),
  ('Audi A6 Limousine', '55 TFSI quattro', 'C8 Facelift 2023-2025', 'Super 95', 63, 8.1, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/329892/'),
  ('Audi A6 Limousine', '50 TFSI e quattro (PHEV)', 'C8 Facelift 2023-2024', 'Plug-in-Hybrid', 52, 7.3, 14.4, 19.0, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/329317/'),
  ('Audi A6 Limousine', '55 TFSI e quattro (PHEV)', 'C8 Facelift 2023-2025', 'Plug-in-Hybrid', 52, 7.3, 14.4, 19.2, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/c8-facelift/329320/'),
  ('Audi A6 Limousine', 'TFSI (2.0 150 kW)', 'C9 ab 07/25', 'Super 95', 56, 7.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/gh-c9/340064/'),
  ('Audi A6 Limousine', 'TFSI quattro (2.0 MHEV plus 200 kW)', 'C9 ab 07/26', 'Super 95', 56, 6.6, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/gh-c9/351824/'),
  ('Audi A6 Limousine', 'TFSI quattro (3.0 V6 MHEV plus 270 kW)', 'C9 ab 07/25', 'Super 95', 56, 7.0, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/gh-c9/340066/'),
  ('Audi A6 Limousine', 'TDI (2.0 MHEV plus 150 kW)', 'C9 ab 07/25', 'Diesel B7', 60, 5.1, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/gh-c9/340068/'),
  ('Audi A6 Limousine', 'TDI quattro (3.0 MHEV plus 220 kW)', 'C9 ab 11/25', 'Diesel B7', 60, 5.7, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/gh-c9/347497/'),
  ('Audi A6 Limousine', 'e-hybrid quattro (270 kW PHEV)', 'C9 ab 07/25', 'Plug-in-Hybrid', 46, 6.8, 20.7, 15.9, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6/gh-c9/340286/'),
  ('Audi A6 Sportback e-tron', 'e-tron performance', 'ab 09/24', 'Elektro', null, null, 94.9, 13.9, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6-e-tron/gh/336506'),
  ('Audi A6 Sportback e-tron', 'e-tron quattro', 'ab 10/24', 'Elektro', null, null, 94.9, 14.7, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/audi/a6-e-tron/gh/337363'),
  ('BMW X7', 'xDrive30d', 'G07 08/19-05/20', 'Diesel B7', 80, 8.2, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/bmw/x7/g07/300146/'),
  ('BMW X7', 'M50d', 'G07 08/19-09/20', 'Diesel B7', 80, 9.0, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/bmw/x7/g07/300149'),
  ('BMW X7', 'xDrive40d', 'G07 08/20-06/22', 'Diesel B7', 80, 7.7, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/bmw/x7/g07/312592'),
  ('BMW X7', 'xDrive40i', 'G07 12/20-06/22', 'Super Plus', 83, 10.1, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/bmw/x7/g07/316030/'),
  ('BMW X7', 'M50i', 'G07 12/20-06/22', 'Super Plus', 83, 12.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/bmw/x7/g07/316033/'),
  ('BMW X7', 'xDrive40d', 'G07 LCI ab 08/22', 'Diesel B7', 80, 8.0, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/bmw/x7/g07-facelift/329558/ + https://newsroom.bmwgroup.com/global/de/der-neue-bmw-x7'),
  ('BMW X7', 'xDrive40i', 'G07 LCI ab 08/22', 'Super Plus', 83, 9.6, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/bmw/x7/g07-facelift/329556/ + https://newsroom.bmwgroup.com/global/de/der-neue-bmw-x7'),
  ('BMW X7', 'M60i', 'G07 LCI ab 08/22', 'Super Plus', 83, 12.1, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/bmw/x7/g07-facelift/329560/ + https://newsroom.bmwgroup.com/global/de/der-neue-bmw-x7'),
  ('Mercedes-Benz V-Klasse', 'V 220 d', '447 FL1 lang 03/21-01/24', 'Diesel B7', 57, 7.1, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift/320569/'),
  ('Mercedes-Benz V-Klasse', 'V 220 d 4MATIC', '447 FL1 lang 03/21-01/24', 'Diesel B7', 57, 7.9, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift/320577/'),
  ('Mercedes-Benz V-Klasse', 'V 250 d', '447 FL1 lang 03/21-01/24', 'Diesel B7', 57, 7.4, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift/320570/'),
  ('Mercedes-Benz V-Klasse', 'V 300 d', '447 FL1 lang 02/21-01/24', 'Diesel B7', 57, 7.4, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift/320571/'),
  ('Mercedes-Benz V-Klasse', 'V 300 d 4MATIC', '447 FL1 lang 02/21-01/24', 'Diesel B7', 57, 8.0, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift/320579/'),
  ('Mercedes-Benz V-Klasse', 'V 220 d', '447 FL2 lang ab 01/24', 'Diesel B7', 57, 7.1, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift-2/331880/'),
  ('Mercedes-Benz V-Klasse', 'V 220 d 4MATIC', '447 FL2 lang ab 01/24', 'Diesel B7', 70, 7.7, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift-2/339461/'),
  ('Mercedes-Benz V-Klasse', 'V 250 d', '447 FL2 lang ab 01/24', 'Diesel B7', 57, 7.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift-2/331883/'),
  ('Mercedes-Benz V-Klasse', 'V 250 d 4MATIC', '447 FL2 lang ab 01/24', 'Diesel B7', 70, 7.8, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift-2/331895/'),
  ('Mercedes-Benz V-Klasse', 'V 300 d', '447 FL2 lang ab 01/24', 'Diesel B7', 70, 7.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift-2/331917/'),
  ('Mercedes-Benz V-Klasse', 'V 300 d 4MATIC', '447 FL2 lang ab 01/24', 'Diesel B7', 70, 7.8, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift-2/331919/'),
  ('Mercedes-Benz V-Klasse', 'V 300 (Benziner)', '447 FL2 lang 05/24-06/25', 'Super 95', 70, 10.0, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/v-klasse/447-facelift-2/336115/'),
  ('Mercedes-Benz EQV', 'EQV 300', '447 lang 10/20-01/24', 'Elektro', null, null, 90, 28.1, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/eqv/447/312346/'),
  ('Mercedes-Benz EQV', 'EQV 300', '447 FL lang 01/24-07/26', 'Elektro', null, null, 90, 27.2, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/eqv/447-facelift/331872/'),
  ('Mercedes-Benz Sprinter Tourer', '316 CDI', '907 ab 02/24', 'Diesel B7', null, null, null, null, 'nicht belegt (kein ADAC-Eintrag Tourer 907 316 CDI gefunden)'),
  ('Mercedes-Benz Sprinter Tourer', '317 CDI', '907 Normaldach 02/24-03/25', 'Diesel B7', 71, 10.8, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/sprinter/907-910/332451/'),
  ('Mercedes-Benz Sprinter Tourer', '319 CDI', '907 Hochdach ab 03/25', 'Diesel B7', 71, 12.3, null, null, 'https://www.adac.de/rund-ums-fahrzeug/autokatalog/marken-modelle/mercedes-benz/sprinter/907-910/339532/')
on conflict (modell, variante, generation) do update
  set kraftstoff = excluded.kraftstoff, tank_l = excluded.tank_l, verbrauch_l_100km = excluded.verbrauch_l_100km,
      akku_kwh = excluded.akku_kwh, verbrauch_kwh_100km = excluded.verbrauch_kwh_100km, quelle = excluded.quelle;

-- Werte der Variante fuer ein Fahrzeug (Tank: eigener Wert vor Variante).
create or replace function public.trisar_fahrzeug_variante(p_vehicle uuid,
  out tank numeric, out verbrauch numeric, out akku numeric, out kwh numeric)
language sql stable security definer set search_path = public as $function$
  select coalesce(v.tank_l, w.tank_l), w.verbrauch_l_100km, w.akku_kwh, w.verbrauch_kwh_100km
    from public.vehicles v left join public.fahrzeug_varianten w on w.id = v.variante_id
   where v.id = p_vehicle
$function$;

-- Fuellstand und Reichweite bei vollem Tank aus Tracker-Werten und Variante.
drop function if exists public.trisar_energie_werte(public.vehicle_telemetry_live, numeric);
create or replace function public.trisar_energie_werte(t public.vehicle_telemetry_live, p_tank numeric,
  p_verbrauch numeric, p_akku numeric, p_kwh numeric, out pct integer, out voll integer)
language plpgsql immutable as $function$
declare
  rest numeric;
  v numeric := coalesce(t.verbrauch_l_100km, p_verbrauch);
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
    when v > 0 and p_tank > 0 then round(p_tank / v * 100)::integer
    when p_kwh > 0 and p_akku > 0 then round(p_akku / p_kwh * 100)::integer
  end;
end
$function$;

create or replace function public.trisar_fahrzeug_energie_aus_obd()
returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  vid uuid;
  d record;
  w record;
begin
  vid := public.trisar_fahrzeug_zum_tracker(new.imei, new.vin);
  if vid is null then
    return null;
  end if;
  select * into d from public.trisar_fahrzeug_variante(vid);
  select * into w from public.trisar_energie_werte(new, d.tank, d.verbrauch, d.akku, d.kwh);
  if w.pct is null then
    return null;
  end if;
  update public.vehicles
     set battery_fuel_percent = w.pct,
         range_km = w.voll
   where id = vid
     and (battery_fuel_percent is distinct from w.pct or range_km is distinct from w.voll);
  return null;
end
$function$;

-- Variante oder eigener Tank geaendert: sofort neu rechnen (mit den letzten Tracker-Werten,
-- ohne Tracker nur die Reichweite bei vollem Tank aus der Variante).
create or replace function public.trisar_fahrzeug_tank_geaendert()
returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  t public.vehicle_telemetry_live;
  w record;
  tank numeric;
  verbrauch numeric;
  akku numeric;
  kwh numeric;
begin
  select coalesce(new.tank_l, f.tank_l), f.verbrauch_l_100km, f.akku_kwh, f.verbrauch_kwh_100km
    into tank, verbrauch, akku, kwh
    from (select 1) x left join public.fahrzeug_varianten f on f.id = new.variante_id;
  if new.variante_id is not null and coalesce(trim(new.fuel_type), '') = '' then
    new.fuel_type := (select kraftstoff from public.fahrzeug_varianten where id = new.variante_id);
  end if;
  select l.* into t
    from public.vehicle_telemetry_live l
   where public.trisar_fahrzeug_zum_tracker(l.imei, l.vin) = new.id
   order by l.captured_at desc nulls last
   limit 1;
  if t.imei is not null then
    select * into w from public.trisar_energie_werte(t, tank, verbrauch, akku, kwh);
    if w.pct is not null then
      new.battery_fuel_percent := w.pct;
      new.range_km := w.voll;
      return new;
    end if;
  end if;
  new.range_km := case
    when verbrauch > 0 and tank > 0 then round(tank / verbrauch * 100)::integer
    when kwh > 0 and akku > 0 then round(akku / kwh * 100)::integer
    else new.range_km
  end;
  return new;
end
$function$;

drop trigger if exists trg_fahrzeug_tank on public.vehicles;
create trigger trg_fahrzeug_tank
  before insert or update of tank_l, variante_id on public.vehicles
  for each row execute function public.trisar_fahrzeug_tank_geaendert();

-- Geschaetzte Reichweite: Verbrauch der Variante gilt, bis selbst gelernt (sonst wie 20261112020000).
create or replace function public.fahrzeug_reichweite_schaetzen()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v public.fahrzeug_verbrauch;
  km numeric;
  l numeric;
  dkm numeric;
  dl numeric;
  skm numeric;
  sl numeric;
  verbrauch numeric;
begin
  km := coalesce(new.oem_mileage_km, new.total_odometer_km);
  l := new.oem_fuel_l;
  if new.imei is null or km is null or l is null then
    new.verbrauch_l_100km := null;
    new.geschaetzte_reichweite_km := null;
    return new;
  end if;

  select * into v from public.fahrzeug_verbrauch where imei = new.imei for update;
  if not found then
    insert into public.fahrzeug_verbrauch (imei, vin, ref_km, ref_l) values (new.imei, new.vin, km, l);
    verbrauch := null;
  elsif new.vin is not null and v.vin is not null and new.vin <> v.vin then
    -- Tracker steckt in einem anderen Auto: alles vergessen.
    update public.fahrzeug_verbrauch
      set vin = new.vin, ref_km = km, ref_l = l, summe_km = 0, summe_l = 0, l_100km = null, updated_at = now()
      where imei = new.imei;
    verbrauch := null;
  else
    dkm := km - v.ref_km;
    dl := v.ref_l - l;
    verbrauch := v.l_100km;
    if dkm < 0 or dkm > 2000 then
      -- Tacho zurueck oder riesiger Sprung: anderes Auto, neu lernen.
      update public.fahrzeug_verbrauch
        set vin = coalesce(new.vin, vin), ref_km = km, ref_l = l, summe_km = 0, summe_l = 0, l_100km = null, updated_at = now()
        where imei = new.imei;
      verbrauch := null;
    elsif dl < -3 then
      -- Getankt: ab hier neu messen, Gelerntes bleibt.
      update public.fahrzeug_verbrauch
        set vin = coalesce(new.vin, vin), ref_km = km, ref_l = l, updated_at = now()
        where imei = new.imei;
    elsif dkm >= 30 then
      if dl > 0 and dl / dkm * 100 between 2 and 40 then
        skm := v.summe_km + dkm;
        sl := v.summe_l + dl;
        -- Gleitend: hoechstens die letzten 1000 km zaehlen.
        if skm > 1000 then
          sl := sl * 1000 / skm;
          skm := 1000;
        end if;
        verbrauch := case when skm >= 50 then round(sl / skm * 100, 1) end;
        update public.fahrzeug_verbrauch
          set vin = coalesce(new.vin, vin), ref_km = km, ref_l = l, summe_km = skm, summe_l = sl,
              l_100km = verbrauch, updated_at = now()
          where imei = new.imei;
      else
        -- Unplausibel (Tankanzeige springt): Strecke verwerfen.
        update public.fahrzeug_verbrauch
          set ref_km = km, ref_l = l, updated_at = now()
          where imei = new.imei;
      end if;
    end if;
  end if;

  if verbrauch is null then
    select w.verbrauch_l_100km into verbrauch
      from public.vehicles fz join public.fahrzeug_varianten w on w.id = fz.variante_id
     where fz.id = public.trisar_fahrzeug_zum_tracker(new.imei, new.vin);
  end if;
  new.verbrauch_l_100km := verbrauch;
  new.geschaetzte_reichweite_km := case when verbrauch > 0 then round(l / verbrauch * 100) end;
  return new;
end $$;
