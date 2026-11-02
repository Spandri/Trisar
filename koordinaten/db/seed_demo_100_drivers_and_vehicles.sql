-- Demo-Seed: 100 Fahrer + 100 Fahrzeuge + 1:1 Zuweisung
-- Nutzt bestehende Fahrzeugdaten (brand_model/color/image_url) als Vorlage.
-- Optional werden Live-Standorte gesetzt, damit die Fahrer direkt auf der Karte sichtbar sind.
--
-- Ausfuehrung: Supabase SQL Editor (als Projekt-Owner / postgres)
-- Hinweis: Dieses Script schreibt in auth.users, profiles, vehicles, driver_live_locations.

begin;

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create sequence if not exists public.demo_plate_seq start 1000;

-- ------------------------------------------------------------
-- 0) Basiswerte / Defaults
-- ------------------------------------------------------------
create temporary table _demo_seed_drivers (
  seq int primary key,
  user_id uuid not null,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  street text not null,
  street_number text not null,
  city text not null,
  zip text not null,
  language text not null,
  vehicle_id uuid
) on commit drop;

insert into _demo_seed_drivers (
  seq,
  user_id,
  first_name,
  last_name,
  email,
  phone,
  street,
  street_number,
  city,
  zip,
  language
)
select
  gs as seq,
  uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, format('trisar-demo-fahrer-%s', gs)) as user_id,
  first_name,
  last_name,
  format(
    '%s.%s.%s@trisar-demo.local',
    lower(
      regexp_replace(
        translate(first_name, 'äöüÄÖÜß', 'aouAOUs'),
        '[^a-zA-Z0-9]+',
        '',
        'g'
      )
    ),
    lower(
      regexp_replace(
        translate(last_name, 'äöüÄÖÜß', 'aouAOUs'),
        '[^a-zA-Z0-9]+',
        '',
        'g'
      )
    ),
    lpad(gs::text, 3, '0')
  ) as email,
  format('+49 17%s %07s', ((gs - 1) % 9) + 1, 1000000 + gs) as phone,
  street,
  (((gs * 3) % 120) + 1)::text as street_number,
  city,
  lpad((80000 + ((gs * 37) % 1999))::text, 5, '0') as zip,
  (array['Deutsch', 'Deutsch', 'Deutsch', 'Englisch', 'Deutsch', 'Italienisch'])[1 + ((gs - 1) % 6)] as language
from (
  select
    gs,
    (array[
      'Luca','Noah','Milan','Elias','Paul','Jonas','Finn','Ben','Leon','Max',
      'Tim','David','Erik','Jan','Felix','Nico','Tom','Philipp','Simon','Robin',
      'Niklas','Moritz','Julian','Tobias','Daniel','Marvin','Kevin','Sandro','Stefan','Matteo',
      'Giulio','Dario','Samuel','Rafael','Adrian','Marco','Dennis','Bastian','Timo','Vincent'
    ])[1 + ((gs - 1) % 40)] as first_name,
    (array[
      'Meyer','Schmidt','Schneider','Fischer','Weber','Wagner','Becker','Hoffmann','Schulz','Koch',
      'Richter','Klein','Wolf','Neumann','Schwarz','Zimmermann','Braun','Krüger','Hartmann','Lange',
      'Werner','Krause','Lehmann','Schmid','König','Kaiser','Müller','Bauer','Peters','Sommer',
      'Brandt','Arnold','Jäger','Voigt','Graf','Kramer','Busch','Linke','Gärtner','Schenk'
    ])[1 + (((gs - 1) / 40) % 40)] as last_name,
    (array[
      'Rosenstraße','Bahnhofstraße','Lindenweg','Gartenstraße','Hauptstraße',
      'Parkallee','Schillerstraße','Goethestraße','Sonnenweg','Bergstraße'
    ])[1 + ((gs - 1) % 10)] as street,
    (array[
      'München','Augsburg','Nürnberg','Regensburg','Ingolstadt',
      'Rosenheim','Freising','Landshut','Passau','Kempten'
    ])[1 + (((gs * 5) - 1) % 10)] as city
  from generate_series(1, 100) as gs
) seeded;

create temporary table _vehicle_templates (
  idx int generated always as identity primary key,
  brand_model text,
  trim text,
  color text,
  image_url text,
  seat_count int,
  fuel_type text,
  range_km int,
  battery_fuel_percent int
) on commit drop;

insert into _vehicle_templates (brand_model, trim, color, image_url, seat_count, fuel_type, range_km, battery_fuel_percent)
select distinct
  nullif(trim(v.brand_model), ''),
  nullif(trim(v.trim), ''),
  nullif(trim(v.color), ''),
  nullif(trim(v.image_url), ''),
  v.seat_count,
  nullif(trim(v.fuel_type), ''),
  v.range_km,
  v.battery_fuel_percent
from public.vehicles v
where
  coalesce(trim(v.brand_model), '') <> ''
  or coalesce(trim(v.color), '') <> ''
  or coalesce(trim(v.image_url), '') <> ''
