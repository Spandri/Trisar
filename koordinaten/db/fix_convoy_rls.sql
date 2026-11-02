-- Erlaubt der Koordinator-App (anon/authenticated) Lese- und Schreibzugriff
-- auf Konvoi-Tabellen, damit Konvoi-Erstellung und -Änderungen persistiert werden.

-- ---------------------------------------------------------------------------
-- Schema absichern (idempotent)
-- ---------------------------------------------------------------------------
create extension if not exists pgcrypto;

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

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'convoy_assignments_response_status_check'
  ) then
    alter table public.convoy_assignments
      add constraint convoy_assignments_response_status_check
      check (response_status in ('pending', 'accepted', 'refused'));
  end if;
end
$$;

create index if not exists idx_convoy_assignments_job_id on public.convoy_assignments(job_id);
create index if not exists idx_convoy_assignments_driver_id on public.convoy_assignments(driver_id);

-- ---------------------------------------------------------------------------
-- RLS + Policies
-- ---------------------------------------------------------------------------
alter table public.convoys enable row level security;
alter table public.convoy_assignments enable row level security;

drop policy if exists p_convoys_select_public on public.convoys;
drop policy if exists p_convoys_insert_public on public.convoys;
drop policy if exists p_convoys_update_public on public.convoys;
drop policy if exists p_convoys_delete_public on public.convoys;

drop policy if exists p_convoy_assignments_select_public on public.convoy_assignments;
drop policy if exists p_convoy_assignments_insert_public on public.convoy_assignments;
drop policy if exists p_convoy_assignments_update_public on public.convoy_assignments;
drop policy if exists p_convoy_assignments_delete_public on public.convoy_assignments;

grant select, insert, update, delete on public.convoys to anon, authenticated;
grant select, insert, update, delete on public.convoy_assignments to anon, authenticated;

create policy p_convoys_select_public
on public.convoys
for select
to public
using (true);

create policy p_convoys_insert_public
on public.convoys
for insert
to public
with check (true);

create policy p_convoys_update_public
on public.convoys
for update
to public
using (true)
with check (true);

create policy p_convoys_delete_public
on public.convoys
for delete
to public
using (true);

create policy p_convoy_assignments_select_public
on public.convoy_assignments
for select
to public
using (true);

create policy p_convoy_assignments_insert_public
on public.convoy_assignments
for insert
to public
with check (true);

create policy p_convoy_assignments_update_public
on public.convoy_assignments
for update
to public
using (true)
with check (true);

create policy p_convoy_assignments_delete_public
on public.convoy_assignments
for delete
to public
using (true);
