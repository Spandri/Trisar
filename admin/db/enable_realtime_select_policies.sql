-- Ermoeglicht Realtime-DB-Changes fuer Koordinator/Admin/Fahrer-Apps
-- Hintergrund: Realtime respektiert RLS. Ohne SELECT-Policy kommen keine Events im Client an.
-- In Supabase SQL Editor ausfuehren.

begin;

-- Tabellen, deren Aenderungen live in den Apps ankommen sollen
grant select on table public.jobs to anon, authenticated;
grant select on table public.convoy_assignments to anon, authenticated;
grant select on table public.job_guests to anon, authenticated;
grant select on table public.job_notes to anon, authenticated;
grant select on table public.driver_live_locations to anon, authenticated;

alter table public.jobs enable row level security;
alter table public.convoy_assignments enable row level security;
alter table public.job_guests enable row level security;
alter table public.job_notes enable row level security;
alter table public.driver_live_locations enable row level security;

drop policy if exists p_jobs_select_realtime on public.jobs;
create policy p_jobs_select_realtime
on public.jobs
for select
to anon, authenticated
using (true);

drop policy if exists p_convoy_assignments_select_realtime on public.convoy_assignments;
create policy p_convoy_assignments_select_realtime
on public.convoy_assignments
for select
to anon, authenticated
using (true);

drop policy if exists p_job_guests_select_realtime on public.job_guests;
create policy p_job_guests_select_realtime
on public.job_guests
for select
to anon, authenticated
using (true);

drop policy if exists p_job_notes_select_realtime on public.job_notes;
create policy p_job_notes_select_realtime
on public.job_notes
for select
to anon, authenticated
using (true);

drop policy if exists p_driver_live_locations_select_realtime on public.driver_live_locations;
create policy p_driver_live_locations_select_realtime
on public.driver_live_locations
for select
to anon, authenticated
using (true);

commit;

-- Verifikation:
-- select schemaname, tablename, policyname, permissive, roles, cmd
-- from pg_policies
-- where schemaname='public'
--   and tablename in ('jobs','convoy_assignments','job_guests','job_notes','driver_live_locations')
-- order by tablename, policyname;
