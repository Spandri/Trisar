-- Fahrtenbuch haengt an der Fahrgestellnummer (21.11.2026)
--
-- Ein Kennzeichen kann spaeter an einem anderen Wagen haengen (Mietwagenfirma vergibt es neu). Darum
-- gehoert jede Zeile zur Fahrgestellnummer (VIN) des Wagens, das Kennzeichen ist nur der Stand von damals.
--   VIN einer Fahrt: die der Tracker aus dem Auto liest, sonst die aus den Stammdaten (jobs.km_vin).
--   Leerfahrt-Kette und Anzeige laufen ueber die VIN. Nur Autos ohne VIN laufen weiter ueber den Datensatz.
--   fahrtenbuch_lesen(Auto, von, bis) liefert Zeilen und Summen fuer Dispo-Apps und Export.

alter table public.fahrtenbuch add column if not exists vin text;
alter table public.fahrzeug_km_stand add column if not exists vin text;
alter table public.jobs add column if not exists km_vin text;
create index if not exists fahrtenbuch_vin_zeit on public.fahrtenbuch (vin, ende desc) where vin is not null;

-- Vorhandene Zeilen einmalig mit der VIN aus den Stammdaten fuellen (einzige Stelle, die Zeilen anfasst).
alter table public.fahrtenbuch disable trigger trg_fahrtenbuch_unveraenderlich;
update public.fahrtenbuch f set vin = nullif(upper(trim(v.vin)), '')
  from public.vehicles v where v.id = f.vehicle_id and f.vin is null and nullif(trim(v.vin), '') is not null;
alter table public.fahrtenbuch enable trigger trg_fahrtenbuch_unveraenderlich;
update public.fahrzeug_km_stand k set vin = nullif(upper(trim(v.vin)), '')
  from public.vehicles v where v.id = k.vehicle_id and k.vin is null and nullif(trim(v.vin), '') is not null;
update public.jobs j set km_vin = nullif(upper(trim(v.vin)), '')
  from public.vehicles v where v.id = j.km_fahrzeug_id and j.km_vin is null and nullif(trim(v.vin), '') is not null;

-- Die Sicht kennt die neue Spalte erst nach dem Neuanlegen.
drop view if exists public.fahrtenbuch_gueltig;
create view public.fahrtenbuch_gueltig
with (security_invoker = true) as
  select f.*
    from public.fahrtenbuch f
   where f.art <> 'storno'
     and not exists (select 1 from public.fahrtenbuch x where x.korrigiert_id = f.id);

drop function if exists public.trisar_km_jetzt(uuid, uuid);

create or replace function public.trisar_km_jetzt(p_driver uuid, p_vehicle uuid,
                                                  out tacho numeric, out zaehler numeric, out fahrzeug uuid, out vin text)
language plpgsql stable security definer set search_path = public as $$
declare
  t public.vehicle_telemetry_live%rowtype;
begin
  select * into t from public.vehicle_telemetry_live where driver_id = p_driver;
  if not found or t.imei is null then return; end if;
  if not exists (select 1 from public.imei_driver_map m
                  where m.imei = t.imei and m.driver_id = p_driver and m.is_active) then
    return;
  end if;
  fahrzeug := public.trisar_fahrzeug_zum_tracker(t.imei, t.vin);
  if p_vehicle is not null and fahrzeug is not null and fahrzeug <> p_vehicle then
    fahrzeug := null;
    return;
  end if;
  vin := nullif(upper(trim(t.vin)), '');
  tacho := nullif(t.oem_mileage_km, 0);
  zaehler := nullif(t.total_odometer_km, 0);
end;
$$;

create or replace function public.trisar_fahrzeug_km_stand()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vid uuid;
  l public.fahrzeug_km_stand%rowtype;
  v_tacho numeric := nullif(new.oem_mileage_km, 0);
  v_zaehler numeric := nullif(new.total_odometer_km, 0);
  v_vin text := nullif(upper(trim(new.vin)), '');
