-- Lernende Typschluessel-Tabelle (18.11.2026)
--
-- Zeichen 1 bis 8 der VIN (Hersteller + Typschluessel, z. B. WBA21EN0) stehen fuer ein Modell. Freie Decoder
-- kennen europaeische Typschluessel kaum, darum lernt TRISAR sie selbst: Hat ein Fahrzeug mit VIN ein Modell
-- (mehr als nur die Marke, also mit Leerzeichen, z. B. "BMW 520d Touring"), merkt sich vin_typen Modell,
-- Kraftstoff und Sitze. Neu erkannte Fahrzeuge desselben Typs bekommen das beim Anlegen, schon angelegte
-- (noch nur mit Marke) werden nachgezogen. Die Farbe steht nicht in der VIN und wird nie gelernt.

create table if not exists public.vin_typen (
  typ text primary key check (typ ~ '^[A-HJ-NPR-Z0-9]{8}$'),
  brand_model text not null,
  trim text,
  fuel_type text,
  seat_count integer,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  gelernt_am timestamptz not null default now()
);
alter table public.vin_typen enable row level security;
drop policy if exists "dispo_lesen" on public.vin_typen;
create policy "dispo_lesen" on public.vin_typen for select to authenticated using (public.ist_dispo());

create or replace function public.trisar_vin_typ_lernen()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_typ text := left(upper(coalesce(trim(new.vin), '')), 8);
  v_name text := trim(coalesce(new.brand_model, ''));
begin
  if v_typ !~ '^[A-HJ-NPR-Z0-9]{8}$' or position(' ' in v_name) = 0 then
    return null;
  end if;
  insert into public.vin_typen (typ, brand_model, trim, fuel_type, seat_count, vehicle_id)
  values (v_typ, v_name, nullif(trim(new.trim), ''), nullif(trim(new.fuel_type), ''), new.seat_count, new.id)
  on conflict (typ) do update
    set brand_model = excluded.brand_model, trim = excluded.trim, fuel_type = excluded.fuel_type,
        seat_count = excluded.seat_count, vehicle_id = excluded.vehicle_id, gelernt_am = now();
  -- Schon angelegte Fahrzeuge desselben Typs, die nur die Marke haben, nachziehen.
  update public.vehicles v
     set brand_model = v_name,
         trim = coalesce(v.trim, nullif(trim(new.trim), '')),
         fuel_type = coalesce(nullif(trim(v.fuel_type), ''), nullif(trim(new.fuel_type), '')),
         seat_count = coalesce(v.seat_count, new.seat_count)
   where v.id <> new.id
     and left(upper(coalesce(v.vin, '')), 8) = v_typ
     and position(' ' in trim(coalesce(v.brand_model, ''))) = 0;
  return null;
end;
$function$;

drop trigger if exists trg_vin_typ_lernen on public.vehicles;
create trigger trg_vin_typ_lernen after insert or update of brand_model, trim, fuel_type, seat_count, vin on public.vehicles
  for each row execute function public.trisar_vin_typ_lernen();

-- Bestehende Fahrzeuge mit VIN und Modell einmal lernen.
insert into public.vin_typen (typ, brand_model, trim, fuel_type, seat_count, vehicle_id)
select distinct on (left(upper(trim(v.vin)), 8))
       left(upper(trim(v.vin)), 8), trim(v.brand_model), nullif(trim(v.trim), ''), nullif(trim(v.fuel_type), ''), v.seat_count, v.id
  from public.vehicles v
 where left(upper(coalesce(trim(v.vin), '')), 8) ~ '^[A-HJ-NPR-Z0-9]{8}$'
   and position(' ' in trim(coalesce(v.brand_model, ''))) > 0
 order by left(upper(trim(v.vin)), 8), v.updated_at desc
on conflict (typ) do nothing;

-- Beim Anlegen aus der VIN zuerst die gelernte Tabelle fragen.
create or replace function public.trisar_fahrzeug_aus_vin(p_imei text, p_vin text, p_marke text, p_modell text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_vin text := upper(trim(coalesce(p_vin, '')));
  t public.obd_tracker%rowtype;
  g public.vin_typen%rowtype;
  v_id uuid;
  v_fahrer uuid;
  v_aktion text;
  v_name text;
  d uuid;
begin
  if v_vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
    return jsonb_build_object('aktion', 'ungueltig');
  end if;
  select * into t from public.obd_tracker where imei = p_imei;
  if t.imei is null then
    return jsonb_build_object('aktion', 'tracker_unbekannt');
  end if;

  select id into v_id from public.vehicles where upper(vin) = v_vin;
  if v_id is not null then
    v_aktion := 'bekannt';
  elsif t.vehicle_id is not null
        and exists (select 1 from public.vehicles v where v.id = t.vehicle_id and coalesce(trim(v.vin), '') = '') then
    update public.vehicles set vin = v_vin where id = t.vehicle_id;
    v_id := t.vehicle_id;
    v_aktion := 'vin_eingetragen';
  else
    select * into g from public.vin_typen where typ = left(v_vin, 8);
    v_name := coalesce(g.brand_model,
      nullif(trim(coalesce(nullif(trim(p_marke), ''), 'Unbekannt') || ' ' || coalesce(trim(p_modell), '')), ''));
    insert into public.vehicles (brand_model, trim, fuel_type, seat_count, vin, neu_erkannt)
    values (v_name, g.trim, g.fuel_type, g.seat_count, v_vin, true)
    returning id into v_id;
    v_aktion := 'angelegt';
  end if;

  -- Ein Auto hat einen Tracker.
  if t.vehicle_id is distinct from v_id then
    update public.obd_tracker set vehicle_id = null where vehicle_id = v_id and imei <> t.imei;
    update public.obd_tracker set vehicle_id = v_id where imei = t.imei;
  end if;

  select driver_id into v_fahrer from public.imei_driver_map where imei = t.imei and is_active limit 1;
  if v_fahrer is not null then
    update public.profiles set vehicle_id = v_id where id = v_fahrer and vehicle_id is distinct from v_id;
  end if;

  if v_aktion = 'angelegt' then
    for d in select public.push_dispo_konten() loop
      perform public.push_melden(d, 'dispo', 'dispo_fahrzeug_neu', 'Neues Fahrzeug erkannt',
        v_name || ' in Tracker ' || t.nummer || coalesce(' · ' || public.push_name(v_fahrer), ''),
        jsonb_build_object('ziel', 'fahrzeug', 'vehicle_id', v_id));
    end loop;
  end if;

  return jsonb_build_object('aktion', v_aktion, 'vehicle_id', v_id, 'fahrer', v_fahrer, 'gelernt', g.typ is not null);
end;
$function$;

revoke all on function public.trisar_fahrzeug_aus_vin(text, text, text, text) from public, anon, authenticated;
grant execute on function public.trisar_fahrzeug_aus_vin(text, text, text, text) to service_role;
