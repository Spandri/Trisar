-- Zugriffsregeln fuer den Live-Betrieb (03.11.2026).
-- Vorher konnte jeder mit dem oeffentlichen Schluessel (auch ohne Anmeldung)
-- Fahrten, Gaeste und Fahrer lesen, und jede Anmeldung durfte alles aendern.
-- Jetzt:
--   ohne Anmeldung      nichts
--   Disposition         alles lesen und bearbeiten (profiles.is_dispo oder role dispo/admin)
--   Fahrer              eigene Fahrten (auch Konvoi) mit Gaesten und Notizen,
--                       eigene Dienstanfragen, eigenes Fahrzeug und dessen Schaeden,
--                       Namen/Telefon/Standort der Kollegen
-- Server-Dienste (Edge Functions, Teltonika-Gateway) nutzen service_role und sind nicht betroffen.
-- jobs_archive, driver_service_requests und driver_activity_state_backup_demo gehoeren
-- supabase_admin, ihre Regeln stehen in 20261103170100 (muss als supabase_admin laufen).

begin;

-- ---------------------------------------------------------------------------
-- Hilfsfunktionen (security definer, damit sie selbst nicht an RLS haengen)
-- ---------------------------------------------------------------------------
create or replace function public.ist_dispo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (coalesce(p.is_dispo, false)
           or lower(coalesce(p.role, '')) in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator'))
  );
$$;

create or replace function public.fahrer_sieht_fahrt(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.jobs j where j.id = p_job_id and j.driver_id = auth.uid())
      or exists (select 1 from public.convoy_assignments ca where ca.job_id = p_job_id and ca.driver_id = auth.uid());
$$;

create or replace function public.eigenes_fahrzeug()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select vehicle_id from public.profiles where id = auth.uid();
$$;

revoke all on function public.ist_dispo() from public, anon;
revoke all on function public.fahrer_sieht_fahrt(uuid) from public, anon;
revoke all on function public.eigenes_fahrzeug() from public, anon;
grant execute on function public.ist_dispo() to authenticated;
grant execute on function public.fahrer_sieht_fahrt(uuid) to authenticated;
grant execute on function public.eigenes_fahrzeug() to authenticated;

-- Der Trigger setzt den Aktivitaetsstatus aller betroffenen Fahrer. Er muss das
-- auch duerfen, wenn ein Fahrer die Fahrt aendert.
alter function public.trg_refresh_driver_activity_states() security definer;
alter function public.trg_refresh_driver_activity_states() set search_path = public;

-- ---------------------------------------------------------------------------
-- Alte offene Regeln entfernen
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'jobs', 'convoys', 'convoy_assignments', 'guests', 'job_guests',
                        'job_notes', 'vehicles', 'vehicle_damages', 'messages', 'chat_reads',
                        'driver_live_locations', 'driver_location_history',
                        'ai_documents', 'imei_driver_map')
      and policyname not like '%service%'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Disposition: alles
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'jobs', 'convoys', 'convoy_assignments', 'guests', 'job_guests',
                           'job_notes', 'vehicles', 'vehicle_damages', 'messages', 'chat_reads',
                           'driver_live_locations', 'driver_location_history',
                           'ai_documents', 'imei_driver_map',
                           'job_status_history', 'job_status_runtime']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy dispo_alles on public.%I for all to authenticated using (public.ist_dispo()) with check (public.ist_dispo())',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Fahrer
-- ---------------------------------------------------------------------------
-- Kollegenliste (Name, Telefon, Fahrzeug) braucht die Fahrer-App, eigenes Profil bearbeiten.
create policy fahrer_profile_lesen on public.profiles for select to authenticated using (true);
create policy fahrer_profil_bearbeiten on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy fahrer_fahrten_lesen on public.jobs for select to authenticated
  using (public.fahrer_sieht_fahrt(id));
create policy fahrer_fahrten_status on public.jobs for update to authenticated
  using (public.fahrer_sieht_fahrt(id)) with check (public.fahrer_sieht_fahrt(id));

create policy fahrer_konvoi_lesen on public.convoy_assignments for select to authenticated
  using (public.fahrer_sieht_fahrt(job_id));
create policy fahrer_konvoi_antwort_neu on public.convoy_assignments for insert to authenticated
  with check (driver_id = auth.uid() and public.fahrer_sieht_fahrt(job_id));
create policy fahrer_konvoi_antwort on public.convoy_assignments for update to authenticated
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());

create policy fahrer_konvois_lesen on public.convoys for select to authenticated using (true);

create policy fahrer_gaeste_lesen on public.guests for select to authenticated
  using (exists (select 1 from public.job_guests jg where jg.guest_id = guests.id and public.fahrer_sieht_fahrt(jg.job_id)));
create policy fahrer_fahrtgaeste_lesen on public.job_guests for select to authenticated
  using (public.fahrer_sieht_fahrt(job_id));

create policy fahrer_notizen_lesen on public.job_notes for select to authenticated
  using (public.fahrer_sieht_fahrt(job_id));
create policy fahrer_notizen_schreiben on public.job_notes for insert to authenticated
  with check (public.fahrer_sieht_fahrt(job_id));

create policy fahrer_fahrzeuge_lesen on public.vehicles for select to authenticated using (true);

create policy fahrer_schaeden_lesen on public.vehicle_damages for select to authenticated
  using (vehicle_id = public.eigenes_fahrzeug());
create policy fahrer_schaden_melden on public.vehicle_damages for insert to authenticated
  with check (vehicle_id = public.eigenes_fahrzeug());

create policy fahrer_nachrichten_lesen on public.messages for select to authenticated using (true);
create policy fahrer_nachricht_senden on public.messages for insert to authenticated
  with check (sender_id = auth.uid());

create policy fahrer_gelesen_eigene on public.chat_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy fahrer_standorte_lesen on public.driver_live_locations for select to authenticated using (true);
create policy fahrer_standort_eigener_neu on public.driver_live_locations for insert to authenticated
  with check (driver_id = auth.uid());
create policy fahrer_standort_eigener on public.driver_live_locations for update to authenticated
  using (driver_id = auth.uid()) with check (driver_id = auth.uid());
create policy fahrer_verlauf_eigener on public.driver_location_history for insert to authenticated
  with check (driver_id = auth.uid());

commit;