limit 30;

do $$
begin
  if (select count(*) from _vehicle_templates) = 0 then
    insert into _vehicle_templates (brand_model, trim, color, image_url, seat_count, fuel_type, range_km, battery_fuel_percent)
    values
      ('BMW 7er', '750i', 'black', '', 4, 'Benzin', 570, 80),
      ('Mercedes S-Klasse', 'S500', 'silver', '', 4, 'Benzin', 620, 75),
      ('Audi A8', '55 TFSI', 'gray', '', 4, 'Benzin', 600, 78),
      ('VW Multivan', 'T7', 'white', '', 7, 'Diesel', 700, 70),
      ('BMW X7', 'xDrive40i', 'black', '', 6, 'Benzin', 640, 82);
  end if;
end
$$;

-- ------------------------------------------------------------
-- 1) 100 Fahrzeuge erzeugen (mit zufaelligen Kennzeichen)
-- ------------------------------------------------------------
create temporary table _inserted_vehicles (
  seq int primary key,
  vehicle_id uuid not null
) on commit drop;

with template_count as (
  select greatest(1, count(*))::int as c from _vehicle_templates
),
vehicle_source as (
  select
    s.seq,
    t.brand_model,
    t.trim,
    t.color,
    t.image_url,
    coalesce(t.seat_count, 4) as seat_count,
    coalesce(t.fuel_type, 'Benzin') as fuel_type,
    coalesce(t.range_km, 550) as range_km,
    coalesce(t.battery_fuel_percent, 75) as battery_fuel_percent,
    nextval('public.demo_plate_seq') as plate_no
  from _demo_seed_drivers s
  cross join template_count tc
  join _vehicle_templates t
    on t.idx = ((s.seq - 1) % tc.c) + 1
),
ins as (
  insert into public.vehicles (
    brand_model,
    trim,
    vin,
    license_plate,
    color,
    seat_count,
    fuel_type,
    image_url,
    range_km,
    battery_fuel_percent
  )
  select
    coalesce(brand_model, 'Limousine'),
    trim,
    upper(substr(md5(random()::text || clock_timestamp()::text || seq::text), 1, 17)) as vin,
    format(
      'M-%s %s%s',
      chr((65 + ((plate_no - 1) % 26))::int),
      lpad((100 + (plate_no % 900))::text, 3, '0'),
      chr((65 + ((plate_no * 7) % 26))::int)
    ) as license_plate,
    coalesce(color, 'black'),
    seat_count,
    fuel_type,
    coalesce(image_url, ''),
    range_km,
    battery_fuel_percent
  from vehicle_source
  returning id
),
numbered as (
  select row_number() over () as seq, id as vehicle_id
  from ins
)
insert into _inserted_vehicles (seq, vehicle_id)
select seq, vehicle_id
from numbered;

update _demo_seed_drivers s
set vehicle_id = v.vehicle_id
from _inserted_vehicles v
where v.seq = s.seq;

-- ------------------------------------------------------------
-- 2) Auth-User fuer die 100 Fahrer erzeugen
-- ------------------------------------------------------------
-- Alte Demo-User entfernen, die nicht zu diesem Seed-Lauf gehoeren
delete from auth.users u
where lower(coalesce(u.email, '')) like '%@trisar-demo.local'
  and u.id not in (select user_id from _demo_seed_drivers);

with instance as (
  select coalesce((select instance_id from auth.users limit 1), '00000000-0000-0000-0000-000000000000'::uuid) as instance_id
)
insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_sent_at,
  recovery_sent_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
