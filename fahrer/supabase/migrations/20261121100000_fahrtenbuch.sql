-- Fahrtenbuch je Fahrzeug (21.11.2026)
--
-- Bisher gab es den Kilometerstand nur als letzten Wert je Fahrer (vehicle_telemetry_live) und an der
-- Fahrt nur die geplante Strecke. Jetzt:
--   vehicles.km_stand         letzter Tacho-Stand des Autos (Tracker, IO 389)
--   fahrzeug_km_stand         Verlauf je Auto, ein Eintrag je gefahrenem Kilometer
--   jobs.km_*                 Stand bei "Unterwegs" und bei "Erledigt", gefahrene km und woher sie stammen
--   fahrtenbuch               eine Zeile je Fahrt und je Leerfahrt dazwischen, nur anfuegen
--
-- Woher die km einer Fahrt kommen (km_quelle), in dieser Reihenfolge:
--   tacho        Tacho-Stand Ende minus Start. Der Tacho zaehlt nur ganze km, darum nimmt die Datenbank
--                den genaueren GPS-Zaehler des Trackers (IO 16), solange er zum Tacho passt.
--   gps_zaehler  nur GPS-Zaehler des Trackers (Tracker ohne OBD, z. B. USB-C)
--   gps_spur     Strecke aus den Standorten des Fahrers zwischen echter Abfahrt und Ankunft (Anzeige "ca.")
--   route        geplante Route (Anzeige "ca.")
--
-- Leerfahrt: startet eine Fahrt, traegt die Datenbank die km seit dem letzten Eintrag desselben Autos
-- als eigene Zeile ein. So ergibt die Summe aller Zeilen den Weg des Autos.
-- Nichts im Fahrtenbuch wird geaendert oder geloescht. Wird eine Fahrt zurueckgesetzt oder neu beendet,
-- kommt eine neue Zeile, die auf die alte zeigt (korrigiert_id). Gueltig ist, was fahrtenbuch_gueltig zeigt.
-- jobs.vehicle_id bleibt unberuehrt (loest sonst die Push-Mitteilung "Anderes Fahrzeug" aus), das Auto
-- der Fahrt steht in jobs.km_fahrzeug_id.
-- Kein Statuswechsel und kein Tracker-Paket darf am Fahrtenbuch scheitern, darum faengt jeder Trigger Fehler ab.

alter table public.vehicles
  add column if not exists km_stand numeric(12,1),
  add column if not exists km_stand_am timestamptz;

comment on column public.vehicles.km_stand is 'Letzter Tacho-Stand vom Tracker (OBD), km.';

create table if not exists public.fahrzeug_km_stand (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  imei text,
  driver_id uuid,
  erfasst timestamptz not null,
  tacho_km numeric(12,1),
  zaehler_km numeric(12,3),
  zuendung boolean
);
create index if not exists fahrzeug_km_stand_auto_zeit on public.fahrzeug_km_stand (vehicle_id, erfasst desc);

alter table public.fahrzeug_km_stand enable row level security;
drop policy if exists dispo_lesen on public.fahrzeug_km_stand;
create policy dispo_lesen on public.fahrzeug_km_stand for select to authenticated using (public.ist_dispo());

alter table public.jobs
  add column if not exists km_fahrzeug_id uuid references public.vehicles(id) on delete set null,
  add column if not exists km_start numeric(12,1),
  add column if not exists km_ende numeric(12,1),
  add column if not exists km_zaehler_start numeric(12,3),
  add column if not exists km_zaehler_ende numeric(12,3),
  add column if not exists km_gefahren numeric(8,1),
  add column if not exists km_quelle text;

alter table public.jobs drop constraint if exists jobs_km_quelle_check;
alter table public.jobs add constraint jobs_km_quelle_check
  check (km_quelle is null or km_quelle in ('tacho', 'gps_zaehler', 'gps_spur', 'route'));

