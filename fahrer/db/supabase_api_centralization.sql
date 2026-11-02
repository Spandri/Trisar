-- ==========================================
-- Trisar: Supabase API-Zentralisierung + Live-Standort
-- Idempotent gehalten (für SQL Editor)
-- ==========================================

create extension if not exists pgcrypto;

-- ---------- Helper trigger ----------
create or replace function public.trisar_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- 1) Jobs: Enrichment-Metadaten ----------
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
  if not exists (
    select 1
    from pg_constraint
    where conname = 'jobs_ext_last_enrich_reason_chk'
  ) then
    alter table public.jobs
      add constraint jobs_ext_last_enrich_reason_chk
      check (ext_last_enrich_reason in ('create', 'manual_refresh', 'live_view') or ext_last_enrich_reason is null);
  end if;
end $$;

create index if not exists idx_jobs_ext_last_enriched_at on public.jobs(ext_last_enriched_at desc);
create index if not exists idx_jobs_ext_last_reason on public.jobs(ext_last_enrich_reason);

-- ---------- 2) Runtime-Settings ----------
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

-- ---------- 3) Flight cache ----------
create table if not exists public.api_flight_cache (
  flight_key text primary key, -- e.g. LH123:2026-02-27
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

-- ---------- 4) Route cache ----------
create table if not exists public.api_route_cache (
  route_key text primary key, -- normalized hash key from origin+destination+time bucket
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

-- ---------- 5) Refresh-Requests (Audit + Dedupe) ----------
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

create index if not exists idx_job_refresh_requests_job_created
  on public.job_refresh_requests(job_id, created_at desc);

create unique index if not exists idx_job_refresh_requests_dedupe_open
  on public.job_refresh_requests(job_id, reason)
  where status in ('queued', 'running');

-- ---------- 6) Usage-Events ----------
create table if not exists public.api_usage_events (
  id bigserial primary key,
  job_id uuid references public.jobs(id) on delete set null,
  provider text not null,
  action text not null, -- flight_lookup, route_lookup, places_lookup
  reason text not null check (reason in ('create', 'manual_refresh', 'live_view')),
  cache_hit boolean not null default false,
  requested_by uuid references public.profiles(id) on delete set null,
  http_status integer,
  error_text text,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_usage_events_created_at on public.api_usage_events(created_at desc);
create index if not exists idx_api_usage_events_job_id on public.api_usage_events(job_id);

-- ---------- 6b) AI Token Usage ----------
create table if not exists public.ai_token_usage (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  service text not null,
  tokens_used int4 not null check (tokens_used >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_token_usage_user_created
  on public.ai_token_usage(user_id, created_at desc);
create index if not exists idx_ai_token_usage_service_created
  on public.ai_token_usage(service, created_at desc);

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

-- ---------- 7) Fahrer Live-Standort + Historie ----------
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
  if not exists (
    select 1 from pg_constraint where conname = 'driver_live_locations_lat_lng_chk'
  ) then
    alter table public.driver_live_locations
      add constraint driver_live_locations_lat_lng_chk
      check (lat between -90 and 90 and lng between -180 and 180);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'driver_location_history_lat_lng_chk'
  ) then
    alter table public.driver_location_history
      add constraint driver_location_history_lat_lng_chk
      check (lat between -90 and 90 and lng between -180 and 180);
  end if;
end $$;

drop trigger if exists trg_driver_live_locations_updated_at on public.driver_live_locations;
create trigger trg_driver_live_locations_updated_at
before update on public.driver_live_locations
for each row execute function public.trisar_set_updated_at();

create index if not exists idx_driver_location_history_driver_time
  on public.driver_location_history(driver_id, captured_at desc);

create index if not exists idx_driver_live_locations_job
  on public.driver_live_locations(active_job_id);

-- ---------- 8) View für spätere Dispo-Karte ----------
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

-- ---------- 9) RLS ----------
alter table public.integration_settings enable row level security;
alter table public.api_flight_cache enable row level security;
alter table public.api_route_cache enable row level security;
alter table public.job_refresh_requests enable row level security;
alter table public.api_usage_events enable row level security;
alter table public.ai_token_usage enable row level security;
alter table public.driver_live_locations enable row level security;
alter table public.driver_location_history enable row level security;

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
with check (
  reason in ('manual_refresh', 'live_view')
  and requested_by = auth.uid()
);

drop policy if exists p_job_refresh_requests_select_own on public.job_refresh_requests;
create policy p_job_refresh_requests_select_own
on public.job_refresh_requests
for select
to authenticated
using (
  requested_by = auth.uid()
);

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

grant select on public.v_dispo_driver_live to authenticated;
grant select, insert, update on public.driver_live_locations to authenticated;
grant select, insert on public.driver_location_history to authenticated;
grant select, insert on public.job_refresh_requests to authenticated;
grant select on public.ai_token_usage to authenticated;