begin
  if v_tacho is null and v_zaehler is null then return null; end if;
  vid := public.trisar_fahrzeug_zum_tracker(new.imei, new.vin);
  if vid is null then return null; end if;

  if v_vin is null then
    select nullif(upper(trim(v.vin)), '') into v_vin from public.vehicles v where v.id = vid;
  end if;
  select * into l from public.fahrzeug_km_stand where vehicle_id = vid order by erfasst desc limit 1;
  if not found
     or l.vin is distinct from v_vin
     or abs(coalesce(v_tacho, 0) - coalesce(l.tacho_km, 0)) >= 1
     or abs(coalesce(v_zaehler, 0) - coalesce(l.zaehler_km, 0)) >= 1
     or (new.ignition is distinct from l.zuendung
         and (v_tacho is distinct from l.tacho_km or v_zaehler is distinct from l.zaehler_km
              or l.erfasst < coalesce(new.captured_at, now()) - interval '10 minutes')) then
    insert into public.fahrzeug_km_stand (vehicle_id, vin, imei, driver_id, erfasst, tacho_km, zaehler_km, zuendung)
    values (vid, v_vin, new.imei, new.driver_id, coalesce(new.captured_at, now()), v_tacho, v_zaehler, new.ignition);
  end if;

  if v_tacho is not null then
    update public.vehicles
       set km_stand = v_tacho, km_stand_am = coalesce(new.captured_at, now())
     where id = vid and km_stand is distinct from v_tacho;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

