-- Dienstplan-Anfragen (Accept/Refuse) fuer Fahrer-App

create table if not exists public.driver_service_requests (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  service_date date not null,
  service_start_time time,
  service_end_time time,
  status text not null default 'pending',
  requested_by text,
  refusal_reason text,
  note text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.driver_service_requests
  drop constraint if exists driver_service_requests_status_check;

alter table public.driver_service_requests
  add constraint driver_service_requests_status_check
  check (status in ('pending', 'accepted', 'refused'));

create index if not exists idx_driver_service_requests_driver_id
  on public.driver_service_requests(driver_id);

create index if not exists idx_driver_service_requests_status
  on public.driver_service_requests(status);

create index if not exists idx_driver_service_requests_service_date
  on public.driver_service_requests(service_date);

-- Optional: Datum fuer bestaetigten Dienst direkt am Profil speichern
alter table public.profiles
  add column if not exists service_start_date date,
  add column if not exists service_end_date date;

-- updated_at Trigger
create or replace function public.set_driver_service_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_driver_service_requests_updated_at on public.driver_service_requests;
create trigger trg_driver_service_requests_updated_at
before update on public.driver_service_requests
for each row
execute function public.set_driver_service_requests_updated_at();

-- RLS / Rechte
alter table public.driver_service_requests enable row level security;

grant select, insert, update on public.driver_service_requests to anon, authenticated;

drop policy if exists p_driver_service_requests_select_public on public.driver_service_requests;
create policy p_driver_service_requests_select_public
on public.driver_service_requests
for select
to anon, authenticated
using (true);

drop policy if exists p_driver_service_requests_insert_public on public.driver_service_requests;
create policy p_driver_service_requests_insert_public
on public.driver_service_requests
for insert
to anon, authenticated
with check (true);

drop policy if exists p_driver_service_requests_update_public on public.driver_service_requests;
create policy p_driver_service_requests_update_public
on public.driver_service_requests
for update
to anon, authenticated
using (true)
with check (true);

