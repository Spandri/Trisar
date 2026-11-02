-- Einmaliger Fix fuer Alle-Fahrer Realtime + Read/Write auf Dienstplan-Anfragen
-- Sicher erneut ausfuehrbar

-- 1) Tabelle + Rechte + RLS sicherstellen
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

alter table public.driver_service_requests enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on table public.driver_service_requests to anon, authenticated;

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

-- 2) Realtime-Update-Payload robust machen
alter table public.driver_service_requests replica identity full;
alter table public.profiles replica identity full;
alter table public.vehicles replica identity full;

-- 3) Tabellen sicher in supabase_realtime Publication haengen
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='driver_service_requests'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_service_requests';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='profiles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='vehicles'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.vehicles';
  END IF;
END $$;

-- 4) Sichtkontrolle
select pubname, schemaname, tablename
from pg_publication_tables
where pubname='supabase_realtime'
  and schemaname='public'
  and tablename in ('driver_service_requests','profiles','vehicles')
order by tablename;
