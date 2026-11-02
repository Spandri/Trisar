-- Demo-Seed: Szenario-Fahrten fuer 05.03.2026 (10:00-23:00)
-- Enthalten:
-- - Pro Fahrer ca. 2 Fahrten
-- - Mix aus SoloNormal, SoloFlughafen und Konvoi-Fahrten
-- - Einige Fahrten ohne Fahrer
-- - 1-3 Gaeste pro Fahrt + gelegentlich 1-2 anonyme Gaeste
-- - Einige Fahrer auf aktiv/inaktiv/frei gesetzt
--
-- Ausfuehrung: Supabase SQL Editor

begin;

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ------------------------------------------------------------
-- 0) Fahrerbasis (alle nicht-Dispo-Profile)
-- ------------------------------------------------------------
create temporary table _demo_rides_drivers (
  rn int primary key,
  driver_id uuid not null,
  vehicle_id uuid,
  first_name text,
  last_name text,
  driver_number bigint
) on commit drop;

insert into _demo_rides_drivers (rn, driver_id, vehicle_id, first_name, last_name, driver_number)
select
  row_number() over (
    order by
      case when p.driver_number is null then 1 else 0 end,
      p.driver_number,
      p.id
  ) as rn,
  p.id as driver_id,
  p.vehicle_id,
  p.first_name,
  p.last_name,
  p.driver_number
from public.profiles p
where coalesce(p.is_dispo, false) = false
  and coalesce(lower(p.role), 'fahrer') not in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator');

do $$
begin
  if (select count(*) from _demo_rides_drivers) = 0 then
    raise exception 'Keine Fahrer in public.profiles gefunden (role != dispo/admin, is_dispo=false).';
  end if;
end
$$;

-- ------------------------------------------------------------
-- 1) Demo-Locations
-- ------------------------------------------------------------
create temporary table _demo_rides_locations (
  id int primary key,
  name text not null,
  address text not null
) on commit drop;

insert into _demo_rides_locations (id, name, address)
values
  (1, 'Hotel Bayerischer Hof', 'Prannerstrasse 6, 80333 Muenchen'),
  (2, 'Flughafen Terminal 2', 'Nordallee 25, 85356 Muenchen-Flughafen'),
  (3, 'BMW Museum', 'Am Olympiapark 2, 80809 Muenchen'),
  (4, 'Hotel Vier Jahreszeiten', 'Maximilianstrasse 17, 80539 Muenchen');

-- ------------------------------------------------------------
-- 2) Seed-Jobs vorbereiten (deterministische IDs)
-- ------------------------------------------------------------
create temporary table _demo_rides_jobs (
  job_id uuid primary key,
  rn int,
  slot int,
  driver_id uuid,
  vehicle_id uuid,
  trip_type text,
  pickup_name text,
  pickup_address text,
  dropoff_name text,
  dropoff_address text,
  ride_date date,
  etd time,
  original_etd time,
  status text,
  flight_number text,
  anonymous_guests int
) on commit drop;