create table if not exists public.fahrtenbuch (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null,
  kennzeichen text,
  fahrzeug text,
  driver_id uuid,
  fahrer text,
  job_id uuid,
  art text not null check (art in ('gast', 'leer', 'storno')),
  beginn timestamptz,
  ende timestamptz,
  km_start numeric(12,1),
  km_ende numeric(12,1),
  km_zaehler_start numeric(12,3),
  km_zaehler_ende numeric(12,3),
  km numeric(8,1),
  km_quelle text check (km_quelle is null or km_quelle in ('tacho', 'gps_zaehler', 'gps_spur', 'route')),
  von text,
  nach text,
  zweck text,
  gaeste jsonb,
  korrigiert_id bigint references public.fahrtenbuch(id),
  grund text,
  erstellt timestamptz not null default now(),
  erstellt_von uuid
);
create index if not exists fahrtenbuch_auto_zeit on public.fahrtenbuch (vehicle_id, ende desc);
create index if not exists fahrtenbuch_fahrt on public.fahrtenbuch (job_id) where job_id is not null;
create index if not exists fahrtenbuch_korrigiert on public.fahrtenbuch (korrigiert_id) where korrigiert_id is not null;

comment on table public.fahrtenbuch is 'Fahrtenbuch je Fahrzeug. Nur anfuegen, Korrektur als neue Zeile mit korrigiert_id.';

alter table public.fahrtenbuch enable row level security;
drop policy if exists dispo_lesen on public.fahrtenbuch;
create policy dispo_lesen on public.fahrtenbuch for select to authenticated using (public.ist_dispo());

-- Nur anfuegen.
create or replace function public.fahrtenbuch_unveraenderlich()
returns trigger language plpgsql as $$
begin
  raise exception 'Das Fahrtenbuch wird nur ergaenzt, nicht geaendert oder geloescht.';
end;
$$;

drop trigger if exists trg_fahrtenbuch_unveraenderlich on public.fahrtenbuch;
create trigger trg_fahrtenbuch_unveraenderlich
  before update or delete on public.fahrtenbuch
  for each row execute function public.fahrtenbuch_unveraenderlich();
drop trigger if exists trg_fahrtenbuch_nicht_leeren on public.fahrtenbuch;
create trigger trg_fahrtenbuch_nicht_leeren
  before truncate on public.fahrtenbuch
  for each statement execute function public.fahrtenbuch_unveraenderlich();

-- Gueltige Zeilen: nicht storniert und nicht durch eine neuere ersetzt.
create or replace view public.fahrtenbuch_gueltig
with (security_invoker = true) as
  select f.*
    from public.fahrtenbuch f
   where f.art <> 'storno'
     and not exists (select 1 from public.fahrtenbuch x where x.korrigiert_id = f.id);

-- Strecke aus den Standorten eines Fahrers. Stillstand (unter 15 m) und Spruenge (ueber 250 km/h) zaehlen nicht.
create or replace function public.trisar_spur_km(p_driver uuid, p_von timestamptz, p_bis timestamptz)
returns numeric
language sql stable security definer set search_path = public as $$
  select case when count(*) >= 3 then round((sum(s.m) / 1000.0)::numeric, 1) end
    from (
      select public.trisar_luftlinie_m(lag(l.lat) over w, lag(l.lng) over w, l.lat, l.lng) as m,
             extract(epoch from l.captured_at - lag(l.captured_at) over w) as sek
        from public.driver_location_history l
       where l.driver_id = p_driver and l.captured_at >= p_von and l.captured_at <= p_bis
      window w as (order by l.captured_at)
    ) s
   where s.m >= 15 and s.m / greatest(s.sek, 1) <= 70
$$;

-- Gefahrene km aus zwei Staenden. Tacho gilt, der GPS-Zaehler verfeinert ihn, solange beide zusammenpassen.
create or replace function public.trisar_km_differenz(p_tacho_1 numeric, p_tacho_2 numeric,
                                                      p_zaehler_1 numeric, p_zaehler_2 numeric,
                                                      out km numeric, out quelle text)
