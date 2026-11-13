-- Treffpunkt und Notiz beim Dienststart (13.11.2026).
--
-- Die Dispo kann beim Dienste planen einen Ort (Treffpunkt) und eine Notiz mitschicken. Der Fahrer
-- sieht den Ort in der Dienststart-Karte (Icon + Name, Figma 2908-12498) und beim Antippen wie bei
-- einer Fahrt auf der Karte, darunter die Notiz.
--
-- Eigene Tabelle statt Spalten an driver_service_requests: die Tabelle gehoert supabase_admin,
-- psql als postgres darf dort keine Spalten anlegen (wie dienst_pausen, dienst_aenderung).
-- Ersetzt die Dispo einen Dienst (neue Zeile), wandert der Treffpunkt mit (trisar_dienst_zusammenfuehren).

create table if not exists public.dienst_treffpunkt (
  dienst_id uuid primary key,
  ort_id uuid,          -- eigener Ort der Dispo (Tabelle orte), liefert das Icon
  name text,            -- Anzeigename, z. B. "Bayrischer Hof"
  adresse text,
  lat double precision,
  lng double precision,
  notiz text,
  aktualisiert timestamptz not null default now()
);
alter table public.dienst_treffpunkt enable row level security;

drop policy if exists dienst_treffpunkt_dispo on public.dienst_treffpunkt;
create policy dienst_treffpunkt_dispo on public.dienst_treffpunkt for all
  using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists dienst_treffpunkt_fahrer on public.dienst_treffpunkt;
create policy dienst_treffpunkt_fahrer on public.dienst_treffpunkt for select
  using (exists (select 1 from public.driver_service_requests d where d.id = dienst_id and d.driver_id = auth.uid()));
grant select, insert, update, delete on public.dienst_treffpunkt to authenticated;
grant all on public.dienst_treffpunkt to service_role;

-- Fahrer-Apps hoeren live mit (neuer Treffpunkt ohne Neuladen).
do $$
begin
  alter publication supabase_realtime add table public.dienst_treffpunkt;
exception when duplicate_object then null;
end $$;

-- Ersetzte Dienste: Treffpunkt wie Pausen zur neuen Zeile mitnehmen (sonst unveraendert aus
-- 20261112050000_dienst_aenderung_einzeln).
create or replace function public.trisar_dienst_zusammenfuehren(p_neu_id uuid, p_fahrer uuid, p_tag date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  alt record;
begin
  perform set_config('trisar.dienst_ersetzt', '1', true);
  for alt in
    select * from public.driver_service_requests
     where driver_id = p_fahrer and service_date = p_tag and id <> p_neu_id
       and lower(coalesce(status, '')) <> 'refused'
  loop
    -- Pausen: die neue Zeile behaelt ihre eigenen, sonst die des alten Dienstes.
    if exists (select 1 from public.dienst_pausen where dienst_id = alt.id) then
      if exists (select 1 from public.dienst_pausen where dienst_id = p_neu_id) then
        delete from public.dienst_pausen where dienst_id = alt.id;
      else
        update public.dienst_pausen set dienst_id = p_neu_id where dienst_id = alt.id;
      end if;
    end if;
    -- Treffpunkt und Notiz (13.11.): wie Pausen, die neue Zeile behaelt ihre eigenen, sonst die alten.
    if exists (select 1 from public.dienst_treffpunkt where dienst_id = alt.id) then
      if exists (select 1 from public.dienst_treffpunkt where dienst_id = p_neu_id) then
        delete from public.dienst_treffpunkt where dienst_id = alt.id;
      else
        update public.dienst_treffpunkt set dienst_id = p_neu_id where dienst_id = alt.id;
      end if;
    end if;
    -- Stundenzettel: zum neuen Dienst, wenn der noch keinen hat.
    if not exists (select 1 from public.stundenzettel where dienst_id = p_neu_id) then
      update public.stundenzettel set dienst_id = p_neu_id where dienst_id = alt.id;
    end if;
    delete from public.dienst_aenderung where dienst_id = alt.id;
    delete from public.driver_service_requests where id = alt.id;
  end loop;
  perform set_config('trisar.dienst_ersetzt', '', true);
end;
$$;
revoke all on function public.trisar_dienst_zusammenfuehren(uuid, uuid, date) from public, anon, authenticated;