with slots as (
  select 1 as slot
  union all
  select 2 as slot
),
base as (
  select
    d.rn,
    d.driver_id,
    d.vehicle_id,
    s.slot,
    ((d.rn * 11) % 540) as m1,
    (180 + ((d.rn * 13) % 600)) as m2_raw
  from _demo_rides_drivers d
  cross join slots s
),
times as (
  select
    b.*,
    case
      when b.slot = 1 then b.m1
      when b.m2_raw <= b.m1 then least(779, b.m1 + 120 + (b.rn % 90))
      else b.m2_raw
    end as minutes_from_1000
  from base b
),
typed as (
  select
    t.*,
    ((t.rn + t.slot) % 3 = 0) as is_airport,
    (array[1,3,4])[1 + ((t.rn + t.slot * 2) % 3)] as alt_loc_id,
    (array[1,3,4])[1 + ((t.rn + t.slot) % 3)] as pickup_non_id,
    (array[1,3,4])[1 + ((t.rn + t.slot + 1 + (t.rn % 2)) % 3)] as dropoff_non_id
  from times t
),
resolved as (
  select
    tt.*,
    case
      when tt.is_airport and ((tt.rn + tt.slot) % 2 = 0) then 2
      when tt.is_airport then tt.alt_loc_id
      else tt.pickup_non_id
    end as pickup_id,
    case
      when tt.is_airport and ((tt.rn + tt.slot) % 2 = 0) then tt.alt_loc_id
      when tt.is_airport then 2
      else
        case
          when tt.dropoff_non_id = tt.pickup_non_id
            then (array[1,3,4])[1 + ((tt.rn + tt.slot + 2) % 3)]
          else tt.dropoff_non_id
        end
    end as dropoff_id
  from typed tt
)
insert into _demo_rides_jobs (
  job_id,
  rn,
  slot,
  driver_id,
  vehicle_id,
  trip_type,
  pickup_name,
  pickup_address,
  dropoff_name,
  dropoff_address,
  ride_date,
  etd,
  original_etd,
  status,
  flight_number,
  anonymous_guests
)
select
  uuid_generate_v5(
    '6ba7b812-9dad-11d1-80b4-00c04fd430c8'::uuid,
    format('trisar-demo-ride-2026-03-05-%s-%s', r.driver_id, r.slot)
  ) as job_id,
  r.rn,
  r.slot,
  r.driver_id,
  r.vehicle_id,
  case when r.is_airport then 'airport' else 'normal' end as trip_type,
  lp.name,
  lp.address,
  ld.name,
  ld.address,
  date '2026-03-05' as ride_date,
  (time '10:00' + make_interval(mins => r.minutes_from_1000))::time as etd,
  case
    when r.is_airport
      then (time '10:00' + make_interval(mins => r.minutes_from_1000 - ((r.rn % 10) - 4)))::time
    else null
  end as original_etd,
  case
    when r.slot = 1 and r.rn <= 15 then 'in_progress'
    when (r.rn + r.slot) % 14 = 0 then 'refused'
    when (r.rn + r.slot) % 8 = 0 then 'done'
    when (r.rn + r.slot) % 5 = 0 then 'assigned'
    else 'pending'
  end as status,
  case
    when r.is_airport then format('LH%s', lpad(((100 + ((r.rn * (r.slot + 3)) % 900)))::text, 3, '0'))
    else null
  end as flight_number,
  case
    when (r.rn + r.slot) % 13 = 0 then 2
    when (r.rn + r.slot) % 7 = 0 then 1
    else 0
  end as anonymous_guests
from resolved r
join _demo_rides_locations lp on lp.id = r.pickup_id
join _demo_rides_locations ld on ld.id = r.dropoff_id;

-- Einige zusaetzliche unassigned Fahrten
insert into _demo_rides_jobs (
  job_id,
  rn,
  slot,
  driver_id,
  vehicle_id,
  trip_type,
  pickup_name,
  pickup_address,
  dropoff_name,
  dropoff_address,
  ride_date,
  etd,
  original_etd,
  status,
  flight_number,
  anonymous_guests
)
select
  uuid_generate_v5(
    '6ba7b812-9dad-11d1-80b4-00c04fd430c8'::uuid,
    format('trisar-demo-ride-2026-03-05-unassigned-%s', gs)
  ) as job_id,
  100000 + gs as rn,
  99 as slot,
  null as driver_id,
  null as vehicle_id,
  case when gs % 2 = 0 then 'airport' else 'normal' end as trip_type,
  lp.name,
  lp.address,
  ld.name,
  ld.address,
  date '2026-03-05' as ride_date,
  (time '10:00' + make_interval(mins => ((gs * 47) % 780)))::time as etd,
  null::time as original_etd,
  'pending' as status,
  case when gs % 2 = 0 then format('LH%s', lpad((700 + gs)::text, 3, '0')) else null end as flight_number,
  case when gs % 5 = 0 then 2 when gs % 3 = 0 then 1 else 0 end as anonymous_guests
from generate_series(1, 18) as gs
join _demo_rides_locations lp on lp.id = (array[1,2,3,4])[1 + ((gs + 1) % 4)]
join _demo_rides_locations ld on ld.id = (array[1,2,3,4])[1 + ((gs + 2) % 4)]
where lp.id <> ld.id;

