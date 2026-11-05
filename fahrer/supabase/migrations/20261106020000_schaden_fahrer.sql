-- Wer hat den Schaden gemeldet? Die Apps schreiben die Spalte nicht selbst: der Standardwert
-- ist das angemeldete Konto (auth.uid()), damit gilt es fuer Web, iOS und Android sofort.

alter table public.vehicle_damages
  add column if not exists reported_by uuid references public.profiles(id) on delete set null default auth.uid();

-- Alte Meldungen: dem Fahrer zuordnen, dem das Fahrzeug jetzt gehoert (bessere Angabe gibt es nicht).
update public.vehicle_damages d
set reported_by = (select p.id from public.profiles p where p.vehicle_id = d.vehicle_id order by p.id limit 1)
where d.reported_by is null and coalesce(d.reported_by_driver, false);

-- Mitteilung an die Dispo nennt jetzt den Fahrer.
create or replace function public.push_schaden_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d uuid;
begin
  for d in select public.push_dispo_konten() loop
    perform public.push_melden(d, 'dispo', 'dispo_schaden', 'Schaden gemeldet',
      coalesce((select v.license_plate from public.vehicles v where v.id = new.vehicle_id), 'Fahrzeug')
        || coalesce(': ' || nullif(trim(new.part_name), ''), '')
        || coalesce(' (' || public.push_name(new.reported_by) || ')', '')
        || coalesce(' – ' || left(nullif(trim(new.description), ''), 120), ''),
      jsonb_build_object('ziel', 'fahrzeug', 'vehicle_id', new.vehicle_id));
  end loop;
  return new;
end;
$$;
