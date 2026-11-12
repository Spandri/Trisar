-- Reichweite selbst schaetzen, wenn das Auto keine liefert (z. B. BMW X7 und 7er: Teltonika liest dort
-- nur Tank in Litern und Kilometerstand, keine Restreichweite). 12.11.2026.
--
-- Je Tracker (IMEI) wird der Verbrauch aus echten Fahrten gelernt: Liter weniger im Tank geteilt durch
-- gefahrene Kilometer, gleitend ueber die letzten rund 1000 km. Tanken, ein zurueckgehender Tacho oder
-- eine andere VIN setzen neu an. Reichweite = Tank (l) / Verbrauch * 100.
-- Die Apps zeigen die echte Restreichweite des Autos, sonst diese Schaetzung mit "ca.".

alter table public.vehicle_telemetry_live
  add column if not exists verbrauch_l_100km numeric(5,1),
  add column if not exists geschaetzte_reichweite_km integer;

create table if not exists public.fahrzeug_verbrauch (
  imei text primary key,
  vin text,
  ref_km numeric(12,1) not null,
  ref_l numeric(8,1) not null,
  summe_km numeric(10,1) not null default 0,
  summe_l numeric(8,2) not null default 0,
  l_100km numeric(5,1),
  updated_at timestamptz not null default now()
);

alter table public.fahrzeug_verbrauch enable row level security;
drop policy if exists dispo_lesen on public.fahrzeug_verbrauch;
create policy dispo_lesen on public.fahrzeug_verbrauch
  for select to authenticated using (public.ist_dispo());

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

  new.verbrauch_l_100km := verbrauch;
  new.geschaetzte_reichweite_km := case when verbrauch > 0 then round(l / verbrauch * 100) end;
  return new;
end $$;

drop trigger if exists trg_fahrzeug_reichweite on public.vehicle_telemetry_live;
create trigger trg_fahrzeug_reichweite
  before insert or update on public.vehicle_telemetry_live
  for each row execute function public.fahrzeug_reichweite_schaetzen();