-- ------------------------------------------------------------
-- 3) Jobs upserten (robust: nur Basisspalten hier)
-- ------------------------------------------------------------
insert into public.jobs (
  id,
  driver_id,
  pickup_name,
  pickup_address,
  dropoff_name,
  dropoff_address,
  ride_date,
  etd,
  status,
  created_at,
  updated_at
)
select
  j.job_id,
  j.driver_id,
  j.pickup_name,
  j.pickup_address,
  j.dropoff_name,
  j.dropoff_address,
  j.ride_date,
  j.etd,
  j.status,
  now(),
  now()
from _demo_rides_jobs j
on conflict (id) do update
set
  driver_id = excluded.driver_id,
  pickup_name = excluded.pickup_name,
  pickup_address = excluded.pickup_address,
  dropoff_name = excluded.dropoff_name,
  dropoff_address = excluded.dropoff_address,
  ride_date = excluded.ride_date,
  etd = excluded.etd,
  status = excluded.status,
  updated_at = now();

-- Optionale jobs-Spalten setzen (nur wenn vorhanden)
do $$
declare
  has_vehicle_id boolean;
  has_trip_type boolean;
  has_original_etd boolean;
  has_flight_number boolean;
  has_anonymous_guests boolean;
  has_route boolean;
  has_flight_origin boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'vehicle_id'
  ) into has_vehicle_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'trip_type'
  ) into has_trip_type;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'original_etd'
  ) into has_original_etd;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'flight_number'
  ) into has_flight_number;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'anonymous_guests'
  ) into has_anonymous_guests;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'route'
  ) into has_route;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'flight_origin'
  ) into has_flight_origin;

  if has_vehicle_id then
    update public.jobs db
    set vehicle_id = src.vehicle_id
    from _demo_rides_jobs src
    where db.id = src.job_id;
  end if;

  if has_trip_type then
    update public.jobs db
    set trip_type = src.trip_type
    from _demo_rides_jobs src
    where db.id = src.job_id;
  end if;

  if has_original_etd then
    update public.jobs db
    set original_etd = src.original_etd
    from _demo_rides_jobs src
    where db.id = src.job_id;
  end if;

  if has_flight_number then
    update public.jobs db
    set flight_number = src.flight_number
    from _demo_rides_jobs src
    where db.id = src.job_id;
  end if;

  if has_anonymous_guests then
    update public.jobs db
    set anonymous_guests = src.anonymous_guests
    from _demo_rides_jobs src
    where db.id = src.job_id;
  end if;

  if has_route then
    update public.jobs db
    set route = concat_ws(' - ', src.pickup_name, src.dropoff_name)
    from _demo_rides_jobs src
    where db.id = src.job_id;
  end if;

  if has_flight_origin then
    update public.jobs db
    set flight_origin = 'demo_seed_2026_03_05'
    from _demo_rides_jobs src
    where db.id = src.job_id;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 4) Konvois (3 Fahrer pro Konvoi-Fahrt)
-- ------------------------------------------------------------
create table if not exists public.convoys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists public.convoy_assignments (
  job_id uuid not null,
  driver_id uuid not null,
  response_status text not null default 'pending',
  responded_at timestamptz,
  refusal_reason text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  primary key (job_id, driver_id)
);

alter table public.convoy_assignments
  add column if not exists response_status text default 'pending',
  add column if not exists responded_at timestamptz,
  add column if not exists refusal_reason text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create temporary table _demo_rides_convoy_groups (
  convoy_no int,
  pos int,
  driver_id uuid
) on commit drop;

insert into _demo_rides_convoy_groups (convoy_no, pos, driver_id)
select
  ((d.rn - 1) / 3) + 1 as convoy_no,
  row_number() over (partition by ((d.rn - 1) / 3) + 1 order by d.rn) as pos,
  d.driver_id
from _demo_rides_drivers d
where d.rn <= least((select count(*) from _demo_rides_drivers), 30);

create temporary table _demo_rides_convoy_jobs (
  convoy_no int primary key,
  convoy_id uuid not null,
  lead_driver_id uuid not null,
  job_id uuid not null
) on commit drop;

