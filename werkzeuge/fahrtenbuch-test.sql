-- Testfaelle Fahrtenbuch. Laeuft in einer Transaktion, die fahrtenbuch-test.sh zurueckrollt.
\set ON_ERROR_STOP on
create temp table t_erg (nr serial, name text, ok boolean, ist text, soll text);
create or replace function pg_temp.pruef(p_name text, p_ist anyelement, p_soll anyelement) returns void
language sql as $$ insert into t_erg (name, ok, ist, soll) values (p_name, p_ist is not distinct from p_soll, p_ist::text, p_soll::text) $$;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1'), ('00000000-0000-0000-0000-0000000000d2')
  on conflict do nothing;
insert into public.vehicles (id, brand_model, license_plate) values
  ('00000000-0000-0000-0000-0000000000a1', 'BMW X7', 'M-TE 1001'),
  ('00000000-0000-0000-0000-0000000000a3', 'BMW 7er', 'M-TE 1003'),
  ('00000000-0000-0000-0000-0000000000a2', 'V-Klasse', 'M-TE 1002');
insert into public.profiles (id, first_name, last_name, role, vehicle_id) values
  ('00000000-0000-0000-0000-0000000000d1', 'Test', 'Tracker', 'driver', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000d2', 'Test', 'Ohne', 'driver', '00000000-0000-0000-0000-0000000000a2')
  on conflict (id) do update set vehicle_id = excluded.vehicle_id, first_name = excluded.first_name, last_name = excluded.last_name;
update public.vehicles set vin = 'wbatest0000000001' where id = '00000000-0000-0000-0000-0000000000a1';
update public.vehicles set vin = 'WBATEST0000000003' where id = '00000000-0000-0000-0000-0000000000a3';
insert into public.obd_tracker (imei, nummer, modell, vehicle_id) values
  ('999999999999991', 9991, 'Test', '00000000-0000-0000-0000-0000000000a1');
insert into public.imei_driver_map (imei, driver_id, is_active) values
  ('999999999999991', '00000000-0000-0000-0000-0000000000d1', true);

-- 1 Tracker meldet Stand
insert into public.vehicle_telemetry_live (driver_id, imei, captured_at, ignition, oem_mileage_km, total_odometer_km)
values ('00000000-0000-0000-0000-0000000000d1', '999999999999991', now(), true, 1000, 500.000);
select pg_temp.pruef('Kilometerstand am Auto', (select km_stand from vehicles where id = '00000000-0000-0000-0000-0000000000a1'), 1000.0::numeric);
select pg_temp.pruef('Verlauf erster Eintrag', (select count(*) from fahrzeug_km_stand where vehicle_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint);
update public.vehicle_telemetry_live set oem_mileage_km = 1000, total_odometer_km = 500.300 where driver_id = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.pruef('Verlauf nicht je Paket', (select count(*) from fahrzeug_km_stand where vehicle_id = '00000000-0000-0000-0000-0000000000a1'), 1::bigint);
update public.vehicle_telemetry_live set total_odometer_km = 500.000 where driver_id = '00000000-0000-0000-0000-0000000000d1';

-- 2 Fahrt 1 mit Tracker
insert into public.jobs (id, driver_id, pickup_address, dropoff_address, pickup_name, dropoff_name, ride_date, etd, status, ext_route_distance_m)
values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 'Strasse 1, Muenchen', 'Strasse 2, Muenchen', 'MUC T2', 'Bayerischer Hof', current_date, '10:00', 'assigned', 38000);
update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.pruef('Start: Tacho', (select km_start from jobs where id = '00000000-0000-0000-0000-0000000000f1'), 1000.0::numeric);
select pg_temp.pruef('Start: Auto', (select km_fahrzeug_id from jobs where id = '00000000-0000-0000-0000-0000000000f1'), '00000000-0000-0000-0000-0000000000a1'::uuid);
select pg_temp.pruef('Start: vehicle_id unberuehrt', (select vehicle_id from jobs where id = '00000000-0000-0000-0000-0000000000f1'), null::uuid);
update public.vehicle_telemetry_live set oem_mileage_km = 1012, total_odometer_km = 512.400 where driver_id = '00000000-0000-0000-0000-0000000000d1';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-0000000000f1';
select pg_temp.pruef('Fahrt 1 km', (select km_gefahren from jobs where id = '00000000-0000-0000-0000-0000000000f1'), 12.4::numeric);
select pg_temp.pruef('Fahrt 1 Quelle', (select km_quelle from jobs where id = '00000000-0000-0000-0000-0000000000f1'), 'tacho');
select pg_temp.pruef('Buch: Zeile Fahrt 1', (select art || ' ' || km || ' ' || kennzeichen || ' ' || fahrer from fahrtenbuch_gueltig where job_id = '00000000-0000-0000-0000-0000000000f1'), 'gast 12.4 M-TE 1001 Test Tracker');

-- 3 Leerfahrt und Fahrt 2
update public.vehicle_telemetry_live set oem_mileage_km = 1020, total_odometer_km = 520.100 where driver_id = '00000000-0000-0000-0000-0000000000d1';
insert into public.jobs (id, driver_id, pickup_address, dropoff_address, pickup_name, dropoff_name, ride_date, etd, status)
values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', 'Strasse 1, Muenchen', 'Strasse 2, Muenchen', 'Messe Ost', 'MUC T1', current_date, '12:00', 'assigned');
update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.pruef('Leerfahrt', (select km || ' ' || von || ' > ' || nach from fahrtenbuch_gueltig where job_id = '00000000-0000-0000-0000-0000000000f2' and art = 'leer'), '7.7 Bayerischer Hof > Messe Ost');
update public.vehicle_telemetry_live set oem_mileage_km = 1030, total_odometer_km = 530.000 where driver_id = '00000000-0000-0000-0000-0000000000d1';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.pruef('Fahrt 2 km', (select km_gefahren from jobs where id = '00000000-0000-0000-0000-0000000000f2'), 9.9::numeric);
select pg_temp.pruef('Summe = Weg des Autos', (select sum(km) from fahrtenbuch_gueltig where vehicle_id = '00000000-0000-0000-0000-0000000000a1'), 30.0::numeric);

-- 4 Zaehler passt nicht zum Tacho: Tacho gilt
select pg_temp.pruef('Tacho gilt bei Abweichung', (select km from trisar_km_differenz(1000, 1020, 500, 510)), 20::numeric);
select pg_temp.pruef('Tacho rueckwaerts: nichts', (select km from trisar_km_differenz(1000, 900, null, null)), null::numeric);

-- 5 Beendete Fahrt zurueck auf unterwegs und wieder beendet
update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.pruef('Wieder offen: Start bleibt', (select km_start from jobs where id = '00000000-0000-0000-0000-0000000000f2'), 1020.0::numeric);
select pg_temp.pruef('Wieder offen: Zeile gilt nicht mehr', (select count(*) from fahrtenbuch_gueltig where job_id = '00000000-0000-0000-0000-0000000000f2' and art = 'gast'), 0::bigint);
update public.vehicle_telemetry_live set oem_mileage_km = 1033, total_odometer_km = 533.000 where driver_id = '00000000-0000-0000-0000-0000000000d1';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.pruef('Neu beendet: eine gueltige Zeile', (select count(*) || ' ' || max(km) from fahrtenbuch_gueltig where job_id = '00000000-0000-0000-0000-0000000000f2' and art = 'gast'), '1 12.9');
select pg_temp.pruef('Alte Zeilen bleiben', (select count(*) from fahrtenbuch where job_id = '00000000-0000-0000-0000-0000000000f2'), 4::bigint);

-- 6 Zurueck auf offen
update public.jobs set status = 'assigned' where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.pruef('Offen: km leer', (select km_gefahren from jobs where id = '00000000-0000-0000-0000-0000000000f2'), null::numeric);
select pg_temp.pruef('Offen: Fahrt-Zeile storniert', (select count(*) from fahrtenbuch_gueltig where job_id = '00000000-0000-0000-0000-0000000000f2' and art = 'gast'), 0::bigint);

-- 7 Fahrer ohne Tracker: geplante Route
insert into public.jobs (id, driver_id, pickup_address, dropoff_address, pickup_name, dropoff_name, ride_date, etd, status, ext_route_distance_m)
values ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d2', 'Strasse 1, Muenchen', 'Strasse 2, Muenchen', 'Hbf', 'Allianz Arena', current_date, '14:00', 'assigned', 15040);
update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-0000000000f3';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-0000000000f3';
select pg_temp.pruef('Ohne Tracker', (select km_gefahren || ' ' || km_quelle from jobs where id = '00000000-0000-0000-0000-0000000000f3'), '15.0 route');
select pg_temp.pruef('Ohne Tracker: Auto aus Profil', (select kennzeichen from fahrtenbuch_gueltig where job_id = '00000000-0000-0000-0000-0000000000f3'), 'M-TE 1002');

-- 8 Ohne Tracker mit GPS-Spur (rund 2,2 km nach Norden in 5 Schritten)
insert into public.jobs (id, driver_id, pickup_address, dropoff_address, pickup_name, dropoff_name, ride_date, etd, status, ext_route_distance_m)
values ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d2', 'Strasse 1, Muenchen', 'Strasse 2, Muenchen', 'A', 'B', current_date, '16:00', 'assigned', 2500);
update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-0000000000f4';
update public.jobs set abfahrt_echt = now() - interval '10 minutes' where id = '00000000-0000-0000-0000-0000000000f4';
-- Quelle teltonika, sonst verwirft trg_ortung_nur_im_dienst die Punkte ausserhalb des Dienstes
insert into public.driver_location_history (driver_id, lat, lng, source, captured_at)
select '00000000-0000-0000-0000-0000000000d2', 48.1000 + g * 0.004, 11.5000, 'teltonika', now() - interval '9 minutes' + g * interval '1 minute'
  from generate_series(0, 5) g;
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-0000000000f4';
select pg_temp.pruef('GPS-Spur', (select km_gefahren || ' ' || km_quelle from jobs where id = '00000000-0000-0000-0000-0000000000f4'), '2.2 gps_spur');

-- 9 Tracker gehoert dem Fahrer nicht mehr: kein Tacho
update public.imei_driver_map set is_active = false where imei = '999999999999991';
select pg_temp.pruef('Tracker abgegeben', (select tacho from trisar_km_jetzt('00000000-0000-0000-0000-0000000000d1', null)), null::numeric);

-- 11 Fahrgestellnummer: Zeilen tragen die VIN. Kennzeichen ist eindeutig (vehicles_license_plate_key),
-- ein neu vergebenes Kennzeichen heisst also: VIN im selben Datensatz wird getauscht (siehe unten).
select pg_temp.pruef('VIN an der Zeile', (select vin from fahrtenbuch_gueltig where job_id = '00000000-0000-0000-0000-0000000000f1'), 'WBATEST0000000001');
select pg_temp.pruef('VIN im Verlauf', (select count(*) from fahrzeug_km_stand where vin = 'WBATEST0000000001'), (select count(*) from fahrzeug_km_stand where vehicle_id = '00000000-0000-0000-0000-0000000000a1'));
update public.profiles set vehicle_id = '00000000-0000-0000-0000-0000000000a3', role = 'dispo' where id = '00000000-0000-0000-0000-0000000000d2';
insert into public.jobs (id, driver_id, pickup_address, dropoff_address, pickup_name, dropoff_name, ride_date, etd, status, ext_route_distance_m)
values ('00000000-0000-0000-0000-0000000000f5', '00000000-0000-0000-0000-0000000000d2', 'Strasse 1, Muenchen', 'Strasse 2, Muenchen', 'C', 'D', current_date, '18:00', 'assigned', 7000);
update public.jobs set status = 'in_progress' where id = '00000000-0000-0000-0000-0000000000f5';
update public.jobs set status = 'done' where id = '00000000-0000-0000-0000-0000000000f5';
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d2', true);
select pg_temp.pruef('Anderer Wagen: nur eigene Fahrt',
  (select (fahrtenbuch_lesen('00000000-0000-0000-0000-0000000000a3') ->> 'anzahl') || ' ' || (fahrtenbuch_lesen('00000000-0000-0000-0000-0000000000a3') ->> 'km_gesamt')), '1 7.0');
select pg_temp.pruef('Erster Wagen ohne fremde Fahrt',
  (select count(*) from jsonb_array_elements(fahrtenbuch_lesen('00000000-0000-0000-0000-0000000000a1') -> 'zeilen') z where z ->> 'job_id' = '00000000-0000-0000-0000-0000000000f5'), 0::bigint);
select pg_temp.pruef('Lesen: Summe erster Wagen', (fahrtenbuch_lesen('00000000-0000-0000-0000-0000000000a1') ->> 'km_gesamt'), '20.1');
-- VIN im Datensatz getauscht (Kennzeichen wandert auf neuen Wagen): alte Zeilen gehoeren nicht dazu
update public.vehicles set vin = 'WBANEU00000000009' where id = '00000000-0000-0000-0000-0000000000a1';
select pg_temp.pruef('VIN getauscht: Buch beginnt neu', (fahrtenbuch_lesen('00000000-0000-0000-0000-0000000000a1') ->> 'anzahl'), '0');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d1', true);
do $$ begin
  begin
    perform public.fahrtenbuch_lesen('00000000-0000-0000-0000-0000000000a1');
    insert into t_erg (name, ok, ist, soll) values ('Lesen nur Dispo', false, 'ging durch', 'Fehler');
  exception when others then
    insert into t_erg (name, ok, ist, soll) values ('Lesen nur Dispo', true, 'Fehler', 'Fehler');
  end;
end $$;

-- 10 Nur anfuegen
do $$ begin
  begin
    update public.fahrtenbuch set km = 1;
    insert into t_erg (name, ok, ist, soll) values ('Aendern gesperrt', false, 'ging durch', 'Fehler');
  exception when others then
    insert into t_erg (name, ok, ist, soll) values ('Aendern gesperrt', true, 'Fehler', 'Fehler');
  end;
  begin
    delete from public.fahrtenbuch;
    insert into t_erg (name, ok, ist, soll) values ('Loeschen gesperrt', false, 'ging durch', 'Fehler');
  exception when others then
    insert into t_erg (name, ok, ist, soll) values ('Loeschen gesperrt', true, 'Fehler', 'Fehler');
  end;
end $$;

select case when ok then 'ok  ' else 'FEHLER ' end || name || case when ok then '' else '  ist: ' || coalesce(ist, 'null') || '  soll: ' || coalesce(soll, 'null') end from t_erg order by nr;
select 'TESTS ' || count(*) filter (where ok) || ' von ' || count(*) from t_erg;
