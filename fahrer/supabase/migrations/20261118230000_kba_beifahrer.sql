-- vehicles.seat_count ist die Beifahreranzahl (Formular "Beifahreranzahl"), die KBA-Liste zaehlt den
-- Fahrersitz mit. Fuellen aus kba_typen darum mit sitze - 1, Regel-Standards ebenso (18.11.2026).

create or replace function public.trisar_fahrzeug_kba_fuellen()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  k public.kba_typen%rowtype;
begin
  new.hsn := nullif(upper(trim(coalesce(new.hsn, ''))), '');
  new.tsn := nullif(upper(trim(coalesce(new.tsn, ''))), '');
  if new.hsn is null or new.tsn is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.hsn is not distinct from old.hsn and new.tsn is not distinct from old.tsn then
    return new;
  end if;
  select * into k from public.kba_typen where hsn = new.hsn and tsn = new.tsn;
  if k.hsn is null then
    return new;
  end if;
  if position(' ' in trim(coalesce(new.brand_model, ''))) = 0 and k.brand_model is not null then
    new.brand_model := k.brand_model;
  end if;
  new.trim := coalesce(nullif(trim(new.trim), ''), k.trim);
  new.fuel_type := coalesce(nullif(trim(new.fuel_type), ''), k.fuel_type);
  new.seat_count := coalesce(new.seat_count, case when k.sitze > 1 then k.sitze - 1 end);
  return new;
end;
$function$;

-- Standards waren Sitze inkl. Fahrer (A6 5, X7 7, V-Klasse 7), jetzt Beifahrer.
update public.vin_regeln set seat_count = seat_count - 1 where seat_count is not null and quelle not like '%Beifahrer%';
update public.vin_regeln set quelle = quelle || ' (Beifahrer)' where seat_count is not null and quelle not like '%Beifahrer%';