insert into _demo_rides_convoy_jobs (convoy_no, convoy_id, lead_driver_id, job_id)
select
  g.convoy_no,
  uuid_generate_v5(
    '6ba7b812-9dad-11d1-80b4-00c04fd430c8'::uuid,
    format('trisar-demo-convoy-2026-03-05-%s', g.convoy_no)
  ) as convoy_id,
  lead.driver_id as lead_driver_id,
  job.job_id
from (
  select distinct convoy_no from _demo_rides_convoy_groups
) g
join lateral (
  select driver_id
  from _demo_rides_convoy_groups
  where convoy_no = g.convoy_no and pos = 1
  limit 1
) lead on true
join _demo_rides_jobs job
  on job.driver_id = lead.driver_id
 and job.slot = 2;

insert into public.convoys (id, name, created_at)
select
  c.convoy_id,
  format('Konvoi %s', lpad(c.convoy_no::text, 2, '0')),
  now()
from _demo_rides_convoy_jobs c
on conflict (id) do update
set name = excluded.name;

update public.jobs j
set convoy_id = c.convoy_id,
    status = case when lower(j.status) = 'in_progress' then j.status else 'pending' end,
    updated_at = now()
from _demo_rides_convoy_jobs c
where j.id = c.job_id;

-- Alte Zuweisungen fuer diese Konvoi-Jobs entfernen, dann neu aufbauen.
delete from public.convoy_assignments a
using _demo_rides_convoy_jobs c
where a.job_id = c.job_id;

insert into public.convoy_assignments (
  job_id,
  driver_id,
  response_status,
  responded_at,
  refusal_reason,
  created_at,
  updated_at
)
select
  c.job_id,
  g.driver_id,
  case
    when g.pos = 1 then 'accepted'
    when g.pos = 2 and c.convoy_no % 4 = 0 then 'refused'
    when g.pos = 2 then 'pending'
    when g.pos = 3 and c.convoy_no % 5 = 0 then 'refused'
    else 'accepted'
  end as response_status,
  case
    when g.pos = 2 and c.convoy_no % 4 = 0 then now() - interval '10 minutes'
    when g.pos = 3 and c.convoy_no % 5 = 0 then now() - interval '7 minutes'
    when g.pos = 1 or g.pos = 3 then now() - interval '4 minutes'
    else null
  end as responded_at,
  case
    when g.pos = 2 and c.convoy_no % 4 = 0 then 'Keine Zeit'
    when g.pos = 3 and c.convoy_no % 5 = 0 then 'Zu weit entfernt'
    else null
  end as refusal_reason,
  now(),
  now()
from _demo_rides_convoy_groups g
join _demo_rides_convoy_jobs c on c.convoy_no = g.convoy_no
where g.pos <= 3;

-- ------------------------------------------------------------
-- 5) Gaeste pro Job (1-3) + passengers payload + anonymous guests
-- ------------------------------------------------------------
-- Falls keine Gaeste existieren, kleine Basis erzeugen.
do $$
begin
  if (select count(*) from public.guests) = 0 then
    insert into public.guests (first_name, last_name, email, phone)
    select
      (array['Lena','Mia','Sofia','Noah','Luca','Ben','Paul','Emma','Lea','Finn'])[1 + ((gs - 1) % 10)] as first_name,
      (array['Mueller','Weber','Schmidt','Wagner','Becker','Fischer','Schneider','Krause','Wolf','Klein'])[1 + ((gs - 1) % 10)] as last_name,
      format('demo.gast.%s@gast-demo.local', lpad(gs::text, 3, '0')) as email,
      format('+49 160 %07s', 3000000 + gs) as phone
    from generate_series(1, 60) as gs;
  end if;
end
$$;

create temporary table _demo_rides_guests (
  rn int primary key,
  guest_id uuid not null,
  guest_name text not null
) on commit drop;

insert into _demo_rides_guests (rn, guest_id, guest_name)
select
  row_number() over (order by g.id) as rn,
  g.id,
  trim(concat_ws(' ', g.first_name, g.last_name)) as guest_name
from public.guests g
where trim(concat_ws(' ', g.first_name, g.last_name)) <> '';

create temporary table _demo_rides_job_guest_links (
  job_id uuid not null,
  guest_id uuid not null,
  is_main_contact boolean not null,
  position int not null,
  primary key (job_id, guest_id)
) on commit drop;

