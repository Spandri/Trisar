-- WARNUNG: NUR FUER TESTING
-- Dieses Script oeffnet das komplette public-Schema fuer anon/authenticated.
-- Nicht fuer Produktion geeignet.

begin;

-- Schema-Nutzung erlauben
grant usage on schema public to anon, authenticated;

-- Bestehende Objekte komplett freigeben
grant all privileges on all tables in schema public to anon, authenticated;
grant all privileges on all sequences in schema public to anon, authenticated;
grant all privileges on all routines in schema public to anon, authenticated;

-- Auch zukuenftige Objekte im public-Schema automatisch freigeben
alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant all on sequences to anon, authenticated;
alter default privileges in schema public
  grant all on routines to anon, authenticated;

-- RLS auf allen public-Tabellen deaktivieren
do $$
declare
  rec record;
begin
  for rec in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table %I.%I disable row level security', rec.schemaname, rec.tablename);
  end loop;
end
$$;

commit;

-- Optionaler Check:
-- select schemaname, tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
-- order by tablename;
-- Fuegt Fahrer-Status fuer KartenView hinzu:
--   aktiv   = gerade in aktiver Fahrt (mit Gast unterwegs)
--   inaktiv = keine aktive Fahrt, aber eine Fahrt in <= 1 Stunde
--   frei    = weder aktiv noch inaktiv

begin;

alter table public.profiles
  add column if not exists driver_activity_state text not null default 'frei',
  add column if not exists driver_activity_state_updated_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_driver_activity_state_check;

alter table public.profiles
  add constraint profiles_driver_activity_state_check
  check (driver_activity_state in ('aktiv', 'inaktiv', 'frei'));

create index if not exists idx_profiles_driver_activity_state
  on public.profiles (driver_activity_state);

create or replace function public.refresh_driver_activity_states()
returns void
language plpgsql
as $$
begin
  with driver_jobs as (
    select
      j.driver_id as driver_id,
      j.id as job_id,
      j.ride_date,
      j.etd,
      lower(coalesce(j.status, '')) as job_status
    from public.jobs j
    where j.driver_id is not null

    union

    select
      ca.driver_id as driver_id,
      j.id as job_id,
      j.ride_date,
      j.etd,
      lower(coalesce(j.status, '')) as job_status
    from public.convoy_assignments ca
    join public.jobs j on j.id = ca.job_id
    where coalesce(lower(ca.response_status), 'pending') <> 'refused'
  ),
  computed as (
    select
      p.id as driver_id,
      case
        when exists (
          select 1
          from driver_jobs dj
          where dj.driver_id = p.id
            and dj.job_status in ('in_progress', 'started', 'unterwegs', 'active', 'ongoing', 'on_trip')
        ) then 'aktiv'

        when exists (
          select 1
          from driver_jobs dj
          where dj.driver_id = p.id
            and dj.job_status not in ('done', 'completed', 'arrived', 'cancelled', 'canceled', 'refused', 'stoniert')
            and dj.job_status not in ('in_progress', 'started', 'unterwegs', 'active', 'ongoing', 'on_trip')
            and (dj.ride_date::timestamp + coalesce(dj.etd, '00:00'::time)) between now() and now() + interval '1 hour'
        ) then 'inaktiv'

        else 'frei'
      end as new_state
    from public.profiles p
    where coalesce(lower(p.role), '') not in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator')
      and coalesce(p.is_dispo, false) = false
  )
  update public.profiles p
  set
    driver_activity_state = c.new_state,
    driver_activity_state_updated_at = now()
  from computed c
  where p.id = c.driver_id
    and p.driver_activity_state is distinct from c.new_state;
end;
$$;

create or replace function public.trg_refresh_driver_activity_states()
returns trigger
language plpgsql
as $$
begin
  perform public.refresh_driver_activity_states();
  return null;
end;
$$;

drop trigger if exists trg_jobs_refresh_driver_activity_states on public.jobs;
create trigger trg_jobs_refresh_driver_activity_states
after insert or update or delete on public.jobs
for each statement
execute function public.trg_refresh_driver_activity_states();

drop trigger if exists trg_convoy_assignments_refresh_driver_activity_states on public.convoy_assignments;
create trigger trg_convoy_assignments_refresh_driver_activity_states
after insert or update or delete on public.convoy_assignments
for each statement
execute function public.trg_refresh_driver_activity_states();

-- Einmaliger initialer Recompute
select public.refresh_driver_activity_states();

commit;
