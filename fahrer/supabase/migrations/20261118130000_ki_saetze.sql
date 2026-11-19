-- Echte Saetze an den KI-Assistenten dauerhaft sichern (18.11., Umbau-Plan Phase 0).
-- ki_protokoll loescht nach 30 Tagen. Fuer Messen und spaeteres Training braucht es die Saetze laenger.
-- Kopiert per Trigger beim Schreiben ins Protokoll: Satz, Art und erkannte Aktion, ohne Antworttext.
-- Passwoerter stehen schon im Protokoll nie (anlegen.ts). Loeschfrist 12 Monate (Saetze enthalten Namen).

create table if not exists public.ki_saetze (
  id uuid primary key,
  erstellt timestamptz not null,
  dispo_id uuid references public.profiles(id) on delete set null,
  frage text not null,
  art text not null,
  aktion jsonb,
  modell text,
  fehler boolean not null default false
);
create index if not exists ki_saetze_erstellt_idx on public.ki_saetze(erstellt desc);

alter table public.ki_saetze enable row level security;
drop policy if exists ki_saetze_dispo_lesen on public.ki_saetze;
create policy ki_saetze_dispo_lesen on public.ki_saetze for select using (public.ist_dispo());

create or replace function public.ki_satz_sichern() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.ki_saetze (id, erstellt, dispo_id, frage, art, aktion, modell, fehler)
  values (new.id, new.erstellt, new.dispo_id, new.frage, new.art, new.aktion, new.modell, new.fehler is not null)
  on conflict (id) do nothing;
  delete from public.ki_saetze where erstellt < now() - interval '12 months';
  return new;
exception when others then
  -- Sichern ist Nebensache, das Protokoll darf daran nie scheitern.
  return new;
end $$;

drop trigger if exists ki_satz_sichern on public.ki_protokoll;
create trigger ki_satz_sichern after insert on public.ki_protokoll
  for each row execute function public.ki_satz_sichern();

-- Was schon im Protokoll steht, einmal uebernehmen.
insert into public.ki_saetze (id, erstellt, dispo_id, frage, art, aktion, modell, fehler)
select id, erstellt, dispo_id, frage, art, aktion, modell, fehler is not null from public.ki_protokoll
on conflict (id) do nothing;