with ordered_jobs as (
  select
    j.job_id,
    row_number() over (order by j.etd, j.rn, j.slot, j.job_id) as seq,
    (1 + ((row_number() over (order by j.etd, j.rn, j.slot, j.job_id)) % 3)) as guest_count
  from _demo_rides_jobs j
)
insert into _demo_rides_job_guest_links (job_id, guest_id, is_main_contact, position)
select
  oj.job_id,
  g.guest_id,
  (pos = 1) as is_main_contact,
  pos as position
from ordered_jobs oj
cross join lateral generate_series(1, oj.guest_count) as pos
join _demo_rides_guests g
  on g.rn = (((oj.seq - 1) * 3 + (pos - 1)) % (select count(*) from _demo_rides_guests)) + 1;

-- Alte Guest-Links fuer diese Seed-Jobs ersetzen.
delete from public.job_guests jg
using _demo_rides_jobs sj
where jg.job_id = sj.job_id;

insert into public.job_guests (job_id, guest_id, is_main_contact)
select job_id, guest_id, is_main_contact
from _demo_rides_job_guest_links;

create temporary table _demo_rides_passenger_payload (
  job_id uuid not null,
  idx int not null,
  guest_name text not null
) on commit drop;

insert into _demo_rides_passenger_payload (job_id, idx, guest_name)
select
  l.job_id,
  row_number() over (partition by l.job_id order by l.is_main_contact desc, l.position, l.guest_id) as idx,
  g.guest_name
from _demo_rides_job_guest_links l
join _demo_rides_guests g on g.guest_id = l.guest_id;

-- passengers-Typ robust setzen (jsonb / text[] / text)
do $$
declare
  passengers_data_type text;
  passengers_udt text;
  has_anonymous_guests boolean;
begin
  select c.data_type, c.udt_name
    into passengers_data_type, passengers_udt
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'jobs'
    and c.column_name = 'passengers';

  if passengers_data_type = 'jsonb' then
    update public.jobs j
    set passengers = coalesce(p.payload, '{}'::jsonb)
    from (
      select
        pp.job_id,
        jsonb_object_agg(format('guest_%s', pp.idx), pp.guest_name order by pp.idx) as payload
      from _demo_rides_passenger_payload pp
      group by pp.job_id
    ) p
    where j.id = p.job_id;

  elsif passengers_data_type = 'ARRAY' or passengers_udt = '_text' then
    update public.jobs j
    set passengers = p.payload
    from (
      select
        pp.job_id,
        array_agg(pp.guest_name order by pp.idx) as payload
      from _demo_rides_passenger_payload pp
      group by pp.job_id
    ) p
    where j.id = p.job_id;

  elsif passengers_data_type = 'text' then
    update public.jobs j
    set passengers = p.payload
    from (
      select
        pp.job_id,
        string_agg(pp.guest_name, ', ' order by pp.idx) as payload
      from _demo_rides_passenger_payload pp
      group by pp.job_id
    ) p
    where j.id = p.job_id;
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'jobs' and column_name = 'anonymous_guests'
  ) into has_anonymous_guests;

  if has_anonymous_guests then
    update public.jobs j
    set anonymous_guests = src.anonymous_guests
    from _demo_rides_jobs src
    where j.id = src.job_id;
  end if;
end
$$;

-- ------------------------------------------------------------
-- 6) Fahrerstatus + aktive Jobs in live locations
-- ------------------------------------------------------------
create temporary table _demo_rides_active_jobs (
  driver_id uuid primary key,
  job_id uuid not null
) on commit drop;

insert into _demo_rides_active_jobs (driver_id, job_id)
select distinct on (j.driver_id)
  j.driver_id,
  j.job_id
from _demo_rides_jobs j
where j.driver_id is not null
  and lower(j.status) = 'in_progress'
order by j.driver_id, j.etd;

