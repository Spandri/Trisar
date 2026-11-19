-- Schaden: wer hat ihn gemeldet (18.11.2026)
--
-- vehicle_damages.reported_by ist schon das angemeldete Konto (Default auth.uid()), auch wenn die Dispo meldet.
-- Fahrer duerfen fremde Profile nicht lesen, darum steht der Name fertig in gemeldet_von:
-- "Vorname Nachname", bei Dispo-Konten mit " (Dispo)" dahinter. Gesetzt beim Anlegen, alte Zeilen nachgetragen.

alter table public.vehicle_damages add column if not exists gemeldet_von text;

create or replace function public.trisar_schaden_gemeldet_von_name(p_user uuid)
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select nullif(trim(concat_ws(' ', p.first_name, p.last_name)), '')
         || case when lower(coalesce(p.role, '')) in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator')
                 then ' (Dispo)' else '' end
    from public.profiles p where p.id = p_user;
$function$;

create or replace function public.trisar_schaden_gemeldet_von()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if new.gemeldet_von is null and new.reported_by is not null then
    new.gemeldet_von := public.trisar_schaden_gemeldet_von_name(new.reported_by);
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_schaden_gemeldet_von on public.vehicle_damages;
create trigger trg_schaden_gemeldet_von before insert on public.vehicle_damages
  for each row execute function public.trisar_schaden_gemeldet_von();

update public.vehicle_damages
   set gemeldet_von = public.trisar_schaden_gemeldet_von_name(reported_by)
 where gemeldet_von is null and reported_by is not null;
