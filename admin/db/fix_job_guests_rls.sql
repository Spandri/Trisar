-- Erlaubt der Koordinator-App (anon/authenticated) Lese- und Schreibzugriff
-- auf job_guests. Die Tabelle wird nur intern von der Koordinator-App
-- beschrieben; ein öffentliches Lesen von Gast-Job-Verknüpfungen ist
-- für den Betrieb notwendig.

-- Sicherstellen dass RLS aktiv ist
alter table public.job_guests enable row level security;

-- Alte Policies entfernen (idempotent)
drop policy if exists p_job_guests_select_public    on public.job_guests;
drop policy if exists p_job_guests_insert_public    on public.job_guests;
drop policy if exists p_job_guests_update_public    on public.job_guests;
drop policy if exists p_job_guests_delete_public    on public.job_guests;

-- Rechte an Datenbankrollen vergeben
grant select, insert, update, delete on public.job_guests to anon, authenticated;

-- SELECT: alle dürfen Gast-Job-Verknüpfungen lesen
create policy p_job_guests_select_public
on public.job_guests
for select
to public
using (true);

-- INSERT: Koordinator-App darf neue Verknüpfungen anlegen
create policy p_job_guests_insert_public
on public.job_guests
for insert
to public
with check (true);

-- UPDATE: Koordinator-App darf Verknüpfungen aktualisieren
create policy p_job_guests_update_public
on public.job_guests
for update
to public
using (true)
with check (true);

-- DELETE: Koordinator-App darf Verknüpfungen löschen
create policy p_job_guests_delete_public
on public.job_guests
for delete
to public
using (true);
