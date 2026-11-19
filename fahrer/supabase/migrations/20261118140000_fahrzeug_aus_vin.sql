-- Fahrzeug automatisch aus der VIN des OBD-Trackers (18.11.2026)
--
-- Das Gateway meldet die VIN, die der Tracker aus dem Auto liest. Bisher wurde sie einfach auf das Fahrzeug
-- des verbundenen Fahrers geschrieben (so landete eine BMW-VIN auf einer V-Klasse). Jetzt:
--   1. VIN schon bekannt: dieses Fahrzeug.
--   2. Tracker ist einem Fahrzeug ohne VIN zugeordnet: VIN dort eintragen.
--   3. Sonst neues Fahrzeug (Marke/Modell vom Gateway), markiert als neu_erkannt, Push an die Dispo.
-- Danach sitzt der Tracker in diesem Fahrzeug und der verbundene Fahrer faehrt es.
-- neu_erkannt faellt weg, sobald ein Kennzeichen eingetragen ist.

alter table public.vehicles add column if not exists neu_erkannt boolean not null default false;

create or replace function public.trisar_fahrzeug_neu_aus()
 returns trigger
 language plpgsql
as $function$
begin
  if new.neu_erkannt and coalesce(trim(new.license_plate), '') <> '' then
    new.neu_erkannt := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_fahrzeug_neu_aus on public.vehicles;
create trigger trg_fahrzeug_neu_aus before insert or update on public.vehicles
  for each row execute function public.trisar_fahrzeug_neu_aus();

create or replace function public.trisar_fahrzeug_aus_vin(p_imei text, p_vin text, p_marke text, p_modell text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_vin text := upper(trim(coalesce(p_vin, '')));
  t public.obd_tracker%rowtype;
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
    v_name := nullif(trim(coalesce(nullif(trim(p_marke), ''), 'Unbekannt') || ' ' || coalesce(trim(p_modell), '')), '');
    insert into public.vehicles (brand_model, vin, neu_erkannt)
    values (v_name, v_vin, true)
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

  return jsonb_build_object('aktion', v_aktion, 'vehicle_id', v_id, 'fahrer', v_fahrer);
end;
$function$;

revoke all on function public.trisar_fahrzeug_aus_vin(text, text, text, text) from public, anon, authenticated;
grant execute on function public.trisar_fahrzeug_aus_vin(text, text, text, text) to service_role;
