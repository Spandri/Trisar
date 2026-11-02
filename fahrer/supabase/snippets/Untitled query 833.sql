-- Trisar: DB-first Job Status Engine + Live Route Refresh support
-- Run in Supabase SQL editor (idempotent).

create extension if not exists pgcrypto;

-- 1) Status constraint erweitern (inkl. Legacy-Werte) -----------------------
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs
  add constraint jobs_status_check
  check (
    lower(status) in (
      'pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen',
      'at_pickup', 'pickup', 'beim_pickup', 'beim pickup',
      'in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active',
      'done', 'completed', 'arrived', 'beendet',
      'cancelled', 'canceled', 'refused', 'storniert', 'stoniert'
    )
  );

-- 2) Enrichment-Reason erweitern ---------------------------------------------
alter table public.jobs drop constraint if exists jobs_ext_last_enrich_reason_chk;
alter table public.jobs
  add constraint jobs_ext_last_enrich_reason_chk
  check (
    ext_last_enrich_reason in ('create', 'manual_refresh', 'live_view')
    or ext_last_enrich_reason is null
  );

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'job_refresh_requests'
  ) then
    alter table public.job_refresh_requests
      drop constraint if exists job_refresh_requests_reason_check;
    alter table public.job_refresh_requests
      add constraint job_refresh_requests_reason_check
      check (reason in ('create', 'manual_refresh', 'live_view'));
  end if;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public' and table_name = 'api_usage_events'
  ) then
    alter table public.api_usage_events
      drop constraint if exists api_usage_events_reason_check;
    alter table public.api_usage_events
      add constraint api_usage_events_reason_check
      check (reason in ('create', 'manual_refresh', 'live_view'));
  end if;
end $$;

-- 3) Neue Routenfelder (Fahrer -> Ziel) --------------------------------------
alter table public.jobs
  add column if not exists ext_driver_to_dropoff_provider text,
  add column if not exists ext_driver_to_dropoff_distance_m integer,
  add column if not exists ext_driver_to_dropoff_duration_mins integer,
  add column if not exists ext_driver_to_dropoff_duration_in_traffic_mins integer,
  add column if not exists ext_driver_to_dropoff_polyline text,
  add column if not exists ext_driver_to_dropoff_payload jsonb,
  add column if not exists ext_driver_to_dropoff_last_sync_at timestamptz;

-- 4) DB Status-Runtime + History ---------------------------------------------
create table if not exists public.job_status_runtime (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  pickup_exit_hits integer not null default 0,
  dropoff_near_hits integer not null default 0,
  last_pickup_distance_m integer,
  last_dropoff_distance_m integer,
  updated_at timestamptz not null default now()
);

create table if not exists public.job_status_history (
  id bigserial primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  from_status text,
  to_status text not null,
  source text not null default 'db_engine',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_status_history_job_created
  on public.job_status_history(job_id, created_at desc);

-- 5) Settings ----------------------------------------------------------------
insert into public.integration_settings(key, value, description) values
  ('status_pickup_enter_radius_m', '180'::jsonb, 'Open -> Pickup if driver_to_pickup <= radius'),
  ('status_pickup_exit_radius_m', '300'::jsonb, 'Pickup -> Underway candidate if driver_to_pickup >= radius'),
  ('status_pickup_depart_hits', '3'::jsonb, 'Consecutive confirmations before Pickup -> Underway'),
  ('status_progress_delta_m', '25'::jsonb, 'Minimum distance delta interpreted as real movement'),
  ('status_dropoff_done_radius_m', '140'::jsonb, 'Underway -> Done if driver_to_dropoff <= radius'),
  ('status_dropoff_done_hits', '2'::jsonb, 'Consecutive confirmations before Underway -> Done')
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = now();

create or replace function public.trisar_get_setting_int(p_key text, p_fallback integer)
returns integer
language plpgsql
stable
as $$
declare
  v_raw text;
begin
  begin
    select value #>> '{}' into v_raw
    from public.integration_settings
    where key = p_key;
  exception
    when undefined_table then
      return p_fallback;
  end;

  if v_raw is null or btrim(v_raw) = '' then
    return p_fallback;
  end if;

  begin
    return v_raw::integer;
  exception
    when others then
      return p_fallback;
  end;
