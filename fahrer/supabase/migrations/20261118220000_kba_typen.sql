-- HSN/TSN und VIN-Regeln (18.11.2026)
--
-- 1. kba_typen: KBA-Typliste SV 4.2 (Pkw, Klasse M). Daten kommen in 20261118220100_kba_typen_daten.sql,
--    erzeugt mit werkzeuge/kba/kba_typen.py. Quelle: Kraftfahrt-Bundesamt.
-- 2. vehicles.hsn / vehicles.tsn (Fahrzeugschein Feld 2.1 / 2.2). Sind beide da, fuellt die DB leere Felder
--    (Modell, Variante, Kraftstoff, Sitze) aus kba_typen. Die Dispo-Formulare fuellen schon beim Tippen.
-- 3. vin_regeln: feste Muster je Hersteller (BMW-Typschluessel, Mercedes-Baumuster, Audi-Modellcode),
--    Quelle und Sicherheit siehe reports/VIN Entschluesselung Flotte.md.
-- 4. vin_typen lernt HSN/TSN mit. Reihenfolge beim Anlegen aus der VIN: gelernt > Regel > Gateway (vPIC/Marke).

create table if not exists public.kba_typen (
  hsn text not null,
  tsn text not null,
  hersteller text,
  marke text,
  handelsname text,
  zugeteilt date,
  klasse text,
  aufbau text,
  kraftstoff_code text,
  kw integer,
  hubraum integer,
  achsen integer,
  antriebsachsen integer,
  sitze integer,
  masse integer,
  brand_model text,
  trim text,
  fuel_type text,
  primary key (hsn, tsn)
);
alter table public.kba_typen enable row level security;
drop policy if exists "angemeldet_lesen" on public.kba_typen;
create policy "angemeldet_lesen" on public.kba_typen for select to authenticated using (true);
grant select on public.kba_typen to authenticated;

alter table public.vehicles add column if not exists hsn text;
alter table public.vehicles add column if not exists tsn text;

alter table public.vin_typen add column if not exists hsn text;
alter table public.vin_typen add column if not exists tsn text;

create table if not exists public.vin_regeln (
  muster text primary key,
  reihenfolge integer not null,
  brand_model text not null,
  trim text,
  fuel_type text,
  seat_count integer,
  sicherheit text not null check (sicherheit in ('belegt', 'gestuetzt', 'unsicher')),
  quelle text
);
alter table public.vin_regeln enable row level security;
drop policy if exists "dispo_lesen" on public.vin_regeln;
create policy "dispo_lesen" on public.vin_regeln for select to authenticated using (public.ist_dispo());

-- Sitze: Standard je Modell (A6 5, X7 7, V-Klasse 7). X7 gibt es auch mit 6, V-Klasse mit 4 bis 8.
-- Was die Dispo korrigiert, lernt vin_typen und gewinnt beim naechsten Auto desselben Typs.
insert into public.vin_regeln (muster, reihenfolge, brand_model, trim, fuel_type, seat_count, sicherheit, quelle) values
  ('^WBA2[12]EN', 10, 'BMW X7', 'xDrive40d', 'Diesel B7', 7, 'belegt', 'bimmer.work/model/g07/21en'),
  ('^WBA2[12]EM', 11, 'BMW X7', 'xDrive40i', 'Super 95', 7, 'belegt', 'bimmer.work/model/g07/21em'),
  ('^WBA3[12]EM', 12, 'BMW X7', 'M60i xDrive', 'Super 95', 7, 'belegt', 'bimmer.work/model/g07/31em'),
  ('^WBA4[12]EM', 13, 'BMW ALPINA XB7', null, 'Super 95', 7, 'belegt', 'bimmer.work/model/g07/41em'),
  ('^WBACW8[12]', 14, 'BMW X7', 'xDrive30d', 'Diesel B7', 7, 'belegt', 'bimmer.work/model/g07/cw81'),
  ('^WBATB4[12]', 15, 'BMW X7', 'xDrive40d', 'Diesel B7', 7, 'belegt', 'bimmer.work/model/g07/tb41'),
  ('^WBACW0[12]', 16, 'BMW X7', 'M50d', 'Diesel B7', 7, 'belegt', 'bimmer.work/model/g07/cw01'),
  ('^WBACW2[12]', 17, 'BMW X7', 'xDrive40i', 'Super 95', 7, 'belegt', 'bimmer.work/model/g07/cw21'),
  ('^WBACX41', 18, 'BMW X7', 'xDrive50i', 'Super 95', 7, 'belegt', 'bimmer.work/model/g07/cx41'),
  ('^WBACX61', 19, 'BMW X7', 'M50i', 'Super 95', 7, 'belegt', 'bimmer.work/model/g07/cx61'),
  ('^(WDF|W1V)4478[01][135]', 30, 'Mercedes-Benz V-Klasse', null, null, 7, 'gestuetzt', 'mbpassion.de Baumuster 447.8xx'),
  ('^(WDF|W1V)4477', 31, 'Mercedes-Benz Vito Tourer', null, null, null, 'gestuetzt', 'mbpassion.de Baumuster 447.7xx'),
  ('^(WDF|W1V)4476', 32, 'Mercedes-Benz Vito', null, null, null, 'gestuetzt', 'mbpassion.de Baumuster 447.6xx'),
  ('^W1VV[MN]L', 33, 'Mercedes-Benz V-Klasse', 'V 300 d', 'Diesel B7', 7, 'unsicher', 'rosier.de Anzeigen'),
  ('^W1VV[MN]K', 34, 'Mercedes-Benz V-Klasse', 'V 250 d', 'Diesel B7', 7, 'unsicher', 'rosier.de Anzeigen'),
  ('^W1VV[MN]J', 35, 'Mercedes-Benz V-Klasse', 'V 220 d', 'Diesel B7', 7, 'unsicher', 'vermutet'),
  ('^WUAZZZF2', 50, 'Audi RS 6', null, 'Super 95', 5, 'gestuetzt', 'Audi VIN Breakdown MY2024 (NHTSA vPIC)'),
  ('^WAUZZZF2', 51, 'Audi A6', null, null, 5, 'gestuetzt', 'Audi VIN Breakdown MY2019 (NHTSA vPIC), auch A7')