-- Falls active_job_id existiert: setzen
-- (lat/lng bleiben unveraendert)
do $$
declare
  has_active_job_id boolean;
  has_captured_at boolean;
  has_updated_at boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'driver_live_locations' and column_name = 'active_job_id'
  ) into has_active_job_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'driver_live_locations' and column_name = 'captured_at'
  ) into has_captured_at;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'driver_live_locations' and column_name = 'updated_at'
  ) into has_updated_at;

  if has_active_job_id then
    if has_captured_at and has_updated_at then
      update public.driver_live_locations l
      set
        active_job_id = a.job_id,
        captured_at = now(),
        updated_at = now()
      from _demo_rides_active_jobs a
      where l.driver_id = a.driver_id;

      update public.driver_live_locations l
      set
        active_job_id = null,
        updated_at = now()
      where l.driver_id in (select driver_id from _demo_rides_drivers)
        and l.driver_id not in (select driver_id from _demo_rides_active_jobs);
    elsif has_captured_at then
      update public.driver_live_locations l
      set
        active_job_id = a.job_id,
        captured_at = now()
      from _demo_rides_active_jobs a
      where l.driver_id = a.driver_id;

      update public.driver_live_locations l
      set active_job_id = null
      where l.driver_id in (select driver_id from _demo_rides_drivers)
        and l.driver_id not in (select driver_id from _demo_rides_active_jobs);
    elsif has_updated_at then
      update public.driver_live_locations l
      set
        active_job_id = a.job_id,
        updated_at = now()
      from _demo_rides_active_jobs a
      where l.driver_id = a.driver_id;

      update public.driver_live_locations l
      set
        active_job_id = null,
        updated_at = now()
      where l.driver_id in (select driver_id from _demo_rides_drivers)
        and l.driver_id not in (select driver_id from _demo_rides_active_jobs);
    else
      update public.driver_live_locations l
      set active_job_id = a.job_id
      from _demo_rides_active_jobs a
      where l.driver_id = a.driver_id;

      update public.driver_live_locations l
      set active_job_id = null
      where l.driver_id in (select driver_id from _demo_rides_drivers)
        and l.driver_id not in (select driver_id from _demo_rides_active_jobs);
    end if;
  end if;
end
$$;

-- Profile-Zustaende und Dienstfenster nur setzen, wenn Spalten existieren.
do $$
declare
  has_activity_state boolean;
  has_activity_state_updated_at boolean;
  has_service_start boolean;
  has_service_end boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'driver_activity_state'
  ) into has_activity_state;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'driver_activity_state_updated_at'
  ) into has_activity_state_updated_at;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'service_start_time'
  ) into has_service_start;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'service_end_time'
  ) into has_service_end;

  if has_activity_state then
    update public.profiles p
    set driver_activity_state = 'frei'
    where p.id in (select driver_id from _demo_rides_drivers);

    update public.profiles p
    set driver_activity_state = 'aktiv'
    where p.id in (select driver_id from _demo_rides_active_jobs);

    update public.profiles p
    set driver_activity_state = 'inaktiv'
    where p.id in (
      select d.driver_id
      from _demo_rides_drivers d
      where d.driver_id not in (select driver_id from _demo_rides_active_jobs)
        and d.rn % 4 = 0
    );
  end if;

  if has_activity_state and has_activity_state_updated_at then
    update public.profiles p
    set driver_activity_state_updated_at = now()
    where p.id in (select driver_id from _demo_rides_drivers);
  end if;

  if has_service_start then
    update public.profiles p
    set service_start_time = (time '09:00' + make_interval(mins => ((d.rn * 7) % 120)))::time
    from _demo_rides_drivers d
    where p.id = d.driver_id;
  end if;

  if has_service_end then
    update public.profiles p
    set service_end_time = (time '18:00' + make_interval(mins => ((d.rn * 5) % 240)))::time
    from _demo_rides_drivers d
    where p.id = d.driver_id;
  end if;
end
$$;

-- ------------------------------------------------------------
-- Ergebnis-Check
-- ------------------------------------------------------------
select
  (select count(*) from _demo_rides_drivers) as drivers_in_scope,
  (select count(*) from _demo_rides_jobs where driver_id is not null) as seeded_driver_jobs,
  (select count(*) from _demo_rides_jobs where driver_id is null) as seeded_unassigned_jobs,
  (select count(*) from _demo_rides_convoy_jobs) as convoy_jobs,
  (select count(*) from _demo_rides_active_jobs) as active_drivers,
  (select count(*) from _demo_rides_job_guest_links) as guest_links_written;

commit;