create or replace function public.trisar_fahrt_km()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_fahrt constant text[] := array['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
  v_fertig constant text[] := array['done', 'completed', 'arrived', 'beendet'];
  v_weg constant text[] := array['cancelled', 'canceled', 'refused', 'storniert', 'stoniert'];
  st_neu text := public.trisar_norm_status(new.status);
  st_alt text := case when tg_op = 'UPDATE' then public.trisar_norm_status(old.status) end;
  v_profil uuid;
  k record;
  d record;
  v_spur numeric;
  v_route numeric;
begin
  if st_neu = any (v_fahrt) and (st_alt is null or st_alt <> all (v_fahrt)) then
    if st_alt = any (v_fertig) and new.km_fahrzeug_id is not null then
      null;  -- Dispo setzt eine beendete Fahrt zurueck auf unterwegs: Start bleibt
    else
      select vehicle_id into v_profil from public.profiles where id = new.driver_id;
      select * into k from public.trisar_km_jetzt(new.driver_id, v_profil);
      new.km_fahrzeug_id := coalesce(v_profil, k.fahrzeug);
      new.km_vin := coalesce(k.vin, (select nullif(upper(trim(v.vin)), '') from public.vehicles v where v.id = new.km_fahrzeug_id));
      new.km_start := k.tacho;
      new.km_zaehler_start := k.zaehler;
    end if;
    new.km_ende := null;
    new.km_zaehler_ende := null;
    new.km_gefahren := null;
    new.km_quelle := null;

  elsif st_neu = any (v_fertig) and (st_alt is null or st_alt <> all (v_fertig)) then
    if new.km_fahrzeug_id is null then
      select vehicle_id into v_profil from public.profiles where id = new.driver_id;
      select * into k from public.trisar_km_jetzt(new.driver_id, v_profil);
      new.km_fahrzeug_id := coalesce(v_profil, k.fahrzeug);
      new.km_vin := coalesce(k.vin, (select nullif(upper(trim(v.vin)), '') from public.vehicles v where v.id = new.km_fahrzeug_id));
    else
      select * into k from public.trisar_km_jetzt(new.driver_id, new.km_fahrzeug_id);
    end if;
    new.km_ende := k.tacho;
    new.km_zaehler_ende := k.zaehler;
    select * into d from public.trisar_km_differenz(new.km_start, new.km_ende, new.km_zaehler_start, new.km_zaehler_ende);
    new.km_gefahren := d.km;
    new.km_quelle := d.quelle;
    if new.km_gefahren is null then
      v_route := round(new.ext_route_distance_m / 1000.0, 1);
      if new.abfahrt_echt is not null and new.driver_id is not null then
        v_spur := public.trisar_spur_km(new.driver_id, new.abfahrt_echt, coalesce(new.ankunft_echt, now()));
      end if;
      if v_spur is not null and (v_route is null or v_spur >= v_route * 0.5) then
        new.km_gefahren := v_spur;
        new.km_quelle := 'gps_spur';
      elsif v_route is not null then
        new.km_gefahren := v_route;
        new.km_quelle := 'route';
      end if;
    end if;

  elsif tg_op = 'UPDATE' and st_neu is distinct from st_alt
        and st_neu <> all (v_fahrt) and st_neu <> all (v_fertig) and st_neu <> all (v_weg) then
    -- Zurueck auf offen oder beim Gast: noch nicht losgefahren
    new.km_fahrzeug_id := null;
    new.km_vin := null;
    new.km_start := null;
    new.km_zaehler_start := null;
    new.km_ende := null;
    new.km_zaehler_ende := null;
    new.km_gefahren := null;
    new.km_quelle := null;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

create or replace function public.trisar_fahrtenbuch_schreiben()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_fahrt constant text[] := array['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
  v_fertig constant text[] := array['done', 'completed', 'arrived', 'beendet'];
  st_neu text := public.trisar_norm_status(new.status);
  st_alt text := case when tg_op = 'UPDATE' then public.trisar_norm_status(old.status) end;
  l public.fahrtenbuch%rowtype;
  a public.fahrtenbuch%rowtype;
  d record;
  v_kennzeichen text;
  v_fahrzeug text;
  v_fahrer text;
  v_km numeric;
  v_quelle text;
  v_jetzt timestamptz := now();
begin
  if st_neu is not distinct from st_alt then return null; end if;

  select v.license_plate, v.brand_model into v_kennzeichen, v_fahrzeug
    from public.vehicles v where v.id = new.km_fahrzeug_id;
  select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') into v_fahrer
    from public.profiles p where p.id = new.driver_id;
  -- Bisher gueltige Zeile dieser Fahrt
  select * into a from public.fahrtenbuch_gueltig g where g.job_id = new.id and g.art = 'gast'
   order by g.id desc limit 1;

  -- Losgefahren: Leerfahrt seit dem letzten Eintrag des Autos
  if st_neu = any (v_fahrt) and (st_alt is null or (st_alt <> all (v_fahrt) and st_alt <> all (v_fertig)))
     and new.km_fahrzeug_id is not null then
    select * into l from public.fahrtenbuch_gueltig g
     where case when new.km_vin is not null then g.vin = new.km_vin
                else g.vehicle_id = new.km_fahrzeug_id and g.vin is null end
     order by g.ende desc nulls last, g.id desc limit 1;
    if found then
      select * into d from public.trisar_km_differenz(l.km_ende, new.km_start, l.km_zaehler_ende, new.km_zaehler_start);
      v_km := d.km;
      v_quelle := d.quelle;
      if v_km is null and l.driver_id = new.driver_id and l.ende is not null then
        v_km := public.trisar_spur_km(new.driver_id, l.ende, v_jetzt);
        v_quelle := 'gps_spur';
      end if;
      if v_km > 0 then
        insert into public.fahrtenbuch (vehicle_id, vin, kennzeichen, fahrzeug, driver_id, fahrer, job_id, art,
                                        beginn, ende, km_start, km_ende, km_zaehler_start, km_zaehler_ende,
                                        km, km_quelle, von, nach, zweck, erstellt_von)
        values (new.km_fahrzeug_id, new.km_vin, v_kennzeichen, v_fahrzeug,
                case when l.driver_id = new.driver_id then new.driver_id end,
                case when l.driver_id = new.driver_id then v_fahrer end,
                new.id, 'leer', l.ende, coalesce(new.abfahrt_echt, v_jetzt),
                l.km_ende, new.km_start, l.km_zaehler_ende, new.km_zaehler_start,
                v_km, v_quelle, l.nach, coalesce(nullif(new.pickup_name, ''), new.pickup_address),
                'Leerfahrt', auth.uid());
      end if;
    end if;
  end if;

  -- Erledigt: die Fahrt selbst (ersetzt eine fruehere Zeile derselben Fahrt)
  if st_neu = any (v_fertig) and new.km_fahrzeug_id is not null then
    insert into public.fahrtenbuch (vehicle_id, vin, kennzeichen, fahrzeug, driver_id, fahrer, job_id, art,
                                    beginn, ende, km_start, km_ende, km_zaehler_start, km_zaehler_ende,
                                    km, km_quelle, von, nach, zweck, gaeste, korrigiert_id, grund, erstellt_von)
    values (new.km_fahrzeug_id, new.km_vin, v_kennzeichen, v_fahrzeug, new.driver_id, v_fahrer, new.id, 'gast',
            new.abfahrt_echt, coalesce(new.ankunft_echt, v_jetzt),
            new.km_start, new.km_ende, new.km_zaehler_start, new.km_zaehler_ende,
            new.km_gefahren, new.km_quelle,
            coalesce(nullif(new.pickup_name, ''), new.pickup_address),
            coalesce(nullif(new.dropoff_name, ''), new.dropoff_address),
            coalesce(nullif(new.trip_type, ''), 'Gastfahrt'), to_jsonb(new.passengers),
            a.id, case when a.id is not null then 'Fahrt erneut beendet' end, auth.uid());

  -- Beendete Fahrt wieder geoeffnet oder storniert: alte Zeile gilt nicht mehr
  elsif st_alt = any (v_fertig) and a.id is not null then
    insert into public.fahrtenbuch (vehicle_id, vin, kennzeichen, fahrzeug, driver_id, fahrer, job_id, art,
                                    beginn, ende, von, nach, korrigiert_id, grund, erstellt_von)
    values (a.vehicle_id, a.vin, a.kennzeichen, a.fahrzeug, a.driver_id, a.fahrer, a.job_id, 'storno',
            a.beginn, a.ende, a.von, a.nach, a.id, 'Status zurueck auf ' || coalesce(new.status, '?'), auth.uid());
  end if;
  return null;
exception when others then
  return null;
end;
$$;

-- Fahrtenbuch eines Autos. Zeitraum in Berliner Tagen, beide Tage eingeschlossen.
-- fahrtenbuch_daten: ohne Benutzerpruefung, nur service_role (Export in dispo-admin).
-- fahrtenbuch_lesen: fuer die Dispo-Apps, prueft die Rolle.
create or replace function public.fahrtenbuch_daten(p_vehicle uuid, p_von date default null, p_bis date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.vehicles%rowtype;
  v_vin text;
  v_heute date := (now() at time zone 'Europe/Berlin')::date;
  v_von date := coalesce(p_von, date_trunc('month', (now() at time zone 'Europe/Berlin'))::date);
  v_bis date := coalesce(p_bis, (now() at time zone 'Europe/Berlin')::date);
  erg jsonb;
begin
  select * into v from public.vehicles where id = p_vehicle;
  if not found then return null; end if;
  v_vin := nullif(upper(trim(v.vin)), '');

  with zeilen as (
    select g.*, (coalesce(g.ende, g.beginn) at time zone 'Europe/Berlin')::date as tag
      from public.fahrtenbuch_gueltig g
     where case when v_vin is not null then g.vin = v_vin
                else g.vehicle_id = p_vehicle and g.vin is null end
  )
  select jsonb_build_object(
    'vehicle_id', v.id,
    'vin', v_vin,
    'kennzeichen', v.license_plate,
    'fahrzeug', v.brand_model,
    'km_stand', v.km_stand,
    'km_stand_am', v.km_stand_am,
    'von', v_von,
    'bis', v_bis,
    'km_heute', (select coalesce(sum(z.km), 0) from zeilen z where z.tag = v_heute),
    'km_monat', (select coalesce(sum(z.km), 0) from zeilen z
                  where z.tag >= date_trunc('month', v_heute)::date and z.tag <= v_heute),
    'km_gesamt', (select coalesce(sum(z.km), 0) from zeilen z where z.tag between v_von and v_bis),
    'km_gast', (select coalesce(sum(z.km), 0) from zeilen z where z.tag between v_von and v_bis and z.art = 'gast'),
    'km_leer', (select coalesce(sum(z.km), 0) from zeilen z where z.tag between v_von and v_bis and z.art = 'leer'),
    'anzahl', (select count(*) from zeilen),
    'zeilen', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', z.id, 'tag', z.tag, 'art', z.art, 'job_id', z.job_id,
               'beginn', z.beginn, 'ende', z.ende,
               'km_start', z.km_start, 'km_ende', z.km_ende,
               'km', z.km, 'km_quelle', z.km_quelle,
               'genau', z.km_quelle in ('tacho', 'gps_zaehler'),
               'von', z.von, 'nach', z.nach, 'zweck', z.zweck,
               'fahrer', z.fahrer, 'kennzeichen', z.kennzeichen
             ) order by coalesce(z.ende, z.beginn) desc, z.id desc)
        from zeilen z where z.tag between v_von and v_bis), '[]'::jsonb)
  ) into erg;
  return erg;
end;
$$;

revoke all on function public.fahrtenbuch_daten(uuid, date, date) from public, anon, authenticated;
grant execute on function public.fahrtenbuch_daten(uuid, date, date) to service_role;

create or replace function public.fahrtenbuch_lesen(p_vehicle uuid, p_von date default null, p_bis date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.ist_dispo() then
    raise exception 'kein Zugriff';
  end if;
  return public.fahrtenbuch_daten(p_vehicle, p_von, p_bis);
end;
$$;

revoke all on function public.fahrtenbuch_lesen(uuid, date, date) from public, anon;
grant execute on function public.fahrtenbuch_lesen(uuid, date, date) to authenticated, service_role;

notify pgrst, 'reload schema';
