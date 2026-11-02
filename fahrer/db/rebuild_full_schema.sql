-- Trisar full schema rebuild (idempotent)
-- Run in Supabase SQL Editor.

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- ---------- shared helper ----------
create or replace function public.trisar_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- core domain ----------
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  brand_model text not null,
  trim text,
  vin text unique,
  license_plate text unique,
  color text,
  seat_count integer,
  fuel_type text,
  image_url text,
  range_km integer,
  battery_fuel_percent integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_vehicles_updated_at on public.vehicles;
create trigger trg_vehicles_updated_at
before update on public.vehicles
for each row execute function public.trisar_set_updated_at();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  avatar_url text,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  role text default 'fahrer',
  is_dispo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.trisar_set_updated_at();

create table if not exists public.guests (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  email text,
  phone text,
  company text,
  street text,
  street_number text,
  city text,
  zip text,
  language text default 'Deutsch',
  notes text,
  note_text text,
  is_vip boolean default false,
  vip_status boolean default false,
  needs_accessibility boolean default false,
  needs_child_seat boolean default false,
  needs_second_child_seat boolean default false,
  needs_luggage boolean default false,
  rides_count integer default 0,
  trip_count integer default 0,
  ride_count integer default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_guests_updated_at on public.guests;
create trigger trg_guests_updated_at
before update on public.guests
for each row execute function public.trisar_set_updated_at();

create table if not exists public.convoys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid references public.profiles(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  convoy_id uuid references public.convoys(id) on delete set null,
  trip_type text not null default 'normal',
  pickup_name text,
  pickup_address text not null,
  dropoff_name text,
  dropoff_address text not null,
  ride_date date default current_date,
  etd time,
  original_etd time,
  flight_number text,
  flight_origin text,
  passengers text[] not null default '{}',
  waiting_time_mins integer not null default 0,
  status text not null default 'pending',
  is_vip boolean not null default false,
  needs_child_seat boolean not null default false,
  needs_accessibility boolean not null default false,
  needs_luggage boolean not null default false,
  refusal_reason text,
  refused_by_driver_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_jobs_updated_at on public.jobs;
create trigger trg_jobs_updated_at
before update on public.jobs
for each row execute function public.trisar_set_updated_at();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_status_check') then
    alter table public.jobs
      add constraint jobs_status_check
      check (status in ('pending', 'assigned', 'at_pickup', 'in_progress', 'done', 'cancelled', 'refused'));
  end if;
end $$;

create index if not exists idx_jobs_driver_created on public.jobs(driver_id, created_at desc);
create index if not exists idx_jobs_convoy on public.jobs(convoy_id);
create index if not exists idx_jobs_ride_date on public.jobs(ride_date);
create index if not exists idx_jobs_status on public.jobs(status);

create table if not exists public.job_guests (
  job_id uuid not null references public.jobs(id) on delete cascade,
  guest_id uuid not null references public.guests(id) on delete cascade,
  is_main_contact boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (job_id, guest_id)
);

create index if not exists idx_job_guests_guest on public.job_guests(guest_id);

create table if not exists public.job_notes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  note_text text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_notes_job_created on public.job_notes(job_id, created_at desc);

create table if not exists public.convoy_assignments (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  guest_ids uuid[] not null default '{}',
  guest_names text[] not null default '{}',
  response_status text not null default 'pending',
  responded_at timestamptz,
  refusal_reason text,
  created_at timestamptz not null default now(),
  unique (job_id, driver_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'convoy_assignments_response_status_check') then
    alter table public.convoy_assignments
      add constraint convoy_assignments_response_status_check
      check (response_status in ('pending', 'accepted', 'refused'));
  end if;
end $$;

create index if not exists idx_convoy_assignments_job_id on public.convoy_assignments(job_id);
create index if not exists idx_convoy_assignments_driver_id on public.convoy_assignments(driver_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  content text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'messages_target_type_check') then
    alter table public.messages
      add constraint messages_target_type_check
      check (target_type in ('group', 'direct'));
  end if;
end $$;

create index if not exists idx_messages_target on public.messages(target_type, target_id, created_at desc);
create index if not exists idx_messages_sender on public.messages(sender_id, created_at desc);

create table if not exists public.chat_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  chat_type text not null,
  chat_id uuid not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, chat_type, chat_id)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_reads_chat_type_check') then
    alter table public.chat_reads
      add constraint chat_reads_chat_type_check
      check (chat_type in ('group', 'direct'));
  end if;
end $$;

create index if not exists idx_chat_reads_chat on public.chat_reads(chat_type, chat_id);

create table if not exists public.vehicle_damages (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  report_date date not null default current_date,
  part_name text not null,
  description text,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicle_damages_vehicle_date on public.vehicle_damages(vehicle_id, report_date desc);

-- ---------- API centralization + location ----------
create table if not exists public.integration_settings (
  key text primary key,
  value jsonb not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_integration_settings_updated_at on public.integration_settings;
create trigger trg_integration_settings_updated_at
before update on public.integration_settings
for each row execute function public.trisar_set_updated_at();

insert into public.integration_settings(key, value, description) values
  ('flight_cache_ttl_minutes', '15'::jsonb, 'TTL for aviation cache'),
  ('route_cache_ttl_minutes', '10'::jsonb, 'TTL for route cache'),
  ('manual_refresh_cooldown_seconds', '60'::jsonb, 'Cooldown between manual refresh calls per job')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

create table if not exists public.api_flight_cache (
  flight_key text primary key,
  flight_iata text not null,
  ride_date date,
  etd time,
  original_etd time,
  flight_origin text,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_api_flight_cache_updated_at on public.api_flight_cache;
create trigger trg_api_flight_cache_updated_at
before update on public.api_flight_cache
for each row execute function public.trisar_set_updated_at();

create index if not exists idx_api_flight_cache_expires_at on public.api_flight_cache(expires_at);

create table if not exists public.api_route_cache (
  route_key text primary key,
  provider text not null default 'google_routes',
  origin_address text not null,
  destination_address text not null,
  departure_bucket timestamptz,
  distance_m integer,
  duration_mins integer,
  duration_in_traffic_mins integer,
  polyline text,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_api_route_cache_updated_at on public.api_route_cache;
create trigger trg_api_route_cache_updated_at
before update on public.api_route_cache
for each row execute function public.trisar_set_updated_at();

create index if not exists idx_api_route_cache_expires_at on public.api_route_cache(expires_at);
create index if not exists idx_api_route_cache_departure_bucket on public.api_route_cache(departure_bucket);

create table if not exists public.job_refresh_requests (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  reason text not null check (reason in ('create', 'manual_refresh', 'live_view')),
  requested_by uuid references public.profiles(id) on delete set null,
  force_refresh boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  error_text text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists idx_job_refresh_requests_job_created on public.job_refresh_requests(job_id, created_at desc);
create unique index if not exists idx_job_refresh_requests_dedupe_open
  on public.job_refresh_requests(job_id, reason)
  where status in ('queued', 'running');

create table if not exists public.api_usage_events (
  id bigserial primary key,
  job_id uuid references public.jobs(id) on delete set null,
  provider text not null,
  action text not null,
  reason text not null check (reason in ('create', 'manual_refresh', 'live_view')),
  cache_hit boolean not null default false,
  requested_by uuid references public.profiles(id) on delete set null,
  http_status integer,
  error_text text,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_usage_events_created_at on public.api_usage_events(created_at desc);
create index if not exists idx_api_usage_events_job_id on public.api_usage_events(job_id);

create table if not exists public.ai_token_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  tokens_used int4 not null check (tokens_used >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_token_usage_user_created on public.ai_token_usage(user_id, created_at desc);
create index if not exists idx_ai_token_usage_service_created on public.ai_token_usage(service, created_at desc);

create or replace view public.v_ai_token_usage_by_user as
select
  user_id,
  service,
  sum(tokens_used)::bigint as total_tokens,
  count(*)::bigint as requests,
  min(created_at) as first_used_at,
  max(created_at) as last_used_at
from public.ai_token_usage
group by user_id, service;

create table if not exists public.driver_live_locations (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  active_job_id uuid references public.jobs(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  speed_mps double precision,
  heading_deg double precision,
  source text not null default 'manual_refresh',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_location_history (
  id bigserial primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  speed_mps double precision,
  heading_deg double precision,
  source text not null default 'manual_refresh',
  captured_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'driver_live_locations_lat_lng_chk') then
    alter table public.driver_live_locations
      add constraint driver_live_locations_lat_lng_chk
      check (lat between -90 and 90 and lng between -180 and 180);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'driver_location_history_lat_lng_chk') then
    alter table public.driver_location_history
      add constraint driver_location_history_lat_lng_chk
      check (lat between -90 and 90 and lng between -180 and 180);
  end if;
end $$;

drop trigger if exists trg_driver_live_locations_updated_at on public.driver_live_locations;
create trigger trg_driver_live_locations_updated_at
before update on public.driver_live_locations
for each row execute function public.trisar_set_updated_at();

create index if not exists idx_driver_location_history_driver_time on public.driver_location_history(driver_id, captured_at desc);
create index if not exists idx_driver_live_locations_job on public.driver_live_locations(active_job_id);

-- ---------- jobs enrichment columns ----------
alter table public.jobs
  add column if not exists ext_last_enriched_at timestamptz,
  add column if not exists ext_last_enriched_by uuid references public.profiles(id) on delete set null,
  add column if not exists ext_last_enrich_reason text,
  add column if not exists ext_last_error text,
  add column if not exists ext_flight_last_sync_at timestamptz,
  add column if not exists ext_flight_payload jsonb,
  add column if not exists ext_route_provider text,
  add column if not exists ext_route_distance_m integer,
  add column if not exists ext_route_duration_mins integer,
  add column if not exists ext_route_duration_in_traffic_mins integer,
  add column if not exists ext_route_polyline text,
  add column if not exists ext_route_payload jsonb,
  add column if not exists ext_driver_to_pickup_provider text,
  add column if not exists ext_driver_to_pickup_distance_m integer,
  add column if not exists ext_driver_to_pickup_duration_mins integer,
  add column if not exists ext_driver_to_pickup_duration_in_traffic_mins integer,
  add column if not exists ext_driver_to_pickup_polyline text,
  add column if not exists ext_driver_to_pickup_payload jsonb,
  add column if not exists ext_driver_to_pickup_last_sync_at timestamptz,
  add column if not exists ext_driver_to_dropoff_provider text,
  add column if not exists ext_driver_to_dropoff_distance_m integer,
  add column if not exists ext_driver_to_dropoff_duration_mins integer,
  add column if not exists ext_driver_to_dropoff_duration_in_traffic_mins integer,
  add column if not exists ext_driver_to_dropoff_polyline text,
  add column if not exists ext_driver_to_dropoff_payload jsonb,
  add column if not exists ext_driver_to_dropoff_last_sync_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'jobs_ext_last_enrich_reason_chk') then
    alter table public.jobs
      add constraint jobs_ext_last_enrich_reason_chk
      check (ext_last_enrich_reason in ('create', 'manual_refresh', 'live_view') or ext_last_enrich_reason is null);
  end if;
end $$;

create index if not exists idx_jobs_ext_last_enriched_at on public.jobs(ext_last_enriched_at desc);
create index if not exists idx_jobs_ext_last_reason on public.jobs(ext_last_enrich_reason);

-- ---------- views ----------
create or replace view public.v_dispo_driver_live as
select
  dll.driver_id,
  coalesce(
    nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''),
    'Fahrer ' || left(dll.driver_id::text, 8)
  ) as driver_name,
  dll.active_job_id,
  j.status as job_status,
  j.pickup_name,
  j.dropoff_name,
  j.pickup_address,
  j.dropoff_address,
  j.etd,
  j.ext_route_duration_in_traffic_mins,
  j.ext_route_duration_mins,
  j.ext_route_polyline,
  dll.lat,
  dll.lng,
  dll.accuracy_m,
  dll.speed_mps,
  dll.heading_deg,
  dll.source,
  dll.captured_at,
  dll.updated_at
from public.driver_live_locations dll
left join public.profiles p on p.id = dll.driver_id
left join public.jobs j on j.id = dll.active_job_id;

-- ---------- RLS ----------
alter table public.vehicles enable row level security;
alter table public.profiles enable row level security;
alter table public.guests enable row level security;
alter table public.convoys enable row level security;
alter table public.jobs enable row level security;
alter table public.job_guests enable row level security;
alter table public.job_notes enable row level security;
alter table public.convoy_assignments enable row level security;
alter table public.messages enable row level security;
alter table public.chat_reads enable row level security;
alter table public.vehicle_damages enable row level security;
alter table public.integration_settings enable row level security;
alter table public.api_flight_cache enable row level security;
alter table public.api_route_cache enable row level security;
alter table public.job_refresh_requests enable row level security;
alter table public.api_usage_events enable row level security;
alter table public.ai_token_usage enable row level security;
alter table public.driver_live_locations enable row level security;
alter table public.driver_location_history enable row level security;

-- dev-friendly authenticated access
do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'vehicles','profiles','guests','convoys','jobs','job_guests','job_notes',
    'convoy_assignments','messages','chat_reads','vehicle_damages'
  ]
  loop
    execute format('drop policy if exists p_%s_auth_all on public.%I', tbl, tbl);
    execute format('create policy p_%s_auth_all on public.%I for all to authenticated using (true) with check (true)', tbl, tbl);

    execute format('drop policy if exists p_%s_service_all on public.%I', tbl, tbl);
    execute format('create policy p_%s_service_all on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')', tbl, tbl);
  end loop;
end $$;

drop policy if exists p_integration_settings_service_only on public.integration_settings;
create policy p_integration_settings_service_only
on public.integration_settings
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_api_flight_cache_service_only on public.api_flight_cache;
create policy p_api_flight_cache_service_only
on public.api_flight_cache
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_api_route_cache_service_only on public.api_route_cache;
create policy p_api_route_cache_service_only
on public.api_route_cache
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_api_usage_events_service_only on public.api_usage_events;
create policy p_api_usage_events_service_only
on public.api_usage_events
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_ai_token_usage_service_all on public.ai_token_usage;
create policy p_ai_token_usage_service_all
on public.ai_token_usage
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_ai_token_usage_select_own on public.ai_token_usage;
create policy p_ai_token_usage_select_own
on public.ai_token_usage
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists p_job_refresh_requests_service_all on public.job_refresh_requests;
create policy p_job_refresh_requests_service_all
on public.job_refresh_requests
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_job_refresh_requests_insert_manual on public.job_refresh_requests;
create policy p_job_refresh_requests_insert_manual
on public.job_refresh_requests
for insert
to authenticated
with check (reason in ('manual_refresh', 'live_view') and requested_by = auth.uid());

drop policy if exists p_job_refresh_requests_select_own on public.job_refresh_requests;
create policy p_job_refresh_requests_select_own
on public.job_refresh_requests
for select
to authenticated
using (requested_by = auth.uid());

drop policy if exists p_driver_live_locations_select_authenticated on public.driver_live_locations;
create policy p_driver_live_locations_select_authenticated
on public.driver_live_locations
for select
to authenticated
using (true);

drop policy if exists p_driver_live_locations_insert_own on public.driver_live_locations;
create policy p_driver_live_locations_insert_own
on public.driver_live_locations
for insert
to authenticated
with check (driver_id = auth.uid());

drop policy if exists p_driver_live_locations_update_own on public.driver_live_locations;
create policy p_driver_live_locations_update_own
on public.driver_live_locations
for update
to authenticated
using (driver_id = auth.uid())
with check (driver_id = auth.uid());

drop policy if exists p_driver_live_locations_service_all on public.driver_live_locations;
create policy p_driver_live_locations_service_all
on public.driver_live_locations
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_driver_location_history_select_authenticated on public.driver_location_history;
create policy p_driver_location_history_select_authenticated
on public.driver_location_history
for select
to authenticated
using (true);

drop policy if exists p_driver_location_history_insert_own on public.driver_location_history;
create policy p_driver_location_history_insert_own
on public.driver_location_history
for insert
to authenticated
with check (driver_id = auth.uid());

drop policy if exists p_driver_location_history_service_all on public.driver_location_history;
create policy p_driver_location_history_service_all
on public.driver_location_history
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop function if exists public.email_exists_for_password_reset(text);
create function public.email_exists_for_password_reset(p_email text)
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select exists (
    select 1
    from auth.users u
    where lower(coalesce(u.email, '')) = lower(trim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.email_exists_for_password_reset(text) from public;
grant execute on function public.email_exists_for_password_reset(text) to anon, authenticated, service_role;

grant select on public.v_dispo_driver_live to authenticated;
grant select on public.v_ai_token_usage_by_user to authenticated;

grant select, insert, update, delete on public.vehicles to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.guests to authenticated;
grant select, insert, update, delete on public.convoys to authenticated;
grant select, insert, update, delete on public.jobs to authenticated;
grant select, insert, update, delete on public.job_guests to authenticated;
grant select, insert, update, delete on public.job_notes to authenticated;
grant select, insert, update, delete on public.convoy_assignments to authenticated;
grant select, insert, update, delete on public.messages to authenticated;
grant select, insert, update, delete on public.chat_reads to authenticated;
grant select, insert, update, delete on public.vehicle_damages to authenticated;
grant select, insert on public.driver_location_history to authenticated;
grant select, insert, update on public.driver_live_locations to authenticated;
grant select, insert on public.job_refresh_requests to authenticated;
grant select on public.ai_token_usage to authenticated;

-- ---------- realtime ----------
do $$
begin
  begin
    alter publication supabase_realtime add table public.jobs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.messages;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.convoy_assignments;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.driver_live_locations;
  exception when duplicate_object then null;
  end;
end $$;
