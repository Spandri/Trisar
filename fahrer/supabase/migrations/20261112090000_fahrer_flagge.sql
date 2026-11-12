-- Flagge am Fahrer: die Dispo markiert ausgewaehlte Fahrer mit einer von drei Flaggen
-- (flagge1 Cyan, flagge2 Violett, flagge3 Koenigsblau). Sie erscheint in Alle Fahrer und als kleine Flagge am Marker auf der Karte.
-- Hoechstens eine Flagge je Fahrer, null = keine.
alter table public.profiles add column if not exists flagge text;

alter table public.profiles drop constraint if exists profiles_flagge_check;
alter table public.profiles
  add constraint profiles_flagge_check check (flagge is null or flagge in ('flagge1', 'flagge2', 'flagge3'));

-- Setzen darf nur die Dispo (und der Server). Ein Fahrer kann seine eigene Zeile bearbeiten,
-- seine Flagge aber nicht aendern.
create or replace function public.flagge_schutz()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.flagge is distinct from old.flagge and auth.uid() is not null and not public.ist_dispo() then
    new.flagge := old.flagge;
  end if;
  return new;
end;
$$;

drop trigger if exists flagge_schutz on public.profiles;
create trigger flagge_schutz before update on public.profiles
  for each row execute function public.flagge_schutz();
