-- "Fahrer seit 5 Minuten ohne Signal" (dispo_ohne_signal) standardmaessig aus (17.11.2026, Wunsch User).
-- Abgeschaltete Arten stehen in push_einstellungen.aus, die Apps zeigen sie dort als aus und koennen sie
-- wieder einschalten. Darum: jedes Dispo-Konto bekommt die Art beim Anlegen (bzw. sobald es Dispo wird)
-- in aus eingetragen, und die bestehenden Dispo-Konten einmalig jetzt.

create or replace function public.push_dispo_standard_aus()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.is_dispo, false)
     or lower(coalesce(new.role, '')) in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator') then
    -- Nur wenn es noch keine Einstellungen gibt, eine eigene Wahl bleibt unberuehrt.
    insert into public.push_einstellungen (user_id, aus)
    values (new.id, array['dispo_ohne_signal'])
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists push_dispo_standard_aus on public.profiles;
create trigger push_dispo_standard_aus after insert or update of role, is_dispo on public.profiles
  for each row execute function public.push_dispo_standard_aus();

-- Bestehende Dispo-Konten einmalig: Art in aus aufnehmen, falls sie dort noch fehlt.
insert into public.push_einstellungen (user_id, aus)
select p.id, array['dispo_ohne_signal']
from public.profiles p
where coalesce(p.is_dispo, false)
   or lower(coalesce(p.role, '')) in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator')
on conflict (user_id) do update
  set aus = case when 'dispo_ohne_signal' = any (push_einstellungen.aus) then push_einstellungen.aus
                 else push_einstellungen.aus || 'dispo_ohne_signal'::text end;
