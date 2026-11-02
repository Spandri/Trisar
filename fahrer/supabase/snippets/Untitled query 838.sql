-- Erlaubt der Koordinator-App (anon/authenticated) Schreibzugriff auf die
-- jobs-Tabelle. SELECT war bereits erlaubt (App liest Fahrten).
-- Ohne diese Policies blockiert RLS das UPDATE still (Status 200, 0 rows affected),
-- sodass passengers/anonymous_guests nie persistiert werden.

-- Sicherstellen dass RLS aktiv ist
alter table public.jobs enable row level security;

-- Alte Policies entfernen (idempotent)
drop policy if exists p_jobs_select_public    on public.jobs;
drop policy if exists p_jobs_insert_public    on public.jobs;
drop policy if exists p_jobs_update_public    on public.jobs;
drop policy if exists p_jobs_delete_public    on public.jobs;

-- Rechte an Datenbankrollen vergeben
grant select, insert, update, delete on public.jobs to anon, authenticated;

-- SELECT: alle dürfen Fahrten lesen
create policy p_jobs_select_public
on public.jobs
for select
to public
using (true);

-- INSERT: Koordinator-App darf Fahrten anlegen
create policy p_jobs_insert_public
on public.jobs
for insert
to public
with check (true);

-- UPDATE: Koordinator-App darf Fahrten bearbeiten
create policy p_jobs_update_public
on public.jobs
for update
to public
using (true)
with check (true);

-- DELETE: Koordinator-App darf Fahrten löschen
create policy p_jobs_delete_public
on public.jobs
for delete
to public
using (true);
