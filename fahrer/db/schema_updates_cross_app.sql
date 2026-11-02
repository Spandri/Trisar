-- Cross-app schema additions required by koordinator/dispo scripts and KI tools.
-- Idempotent and safe to re-run.

create extension if not exists vector;

-- Jobs: explicit count for anonymous guests used by koordinator UI.
alter table public.jobs
  add column if not exists anonymous_guests integer default 0;

-- Teltonika IMEI to driver mapping.
create table if not exists public.imei_driver_map (
  imei text primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_imei_driver_map_driver_id
  on public.imei_driver_map(driver_id);

create index if not exists idx_imei_driver_map_active
  on public.imei_driver_map(is_active)
  where is_active = true;

alter table public.imei_driver_map enable row level security;

drop policy if exists imei_driver_map_select_authenticated on public.imei_driver_map;
create policy imei_driver_map_select_authenticated
  on public.imei_driver_map
  for select
  to authenticated
  using (true);

drop policy if exists imei_driver_map_write_service_role on public.imei_driver_map;
create policy imei_driver_map_write_service_role
  on public.imei_driver_map
  for all
  to service_role
  using (true)
  with check (true);

-- Semantic search document store used by KI assistant scripts.
create table if not exists public.ai_documents (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id text not null,
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  embedding vector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id)
);

create index if not exists idx_ai_documents_source
  on public.ai_documents(source_table, source_id);

create or replace function public.trg_ai_documents_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_documents_updated_at on public.ai_documents;
create trigger trg_ai_documents_updated_at
before update on public.ai_documents
for each row execute function public.trg_ai_documents_set_updated_at();

alter table public.ai_documents enable row level security;

drop policy if exists p_ai_documents_select_public on public.ai_documents;
create policy p_ai_documents_select_public
  on public.ai_documents
  for select
  to anon, authenticated
  using (true);

drop policy if exists p_ai_documents_write_service on public.ai_documents;
create policy p_ai_documents_write_service
  on public.ai_documents
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.match_ai_documents(
  query_embedding double precision[],
  match_count integer default 8
)
returns table (
  id uuid,
  source_table text,
  source_id text,
  content text,
  meta jsonb,
  similarity double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q vector;
begin
  if query_embedding is null or array_length(query_embedding, 1) is null then
    return;
  end if;

  q := query_embedding::vector;

  return query
  select
    d.id,
    d.source_table,
    d.source_id,
    d.content,
    d.meta,
    (1 - (d.embedding <=> q))::double precision as similarity
  from public.ai_documents d
  where d.embedding is not null
  order by d.embedding <=> q
  limit greatest(1, least(coalesce(match_count, 8), 50));
end;
$$;

grant execute on function public.match_ai_documents(double precision[], integer) to anon, authenticated, service_role;

-- Read policies used by koordinator/driver list on mobile browsers without login state.
alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.jobs enable row level security;
alter table public.convoys enable row level security;
alter table public.convoy_assignments enable row level security;
alter table public.job_guests enable row level security;
alter table public.guests enable row level security;
alter table public.job_notes enable row level security;

grant select on public.profiles to anon, authenticated;
grant select on public.vehicles to anon, authenticated;
grant select on public.jobs to anon, authenticated;
grant select on public.convoys to anon, authenticated;
grant select on public.convoy_assignments to anon, authenticated;
grant select on public.job_guests to anon, authenticated;
grant select on public.guests to anon, authenticated;
grant select on public.job_notes to anon, authenticated;

drop policy if exists p_profiles_read_driver_list_public on public.profiles;
drop policy if exists p_vehicles_read_driver_list_public on public.vehicles;
drop policy if exists p_jobs_read_public on public.jobs;
drop policy if exists p_convoys_read_public on public.convoys;
drop policy if exists p_convoy_assignments_read_public on public.convoy_assignments;
drop policy if exists p_job_guests_read_public on public.job_guests;
drop policy if exists p_guests_read_public on public.guests;
drop policy if exists p_job_notes_read_public on public.job_notes;

create policy p_profiles_read_driver_list_public
  on public.profiles
  for select
  to anon, authenticated
  using (
    coalesce(is_dispo, false) = false
    and coalesce(lower(role), 'fahrer') <> 'admin'
  );

create policy p_vehicles_read_driver_list_public
  on public.vehicles
  for select
  to anon, authenticated
  using (true);

create policy p_jobs_read_public
  on public.jobs
  for select
  to anon, authenticated
  using (true);

create policy p_convoys_read_public
  on public.convoys
  for select
  to anon, authenticated
  using (true);

create policy p_convoy_assignments_read_public
  on public.convoy_assignments
  for select
  to anon, authenticated
  using (true);

create policy p_job_guests_read_public
  on public.job_guests
  for select
  to anon, authenticated
  using (true);

create policy p_guests_read_public
  on public.guests
  for select
  to anon, authenticated
  using (true);

create policy p_job_notes_read_public
  on public.job_notes
  for select
  to anon, authenticated
  using (true);