end;
$$;

create or replace function public.trisar_norm_status(p_status text)
returns text
language sql
immutable
as $$
  select lower(trim(coalesce(p_status, '')));
$$;

create or replace function public.trisar_transition_job_status(
  p_job_id uuid,
  p_next_status text,
  p_source text default 'db_engine',
  p_meta jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  select status into v_current
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    return false;
  end if;

  if public.trisar_norm_status(v_current) = public.trisar_norm_status(p_next_status) then
    return false;
  end if;

  update public.jobs
  set status = p_next_status,
      updated_at = now()
  where id = p_job_id;

  insert into public.job_status_history(job_id, from_status, to_status, source, meta)
  values (p_job_id, v_current, p_next_status, coalesce(p_source, 'db_engine'), coalesce(p_meta, '{}'::jsonb));

  return true;
end;
$$;

create or replace function public.trisar_evaluate_job_status(
  p_job_id uuid,
  p_source text default 'driver_live_trigger'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.jobs%rowtype;
  v_runtime public.job_status_runtime%rowtype;
  v_status text;
  v_open_statuses constant text[] := array['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen'];
  v_pickup_statuses constant text[] := array['at_pickup', 'pickup', 'beim_pickup', 'beim pickup'];
  v_trip_statuses constant text[] := array['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
  v_done_statuses constant text[] := array['done', 'completed', 'arrived', 'beendet'];
  v_terminal_statuses constant text[] := array['cancelled', 'canceled', 'refused', 'storniert', 'stoniert'];
  v_enter_radius integer := public.trisar_get_setting_int('status_pickup_enter_radius_m', 180);
  v_exit_radius integer := public.trisar_get_setting_int('status_pickup_exit_radius_m', 300);
  v_depart_hits_required integer := public.trisar_get_setting_int('status_pickup_depart_hits', 3);
  v_progress_delta integer := public.trisar_get_setting_int('status_progress_delta_m', 25);
  v_done_radius integer := public.trisar_get_setting_int('status_dropoff_done_radius_m', 140);
  v_done_hits_required integer := public.trisar_get_setting_int('status_dropoff_done_hits', 2);
  v_pickup_distance integer;
  v_dropoff_distance integer;
  v_pickup_exit_hits integer;
  v_dropoff_near_hits integer;
  v_depart_confirmed boolean := false;
  v_dropoff_progressing boolean := false;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id;

  if not found then
    return null;
  end if;

  v_status := public.trisar_norm_status(v_job.status);

  insert into public.job_status_runtime(job_id)
  values (p_job_id)
  on conflict (job_id) do nothing;

  select * into v_runtime
  from public.job_status_runtime
  where job_id = p_job_id
  for update;

  v_pickup_distance := coalesce(v_job.ext_driver_to_pickup_distance_m, 2147483647);
  v_dropoff_distance := coalesce(v_job.ext_driver_to_dropoff_distance_m, 2147483647);
  v_pickup_exit_hits := coalesce(v_runtime.pickup_exit_hits, 0);
  v_dropoff_near_hits := coalesce(v_runtime.dropoff_near_hits, 0);

  if v_status = any(v_terminal_statuses) or v_status = any(v_done_statuses) then
    update public.job_status_runtime
    set pickup_exit_hits = 0,
        dropoff_near_hits = 0,
        last_pickup_distance_m = null,
        last_dropoff_distance_m = null,
        updated_at = now()
    where job_id = p_job_id;
    return v_job.status;
  end if;

  if v_status = any(v_open_statuses) then
    if v_pickup_distance <= v_enter_radius then
      perform public.trisar_transition_job_status(
        p_job_id,
        'at_pickup',
        p_source,
        jsonb_build_object('pickup_distance_m', v_pickup_distance)
      );
      v_status := 'at_pickup';
      v_pickup_exit_hits := 0;
      v_dropoff_near_hits := 0;
    end if;
  elsif v_status = any(v_pickup_statuses) then
    if v_pickup_distance >= v_exit_radius then
      v_depart_confirmed := (
        v_runtime.last_pickup_distance_m is null
        or v_pickup_distance >= (v_runtime.last_pickup_distance_m + v_progress_delta)
      );
      v_dropoff_progressing := (
        v_runtime.last_dropoff_distance_m is not null
        and v_dropoff_distance <= (v_runtime.last_dropoff_distance_m - v_progress_delta)
      );

      if v_depart_confirmed or v_dropoff_progressing then
        v_pickup_exit_hits := v_pickup_exit_hits + 1;
      else
        v_pickup_exit_hits := greatest(v_pickup_exit_hits - 1, 0);
      end if;
    else
      v_pickup_exit_hits := 0;
    end if;

    if v_pickup_exit_hits >= greatest(v_depart_hits_required, 1) then
      perform public.trisar_transition_job_status(
        p_job_id,
        'in_progress',
        p_source,
        jsonb_build_object(
          'pickup_distance_m', v_pickup_distance,
          'dropoff_distance_m', case when v_dropoff_distance = 2147483647 then null else v_dropoff_distance end,
          'departure_hits', v_pickup_exit_hits
        )
      );
      v_status := 'in_progress';
      v_pickup_exit_hits := 0;
      v_dropoff_near_hits := 0;
    end if;
  elsif v_status = any(v_trip_statuses) then
    if v_dropoff_distance <= v_done_radius then
      v_dropoff_near_hits := v_dropoff_near_hits + 1;
    else
      v_dropoff_near_hits := greatest(v_dropoff_near_hits - 1, 0);
    end if;

    if v_dropoff_near_hits >= greatest(v_done_hits_required, 1) then
      perform public.trisar_transition_job_status(
        p_job_id,
        'done',
        p_source,
        jsonb_build_object('dropoff_distance_m', v_dropoff_distance, 'dropoff_hits', v_dropoff_near_hits)
      );
      v_status := 'done';
      v_pickup_exit_hits := 0;
      v_dropoff_near_hits := 0;
    end if;
  end if;

  update public.job_status_runtime
  set pickup_exit_hits = v_pickup_exit_hits,
      dropoff_near_hits = v_dropoff_near_hits,
      last_pickup_distance_m = case when v_pickup_distance = 2147483647 then null else v_pickup_distance end,
      last_dropoff_distance_m = case when v_dropoff_distance = 2147483647 then null else v_dropoff_distance end,
      updated_at = now()
  where job_id = p_job_id;

  return v_status;
end;
$$;

-- 6) Trigger: jobs ändern -> Status neu bewerten ------------------------------
create or replace function public.trisar_jobs_status_eval_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if pg_trigger_depth() > 1 then
    return new;
  end if;

  perform public.trisar_evaluate_job_status(new.id, 'jobs_trigger');
  return new;
end;
$$;

drop trigger if exists trg_jobs_status_eval on public.jobs;
create trigger trg_jobs_status_eval
after insert or update of status, driver_id, ext_driver_to_pickup_distance_m, ext_driver_to_dropoff_distance_m
on public.jobs
for each row execute function public.trisar_jobs_status_eval_trigger();

-- 7) Trigger: Live-Position -> aktive Jobs neu bewerten -----------------------
create or replace function public.trisar_driver_live_status_eval_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.active_job_id is not null then
    perform public.trisar_evaluate_job_status(new.active_job_id, 'driver_live_trigger');
  end if;

  for v_job_id in
    select j.id
    from public.jobs j
    where j.driver_id = new.driver_id
      and lower(coalesce(j.status, '')) in (
        'pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen',
        'at_pickup', 'pickup', 'beim_pickup', 'beim pickup',
        'in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'
      )
    order by j.updated_at desc
    limit 5
  loop
    perform public.trisar_evaluate_job_status(v_job_id, 'driver_live_trigger');
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_driver_live_status_eval on public.driver_live_locations;
create trigger trg_driver_live_status_eval
after insert or update of lat, lng, captured_at, active_job_id
on public.driver_live_locations
for each row execute function public.trisar_driver_live_status_eval_trigger();

-- 8) Policy: authenticated darf auch live_view requests anlegen ---------------
drop policy if exists p_job_refresh_requests_insert_manual on public.job_refresh_requests;
create policy p_job_refresh_requests_insert_manual
on public.job_refresh_requests
for insert
to authenticated
with check (
  reason in ('manual_refresh', 'live_view')
  and requested_by = auth.uid()
);