language plpgsql immutable as $$
declare
  dt numeric := p_tacho_2 - p_tacho_1;
  dz numeric := p_zaehler_2 - p_zaehler_1;
begin
  if dt < 0 or dt > 2000 then dt := null; end if;
  if dz < 0 or dz > 2000 then dz := null; end if;
  if dt is not null then
    quelle := 'tacho';
    km := case when dz is not null and abs(dz - dt) <= 1 + 0.05 * dt then round(dz, 1) else dt end;
  elsif dz is not null then
    quelle := 'gps_zaehler';
    km := round(dz, 1);
  end if;
end;
$$;

-- Aktueller Stand vom Tracker des Fahrers. Leer, wenn der Tracker nicht mehr dem Fahrer gehoert
-- oder in einem anderen Auto steckt als erwartet.
create or replace function public.trisar_km_jetzt(p_driver uuid, p_vehicle uuid,
                                                  out tacho numeric, out zaehler numeric, out fahrzeug uuid)
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
  tacho := nullif(t.oem_mileage_km, 0);
  zaehler := nullif(t.total_odometer_km, 0);
end;
$$;

-- Tracker-Paket: Kilometerstand am Auto nachziehen, Verlauf je vollem Kilometer und bei Zuendung an/aus.
create or replace function public.trisar_fahrzeug_km_stand()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vid uuid;
  l public.fahrzeug_km_stand%rowtype;
  v_tacho numeric := nullif(new.oem_mileage_km, 0);
  v_zaehler numeric := nullif(new.total_odometer_km, 0);
begin
  if v_tacho is null and v_zaehler is null then return null; end if;
  vid := public.trisar_fahrzeug_zum_tracker(new.imei, new.vin);
  if vid is null then return null; end if;

  select * into l from public.fahrzeug_km_stand where vehicle_id = vid order by erfasst desc limit 1;
  if not found
     or abs(coalesce(v_tacho, 0) - coalesce(l.tacho_km, 0)) >= 1
     or abs(coalesce(v_zaehler, 0) - coalesce(l.zaehler_km, 0)) >= 1
     or (new.ignition is distinct from l.zuendung
         and (v_tacho is distinct from l.tacho_km or v_zaehler is distinct from l.zaehler_km
              or l.erfasst < coalesce(new.captured_at, now()) - interval '10 minutes')) then
    insert into public.fahrzeug_km_stand (vehicle_id, imei, driver_id, erfasst, tacho_km, zaehler_km, zuendung)
    values (vid, new.imei, new.driver_id, coalesce(new.captured_at, now()), v_tacho, v_zaehler, new.ignition);
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

drop trigger if exists trg_fahrzeug_km_stand on public.vehicle_telemetry_live;
create trigger trg_fahrzeug_km_stand
  after insert or update on public.vehicle_telemetry_live
  for each row execute function public.trisar_fahrzeug_km_stand();

-- Statuswechsel: Staende an der Fahrt festhalten. Laeuft nach trg_jobs_echte_zeiten (Name), braucht dessen Zeiten.
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

drop trigger if exists trg_jobs_fahrt_km on public.jobs;
create trigger trg_jobs_fahrt_km
  before insert or update of status on public.jobs
  for each row execute function public.trisar_fahrt_km();