select
  s.user_id,
  i.instance_id,
  'authenticated',
  'authenticated',
  s.email,
  crypt('Demo1234!', gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('seed', true, 'source', 'demo_100'),
  now(),
  now()
from _demo_seed_drivers s
cross join instance i
on conflict (id) do update
set
  email = excluded.email,
  role = excluded.role,
  aud = excluded.aud,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = excluded.email_confirmed_at,
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

-- ------------------------------------------------------------
-- 3) Profile/Fahrer erzeugen + Fahrzeug zuweisen
-- ------------------------------------------------------------
do $$
declare
  has_driver_number boolean;
  has_driver_activity_state boolean;
  has_driver_activity_state_updated_at boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'driver_number'
  ) into has_driver_number;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'driver_activity_state'
  ) into has_driver_activity_state;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'driver_activity_state_updated_at'
  ) into has_driver_activity_state_updated_at;

  if has_driver_number and has_driver_activity_state and has_driver_activity_state_updated_at then
    execute $sql$
      with n as (
        select coalesce(max(driver_number), 0)::bigint as max_no
        from public.profiles
      )
      insert into public.profiles (
        id, first_name, last_name, phone, vehicle_id, role, is_dispo,
        driver_number, driver_activity_state, driver_activity_state_updated_at
      )
      select
        s.user_id,
        s.first_name,
        s.last_name,
        s.phone,
        s.vehicle_id,
        'fahrer',
        false,
        n.max_no + s.seq,
        'frei',
        now()
      from _demo_seed_drivers s
      cross join n
      on conflict (id) do update
      set
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone = excluded.phone,
        vehicle_id = excluded.vehicle_id,
        role = excluded.role,
        is_dispo = excluded.is_dispo,
        driver_number = excluded.driver_number,
        driver_activity_state = excluded.driver_activity_state,
        driver_activity_state_updated_at = excluded.driver_activity_state_updated_at
    $sql$;

  elsif has_driver_number then
    execute $sql$
      with n as (
        select coalesce(max(driver_number), 0)::bigint as max_no
        from public.profiles
      )
      insert into public.profiles (
        id, first_name, last_name, phone, vehicle_id, role, is_dispo, driver_number
      )
      select
        s.user_id,
        s.first_name,
        s.last_name,
        s.phone,
        s.vehicle_id,
        'fahrer',
        false,
        n.max_no + s.seq
      from _demo_seed_drivers s
      cross join n
      on conflict (id) do update
      set
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone = excluded.phone,
        vehicle_id = excluded.vehicle_id,
        role = excluded.role,
        is_dispo = excluded.is_dispo,
        driver_number = excluded.driver_number
    $sql$;

  else
    execute $sql$
      insert into public.profiles (
        id, first_name, last_name, phone, vehicle_id, role, is_dispo
      )
      select
        s.user_id,
        s.first_name,
        s.last_name,
        s.phone,
        s.vehicle_id,
        'fahrer',
        false
      from _demo_seed_drivers s
      on conflict (id) do update
      set
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        phone = excluded.phone,
        vehicle_id = excluded.vehicle_id,
        role = excluded.role,
        is_dispo = excluded.is_dispo
    $sql$;
  end if;
end
$$;

-- Optional vorhandene Profil-Felder mit Fake-Daten fuellen
do $$
declare
  has_email boolean;
  has_street boolean;
  has_street_number boolean;
  has_city boolean;
  has_zip boolean;
  has_language boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'email'
  ) into has_email;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'street'
  ) into has_street;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'street_number'
  ) into has_street_number;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'city'
  ) into has_city;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'zip'
  ) into has_zip;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'language'
  ) into has_language;

  if has_email then
    update public.profiles p
    set email = s.email
    from _demo_seed_drivers s
    where p.id = s.user_id;
  end if;
  if has_street then
    update public.profiles p
    set street = s.street
    from _demo_seed_drivers s
    where p.id = s.user_id;
  end if;
  if has_street_number then
    update public.profiles p
    set street_number = s.street_number
    from _demo_seed_drivers s
    where p.id = s.user_id;
  end if;
  if has_city then
    update public.profiles p
    set city = s.city
    from _demo_seed_drivers s
    where p.id = s.user_id;
  end if;
  if has_zip then
    update public.profiles p
    set zip = s.zip
    from _demo_seed_drivers s
    where p.id = s.user_id;
  end if;
  if has_language then
    update public.profiles p
    set language = s.language
    from _demo_seed_drivers s
    where p.id = s.user_id;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 4) Optional: Live-Standorte fuer Demo-Karte setzen
--    - 10 Fahrer nahe Flughafen Muenchen Terminal 2
--    - 90 Fahrer verteilt im Stadtgebiet Muenchen
-- ------------------------------------------------------------
insert into public.driver_live_locations (
  driver_id,
  active_job_id,
  lat,
  lng,
  accuracy_m,
  speed_mps,
  heading_deg,
  source,
  captured_at
)
select
  s.user_id,
  null,
  case
    when s.seq <= 10 then 48.353783 + ((random() - 0.5) * 0.008)  -- Flughafen Terminal 2 (ca. +/- 400m)
    else 48.061 + (random() * (48.248 - 48.061))                   -- Muenchen Nord/Sued
  end as lat,
  case
    when s.seq <= 10 then 11.786086 + ((random() - 0.5) * 0.008)   -- Flughafen Terminal 2 (ca. +/- 400m)
    else 11.360 + (random() * (11.720 - 11.360))                   -- Muenchen West/Ost
  end as lng,
  8 + (random() * 20),
  0,
  floor(random() * 360),
  'demo_seed',
  now()
from _demo_seed_drivers s
on conflict (driver_id) do update
set
  lat = excluded.lat,
  lng = excluded.lng,
  accuracy_m = excluded.accuracy_m,
  speed_mps = excluded.speed_mps,
  heading_deg = excluded.heading_deg,
  source = excluded.source,
  captured_at = excluded.captured_at,
  updated_at = now();

-- Ergebnis-Check
select
  (select count(*) from _demo_seed_drivers) as seeded_drivers,
  (select count(*) from _inserted_vehicles) as seeded_vehicles,
  (select count(*) from public.profiles p join _demo_seed_drivers s on s.user_id = p.id) as profiles_created,
  (select count(*) from public.driver_live_locations l join _demo_seed_drivers s on s.user_id = l.driver_id) as live_locations_written;

commit;
