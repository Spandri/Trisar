-- ==========================================
-- Trisar: API Usage + Cost Tracking
-- Idempotent SQL for Supabase SQL Editor
-- ==========================================

create extension if not exists pgcrypto;

create table if not exists public.api_provider_pricing (
  provider text primary key,
  unit_name text not null default 'request',
  unit_price_eur numeric(12,6) not null check (unit_price_eur >= 0),
  currency text not null default 'EUR',
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_api_provider_pricing_updated_at on public.api_provider_pricing;
create trigger trg_api_provider_pricing_updated_at
before update on public.api_provider_pricing
for each row execute function public.trisar_set_updated_at();

insert into public.api_provider_pricing (provider, unit_name, unit_price_eur, currency, notes, is_active) values
  ('google-places', 'request', 0.002800, 'EUR', 'Estimated cost per autocomplete request', true),
  ('google-routes', 'request', 0.004800, 'EUR', 'Estimated cost per directions/routes request', true),
  ('opensky', 'request', 0.000000, 'EUR', 'Free tier / flat plan', true),
  ('aviationstack', 'request', 0.000000, 'EUR', 'Bundled plan', true)
on conflict (provider) do update
set unit_name = excluded.unit_name,
    unit_price_eur = excluded.unit_price_eur,
    currency = excluded.currency,
    notes = excluded.notes,
    is_active = excluded.is_active,
    updated_at = now();

alter table public.api_usage_events
  add column if not exists units numeric(12,3) not null default 1,
  add column if not exists unit_name text not null default 'request',
  add column if not exists unit_price_eur numeric(12,6) not null default 0,
  add column if not exists estimated_cost_eur numeric(14,6) not null default 0;

create index if not exists idx_api_usage_events_provider_created_at
  on public.api_usage_events(provider, created_at desc);

create index if not exists idx_api_usage_events_created_cost
  on public.api_usage_events(created_at desc, estimated_cost_eur);

create table if not exists public.api_cost_import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null, -- google_billing_bigquery, google_monitoring
  range_start date,
  range_end date,
  rows_written integer not null default 0,
  status text not null default 'ok' check (status in ('ok', 'error')),
  error_text text,
  created_at timestamptz not null default now()
);

create index if not exists idx_api_cost_import_runs_created_at
  on public.api_cost_import_runs(created_at desc);

create table if not exists public.api_cost_actual_daily (
  usage_date date not null,
  provider text not null,
  service_description text not null,
  sku_id text not null,
  sku_description text not null,
  usage_amount numeric(20,6) not null default 0,
  usage_unit text,
  cost_eur numeric(16,6) not null default 0,
  currency text not null default 'EUR',
  source_table text not null,
  imported_at timestamptz not null default now(),
  primary key (usage_date, provider, sku_id, source_table)
);

create index if not exists idx_api_cost_actual_daily_usage_date
  on public.api_cost_actual_daily(usage_date desc);

create index if not exists idx_api_cost_actual_daily_provider_date
  on public.api_cost_actual_daily(provider, usage_date desc);

create table if not exists public.api_usage_monitoring_timeseries (
  observed_at timestamptz not null,
  provider text not null,
  metric_type text not null,
  response_code text,
  value numeric(20,6) not null default 0,
  project_id text,
  imported_at timestamptz not null default now(),
  primary key (observed_at, provider, metric_type, response_code)
);

create index if not exists idx_api_usage_monitoring_timeseries_observed_at
  on public.api_usage_monitoring_timeseries(observed_at desc);

create or replace view public.v_api_usage_cost_summary as
select
  provider,
  action,
  count(*)::bigint as requests,
  coalesce(sum(units), 0)::numeric(18,3) as total_units,
  round(coalesce(sum(estimated_cost_eur), 0)::numeric, 4) as total_cost_eur,
  min(created_at) as first_event_at,
  max(created_at) as last_event_at
from public.api_usage_events
group by provider, action;

