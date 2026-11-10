-- NFC-Tags: Fahrer tippt den Tag am Tracker an und uebernimmt damit Tracker und Fahrzeug.
-- Der Tag traegt nur einen zufaelligen Code. Wirksam ist er nur mit angemeldetem Fahrer.
-- Welcher Tracker in welchem Auto steckt (obd_tracker.vehicle_id), legt die Dispo am Fahrzeug fest.

alter table public.obd_tracker
  add column if not exists nfc_code text,
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;

update public.obd_tracker
  set nfc_code = substr(replace(gen_random_uuid()::text, '-', ''), 1, 18)
  where nfc_code is null;

alter table public.obd_tracker
  alter column nfc_code set default substr(replace(gen_random_uuid()::text, '-', ''), 1, 18),
  alter column nfc_code set not null;

create unique index if not exists obd_tracker_nfc_code_idx on public.obd_tracker (nfc_code);

-- Protokoll jedes Antippens, Grundlage fuer das spaetere Fahrtenbuch.
create table if not exists public.nfc_scan (
  id uuid primary key default gen_random_uuid(),
  nfc_code text not null,
  imei text,
  driver_id uuid references public.profiles(id) on delete set null,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vorher_driver_id uuid references public.profiles(id) on delete set null,
  ergebnis text not null,
  erstellt timestamptz not null default now()
);

alter table public.nfc_scan enable row level security;
drop policy if exists dispo_alles on public.nfc_scan;
create policy dispo_alles on public.nfc_scan
  for all to authenticated using (public.ist_dispo()) with check (public.ist_dispo());

create or replace function public.trisar_nfc_uebernehmen(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_fahrer uuid := auth.uid();
  v_rolle text;
  v_tracker public.obd_tracker%rowtype;
  v_vorher uuid;
  v_vorher_name text;
  v_mein_fahrzeug uuid;
  v_name text;
  v_schon boolean;
  v_trip_statuses constant text[] := array['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
begin
  if v_fahrer is null then
    return jsonb_build_object('ok', false, 'grund', 'nicht_angemeldet', 'meldung', 'Bitte zuerst anmelden.');
  end if;

  select lower(coalesce(role, '')), vehicle_id into v_rolle, v_mein_fahrzeug from public.profiles where id = v_fahrer;
  select * into v_tracker from public.obd_tracker where nfc_code = lower(trim(p_code));

  if v_tracker.imei is null then
    insert into public.nfc_scan (nfc_code, driver_id, ergebnis) values (left(coalesce(p_code, ''), 64), v_fahrer, 'unbekannt');
    return jsonb_build_object('ok', false, 'grund', 'unbekannt', 'meldung', 'Diesen Tag kenne ich nicht.');
  end if;

  if v_rolle is distinct from 'fahrer' then
    insert into public.nfc_scan (nfc_code, imei, driver_id, vehicle_id, ergebnis)
      values (v_tracker.nfc_code, v_tracker.imei, v_fahrer, v_tracker.vehicle_id, 'keine_fahrer_rolle');
    return jsonb_build_object('ok', false, 'grund', 'keine_fahrer_rolle', 'meldung', 'Nur Fahrer können ein Fahrzeug übernehmen.');
  end if;

  select driver_id into v_vorher from public.imei_driver_map where imei = v_tracker.imei and is_active;

  -- Eine laufende Fahrt nicht wegnehmen, sonst reisst die Ortung mitten in der Fahrt ab.
  if v_vorher is not null and v_vorher <> v_fahrer and exists (
    select 1 from public.jobs j
    where j.driver_id = v_vorher and lower(coalesce(j.status, '')) = any (v_trip_statuses)
  ) then
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_vorher_name from public.profiles where id = v_vorher;
    insert into public.nfc_scan (nfc_code, imei, driver_id, vehicle_id, vorher_driver_id, ergebnis)
      values (v_tracker.nfc_code, v_tracker.imei, v_fahrer, v_tracker.vehicle_id, v_vorher, 'laufende_fahrt');
    return jsonb_build_object('ok', false, 'grund', 'laufende_fahrt',
      'meldung', 'Dieses Fahrzeug ist gerade auf einer laufenden Fahrt von ' || v_vorher_name || '.');
  end if;

  select trim(coalesce(brand_model, '') || ' ' || coalesce(license_plate, '')) into v_name
    from public.vehicles where id = v_tracker.vehicle_id;

  v_schon := v_vorher = v_fahrer and (v_tracker.vehicle_id is null or v_mein_fahrzeug = v_tracker.vehicle_id);
  if v_schon then
    insert into public.nfc_scan (nfc_code, imei, driver_id, vehicle_id, vorher_driver_id, ergebnis)
      values (v_tracker.nfc_code, v_tracker.imei, v_fahrer, v_tracker.vehicle_id, v_vorher, 'schon_verbunden');
    return jsonb_build_object('ok', true, 'grund', 'schon_verbunden',
      'meldung', 'Du bist schon mit ' || coalesce(v_name, 'Tracker ' || v_tracker.nummer) || ' verbunden.');
  end if;

  -- Bisheriger Fahrer wird wieder ueber sein Handy geortet.
  if v_vorher is not null and v_vorher <> v_fahrer then
    update public.profiles set tracking_mode = 'app' where id = v_vorher;
    select trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')) into v_vorher_name from public.profiles where id = v_vorher;
  end if;

  -- Je Fahrer darf nur ein Tracker aktiv sein.
  update public.imei_driver_map set is_active = false where driver_id = v_fahrer and imei <> v_tracker.imei and is_active;
  insert into public.imei_driver_map (imei, driver_id, is_active)
    values (v_tracker.imei, v_fahrer, true)
    on conflict (imei) do update set driver_id = excluded.driver_id, is_active = true;
  update public.profiles set tracking_mode = 'obd' where id = v_fahrer;

  -- Ein Auto hat einen Fahrer.
  if v_tracker.vehicle_id is not null then
    update public.profiles set vehicle_id = null where vehicle_id = v_tracker.vehicle_id and id <> v_fahrer;
    update public.profiles set vehicle_id = v_tracker.vehicle_id where id = v_fahrer;
  end if;

  insert into public.nfc_scan (nfc_code, imei, driver_id, vehicle_id, vorher_driver_id, ergebnis)
    values (v_tracker.nfc_code, v_tracker.imei, v_fahrer, v_tracker.vehicle_id, v_vorher, 'uebernommen');

  return jsonb_build_object('ok', true, 'grund', 'uebernommen',
    'meldung', coalesce('Du fährst jetzt ' || v_name, 'Tracker ' || v_tracker.nummer || ' ist jetzt mit dir verbunden')
      || case when v_vorher_name is not null and v_vorher_name <> '' then '. Vorher bei ' || v_vorher_name || '.' else '.' end);
end;
$$;

revoke all on function public.trisar_nfc_uebernehmen(text) from public, anon;
grant execute on function public.trisar_nfc_uebernehmen(text) to authenticated;