-- Statuswechsel: Zeilen ins Fahrtenbuch.
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
     where g.vehicle_id = new.km_fahrzeug_id order by g.ende desc nulls last, g.id desc limit 1;
    if found then
      select * into d from public.trisar_km_differenz(l.km_ende, new.km_start, l.km_zaehler_ende, new.km_zaehler_start);
      v_km := d.km;
      v_quelle := d.quelle;
      if v_km is null and l.driver_id = new.driver_id and l.ende is not null then
        v_km := public.trisar_spur_km(new.driver_id, l.ende, v_jetzt);
        v_quelle := 'gps_spur';
      end if;
      if v_km > 0 then
        insert into public.fahrtenbuch (vehicle_id, kennzeichen, fahrzeug, driver_id, fahrer, job_id, art,
                                        beginn, ende, km_start, km_ende, km_zaehler_start, km_zaehler_ende,
                                        km, km_quelle, von, nach, zweck, erstellt_von)
        values (new.km_fahrzeug_id, v_kennzeichen, v_fahrzeug,
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
    insert into public.fahrtenbuch (vehicle_id, kennzeichen, fahrzeug, driver_id, fahrer, job_id, art,
                                    beginn, ende, km_start, km_ende, km_zaehler_start, km_zaehler_ende,
                                    km, km_quelle, von, nach, zweck, gaeste, korrigiert_id, grund, erstellt_von)
    values (new.km_fahrzeug_id, v_kennzeichen, v_fahrzeug, new.driver_id, v_fahrer, new.id, 'gast',
            new.abfahrt_echt, coalesce(new.ankunft_echt, v_jetzt),
            new.km_start, new.km_ende, new.km_zaehler_start, new.km_zaehler_ende,
            new.km_gefahren, new.km_quelle,
            coalesce(nullif(new.pickup_name, ''), new.pickup_address),
            coalesce(nullif(new.dropoff_name, ''), new.dropoff_address),
            coalesce(nullif(new.trip_type, ''), 'Gastfahrt'), to_jsonb(new.passengers),
            a.id, case when a.id is not null then 'Fahrt erneut beendet' end, auth.uid());

  -- Beendete Fahrt wieder geoeffnet oder storniert: alte Zeile gilt nicht mehr
  elsif st_alt = any (v_fertig) and a.id is not null then
    insert into public.fahrtenbuch (vehicle_id, kennzeichen, fahrzeug, driver_id, fahrer, job_id, art,
                                    beginn, ende, von, nach, korrigiert_id, grund, erstellt_von)
    values (a.vehicle_id, a.kennzeichen, a.fahrzeug, a.driver_id, a.fahrer, a.job_id, 'storno',
            a.beginn, a.ende, a.von, a.nach, a.id, 'Status zurueck auf ' || coalesce(new.status, '?'), auth.uid());
  end if;
  return null;
exception when others then
  return null;
end;
$$;

drop trigger if exists trg_jobs_fahrtenbuch on public.jobs;
create trigger trg_jobs_fahrtenbuch
  after insert or update of status on public.jobs
  for each row execute function public.trisar_fahrtenbuch_schreiben();

-- Startwert: aktueller Stand je Auto aus den letzten Tracker-Werten.
insert into public.fahrzeug_km_stand (vehicle_id, imei, driver_id, erfasst, tacho_km, zaehler_km, zuendung)
select x.vid, t.imei, t.driver_id, coalesce(t.captured_at, now()),
       nullif(t.oem_mileage_km, 0), nullif(t.total_odometer_km, 0), t.ignition
  from public.vehicle_telemetry_live t
  cross join lateral (select public.trisar_fahrzeug_zum_tracker(t.imei, t.vin) as vid) x
 where x.vid is not null
   and (nullif(t.oem_mileage_km, 0) is not null or nullif(t.total_odometer_km, 0) is not null)
   and not exists (select 1 from public.fahrzeug_km_stand k where k.vehicle_id = x.vid);

update public.vehicles v
   set km_stand = k.tacho_km, km_stand_am = k.erfasst
  from (select distinct on (vehicle_id) vehicle_id, tacho_km, erfasst
          from public.fahrzeug_km_stand where tacho_km is not null
         order by vehicle_id, erfasst desc) k
 where v.id = k.vehicle_id and v.km_stand is null;

notify pgrst, 'reload schema';