create or replace view public.v_api_cost_live as
select
  round(coalesce(sum(case when created_at >= now() - interval '1 hour' then estimated_cost_eur else 0 end), 0)::numeric, 4) as cost_last_1h_eur,
  round(coalesce(sum(case when created_at >= now() - interval '24 hour' then estimated_cost_eur else 0 end), 0)::numeric, 4) as cost_last_24h_eur,
  round(coalesce(sum(case when created_at >= date_trunc('day', now()) then estimated_cost_eur else 0 end), 0)::numeric, 4) as cost_today_eur,
  round(coalesce(sum(case when created_at >= now() - interval '7 day' then estimated_cost_eur else 0 end), 0)::numeric, 4) as cost_last_7d_eur,
  round(coalesce(sum(case when created_at >= date_trunc('month', now()) then estimated_cost_eur else 0 end), 0)::numeric, 4) as cost_month_to_date_eur,
  count(*) filter (where created_at >= now() - interval '24 hour')::bigint as requests_last_24h
from public.api_usage_events;

create or replace view public.v_api_cost_burn_rate as
select
  provider,
  round(coalesce(sum(case when created_at >= now() - interval '1 hour' then estimated_cost_eur else 0 end), 0)::numeric, 4) as burn_per_hour_eur,
  round(coalesce(sum(case when created_at >= now() - interval '24 hour' then estimated_cost_eur else 0 end), 0)::numeric, 4) as burn_last_24h_eur,
  round(
    coalesce(sum(case when created_at >= now() - interval '24 hour' then estimated_cost_eur else 0 end), 0)::numeric / 24
  , 4) as projected_hourly_eur,
  round(
    coalesce(sum(case when created_at >= now() - interval '24 hour' then estimated_cost_eur else 0 end), 0)::numeric * 30
  , 2) as projected_30d_eur
from public.api_usage_events
group by provider;

create or replace view public.v_api_cost_actual_live as
select
  round(coalesce(sum(case when usage_date = current_date then cost_eur else 0 end), 0)::numeric, 4) as actual_cost_today_eur,
  round(coalesce(sum(case when usage_date >= current_date - 6 then cost_eur else 0 end), 0)::numeric, 4) as actual_cost_last_7d_eur,
  round(coalesce(sum(case when usage_date >= date_trunc('month', now())::date then cost_eur else 0 end), 0)::numeric, 4) as actual_cost_month_to_date_eur
from public.api_cost_actual_daily;

create or replace view public.v_api_cost_estimated_vs_actual_daily as
with estimated as (
  select
    created_at::date as usage_date,
    provider,
    round(sum(estimated_cost_eur)::numeric, 6) as estimated_cost_eur
  from public.api_usage_events
  group by created_at::date, provider
),
actual as (
  select
    usage_date,
    provider,
    round(sum(cost_eur)::numeric, 6) as actual_cost_eur
  from public.api_cost_actual_daily
  group by usage_date, provider
)
select
  coalesce(e.usage_date, a.usage_date) as usage_date,
  coalesce(e.provider, a.provider) as provider,
  coalesce(e.estimated_cost_eur, 0)::numeric(16,6) as estimated_cost_eur,
  coalesce(a.actual_cost_eur, 0)::numeric(16,6) as actual_cost_eur,
  (coalesce(e.estimated_cost_eur, 0) - coalesce(a.actual_cost_eur, 0))::numeric(16,6) as delta_eur
from estimated e
full outer join actual a
  on a.usage_date = e.usage_date
 and a.provider = e.provider;

alter table public.api_provider_pricing enable row level security;
alter table public.api_cost_import_runs enable row level security;
alter table public.api_cost_actual_daily enable row level security;
alter table public.api_usage_monitoring_timeseries enable row level security;

drop policy if exists p_api_provider_pricing_service_only on public.api_provider_pricing;
create policy p_api_provider_pricing_service_only
on public.api_provider_pricing
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_api_cost_import_runs_service_only on public.api_cost_import_runs;
create policy p_api_cost_import_runs_service_only
on public.api_cost_import_runs
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_api_cost_actual_daily_service_only on public.api_cost_actual_daily;
create policy p_api_cost_actual_daily_service_only
on public.api_cost_actual_daily
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists p_api_usage_monitoring_timeseries_service_only on public.api_usage_monitoring_timeseries;
create policy p_api_usage_monitoring_timeseries_service_only
on public.api_usage_monitoring_timeseries
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

grant select on public.v_api_usage_cost_summary to authenticated;
grant select on public.v_api_cost_live to authenticated;
grant select on public.v_api_cost_burn_rate to authenticated;
grant select on public.v_api_cost_actual_live to authenticated;
grant select on public.v_api_cost_estimated_vs_actual_daily to authenticated;
