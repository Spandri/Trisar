-- Teil 2 der Zugriffsregeln (siehe 20261103170000). Diese Tabellen gehoeren
-- supabase_admin, darum muss diese Datei als supabase_admin laufen
-- (supabase migration up / db push tun das, ein psql als postgres nicht).

begin;

drop policy if exists jobs_archive_insert_authenticated on public.jobs_archive;
drop policy if exists jobs_archive_read_authenticated on public.jobs_archive;
drop policy if exists p_driver_service_requests_insert_public on public.driver_service_requests;
drop policy if exists p_driver_service_requests_select_public on public.driver_service_requests;
drop policy if exists p_driver_service_requests_update_public on public.driver_service_requests;

alter table public.jobs_archive enable row level security;
alter table public.driver_service_requests enable row level security;

create policy dispo_alles on public.jobs_archive for all to authenticated
  using (public.ist_dispo()) with check (public.ist_dispo());
create policy dispo_alles on public.driver_service_requests for all to authenticated
  using (public.ist_dispo()) with check (public.ist_dispo());

create policy fahrer_dienstanfragen_lesen on public.driver_service_requests for select to authenticated
  using (driver_id = auth.uid());
create policy fahrer_dienstanfrage_antworten on public.driver_service_requests for update to authenticated
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());


revoke all on public.driver_activity_state_backup_demo from anon, authenticated;

commit;