on conflict (muster) do update set reihenfolge = excluded.reihenfolge, brand_model = excluded.brand_model,
  trim = excluded.trim, fuel_type = excluded.fuel_type, seat_count = excluded.seat_count,
  sicherheit = excluded.sicherheit, quelle = excluded.quelle;

-- HSN/TSN gesetzt: leere Felder aus der KBA-Liste fuellen. "Leer" beim Modell heisst auch: nur die Marke.
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
  new.seat_count := coalesce(new.seat_count, k.sitze);
  return new;
end;
$function$;

drop trigger if exists trg_fahrzeug_kba_fuellen on public.vehicles;
create trigger trg_fahrzeug_kba_fuellen before insert or update of hsn, tsn on public.vehicles
  for each row execute function public.trisar_fahrzeug_kba_fuellen();

-- Lernen jetzt mit HSN/TSN.
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
  insert into public.vin_typen (typ, brand_model, trim, fuel_type, seat_count, hsn, tsn, vehicle_id)
  values (v_typ, v_name, nullif(trim(new.trim), ''), nullif(trim(new.fuel_type), ''), new.seat_count,
          new.hsn, new.tsn, new.id)
  on conflict (typ) do update
    set brand_model = excluded.brand_model, trim = excluded.trim, fuel_type = excluded.fuel_type,
        seat_count = excluded.seat_count, hsn = coalesce(excluded.hsn, vin_typen.hsn),
        tsn = coalesce(excluded.tsn, vin_typen.tsn), vehicle_id = excluded.vehicle_id, gelernt_am = now();
  -- Schon angelegte Fahrzeuge desselben Typs, die nur die Marke haben, nachziehen.
  update public.vehicles v
     set brand_model = v_name,
         trim = coalesce(v.trim, nullif(trim(new.trim), '')),
         fuel_type = coalesce(nullif(trim(v.fuel_type), ''), nullif(trim(new.fuel_type), '')),
         seat_count = coalesce(v.seat_count, new.seat_count),
         hsn = coalesce(v.hsn, new.hsn),
         tsn = coalesce(v.tsn, new.tsn)
   where v.id <> new.id
     and left(upper(coalesce(v.vin, '')), 8) = v_typ
     and position(' ' in trim(coalesce(v.brand_model, ''))) = 0;
  return null;
end;
$function$;

drop trigger if exists trg_vin_typ_lernen on public.vehicles;
create trigger trg_vin_typ_lernen after insert or update of brand_model, trim, fuel_type, seat_count, vin, hsn, tsn
  on public.vehicles for each row execute function public.trisar_vin_typ_lernen();

-- Anlegen aus der VIN: gelernt > Regel > Gateway.
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
  r public.vin_regeln%rowtype;
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
    if g.typ is null then
      select * into r from public.vin_regeln where v_vin ~ muster order by reihenfolge limit 1;
    end if;
    v_name := coalesce(g.brand_model, r.brand_model,
      nullif(trim(coalesce(nullif(trim(p_marke), ''), 'Unbekannt') || ' ' || coalesce(trim(p_modell), '')), ''));
    -- hsn/tsn loesen trg_fahrzeug_kba_fuellen aus, der fuellt was noch fehlt.
    insert into public.vehicles (brand_model, trim, fuel_type, seat_count, vin, hsn, tsn, neu_erkannt)
    values (v_name, coalesce(g.trim, r.trim), coalesce(g.fuel_type, r.fuel_type), coalesce(g.seat_count, r.seat_count),
            v_vin, g.hsn, g.tsn, true)
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

  return jsonb_build_object('aktion', v_aktion, 'vehicle_id', v_id, 'fahrer', v_fahrer,
    'gelernt', g.typ is not null, 'regel', r.muster);
end;
$function$;

revoke all on function public.trisar_fahrzeug_aus_vin(text, text, text, text) from public, anon, authenticated;
grant execute on function public.trisar_fahrzeug_aus_vin(text, text, text, text) to service_role;
