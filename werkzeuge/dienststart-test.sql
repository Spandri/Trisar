-- Testfaelle Dienststart automatisch (20261115140000_dienststart_automatisch).
-- Laeuft komplett in einer Transaktion und wird zurueckgerollt: bash werkzeuge/dienststart-test.sh
-- Testfahrer ist das Pruefkonto (Rolle 'pruefung'), Vorlauf 30 min.

create temp table tf as select id from public.profiles where lower(coalesce(role, '')) = 'pruefung' limit 1;

create function pg_temp.fahrer() returns uuid language sql as $$ select id from tf $$;

create function pg_temp.leeren() returns void language sql as $$
  delete from public.jobs where driver_id = (select id from tf);
  delete from public.driver_service_requests where driver_id = (select id from tf);
$$;

create function pg_temp.fahrt(p_tag date, p_zeit time) returns uuid language plpgsql as $$
declare i uuid;
begin
  insert into public.jobs (driver_id, ride_date, etd, pickup_address, dropoff_address, status)
  values ((select id from tf), p_tag, p_zeit, 'Test Start', 'Test Ziel', 'pending') returning id into i;
  return i;
end $$;

create function pg_temp.dienst(p_tag date, p_start time, p_ende time, p_status text default 'accepted') returns void language sql as $$
  insert into public.driver_service_requests (driver_id, service_date, service_start_time, service_end_time, status, requested_by)
  values ((select id from tf), p_tag, p_start, p_ende, p_status, 'dispo-test');
$$;

create function pg_temp.dienste() returns text language sql as $$
  select coalesce(string_agg(to_char(service_date, 'DD.MM.') || ' ' || coalesce(to_char(service_start_time, 'HH24:MI'), '?')
           || '-' || coalesce(to_char(service_end_time, 'HH24:MI'), '?') || ' ' || status || ' ' || coalesce(requested_by, ''),
           ' | ' order by service_date, service_start_time), '(keiner)')
    from public.driver_service_requests where driver_id = (select id from tf);
$$;

create function pg_temp.hinweise() returns integer language sql as $$
  select count(*)::integer from public.push_ausgang where art = 'dispo_dienst_pruefen'
     and daten->>'user_id' = (select id::text from tf);
$$;

create function pg_temp.pruefen(p_name text, p_ist text, p_soll text) returns void language plpgsql as $$
begin
  if p_ist is distinct from p_soll then
    raise exception E'FEHLER %\n  ist:  %\n  soll: %', p_name, p_ist, p_soll;
  end if;
  raise notice 'ok  %', p_name;
end $$;

do $$ begin
  perform pg_temp.pruefen('00 Standard nach Migration 60 min', public.trisar_dienststart_vorlauf()::text, '60');
end $$;
insert into public.dispo_einstellungen (schluessel, wert) values ('dienststart_vorlauf_min', '30')
on conflict (schluessel) do update set wert = excluded.wert;

do $$
declare
  j uuid; j2 uuid; h integer;
begin
  if pg_temp.fahrer() is null then raise exception 'Kein Pruefkonto gefunden'; end if;

  -- 1. Erste Fahrt am Tag
  perform pg_temp.leeren();
  perform pg_temp.fahrt('2027-01-15', '10:30');
  perform pg_temp.pruefen('01 Fahrt 10:30 -> Dienst 10:00', pg_temp.dienste(), '15.01. 10:00-? pending automatisch');

  -- 2. Fahrt nach Mitternacht -> Dienst am Vortag
  perform pg_temp.leeren();
  perform pg_temp.fahrt('2027-01-16', '00:15');
  perform pg_temp.pruefen('02 Fahrt 16. 00:15 -> Dienst 15. 23:45', pg_temp.dienste(), '15.01. 23:45-? pending automatisch');

  -- 3. Dienst ueber Mitternacht deckt die Fahrt
  perform pg_temp.leeren();
  perform pg_temp.dienst('2027-01-15', '18:00', '02:00');
  perform pg_temp.fahrt('2027-01-16', '00:15');
  perform pg_temp.pruefen('03 Dienst 18-02 deckt 00:15', pg_temp.dienste(), '15.01. 18:00-02:00 accepted dispo-test');

  -- 4. Offener Abenddienst deckt Fahrt nach Mitternacht
  perform pg_temp.leeren();
  perform pg_temp.dienst('2027-01-15', '18:00', null);
  perform pg_temp.fahrt('2027-01-16', '01:30');
  perform pg_temp.pruefen('04 Dienst 18:00 offen deckt 01:30', pg_temp.dienste(), '15.01. 18:00-? accepted dispo-test');

  -- 5. Fahrt kurz nach Dienstende ueber Mitternacht: kein neuer Dienst, Hinweis
  perform pg_temp.leeren();
  perform pg_temp.dienst('2027-01-15', '10:30', '01:00');
  h := pg_temp.hinweise();
  perform pg_temp.fahrt('2027-01-16', '01:30');
  perform pg_temp.pruefen('05 Dienst 10:30-01:00, Fahrt 01:30 -> nichts', pg_temp.dienste(), '15.01. 10:30-01:00 accepted dispo-test');
  perform pg_temp.pruefen('05 Hinweis an Dispo', (pg_temp.hinweise() > h)::text, (exists (select public.push_dispo_konten()))::text);

  -- 6. Abenddienst endet 23:30, Fahrt 00:15: Vortag ist belegt, nicht ueberschreiben
  perform pg_temp.leeren();
  perform pg_temp.dienst('2027-01-15', '18:00', '23:30');
  perform pg_temp.fahrt('2027-01-16', '00:15');
  perform pg_temp.pruefen('06 Dienst 18-23:30, Fahrt 00:15 -> nichts', pg_temp.dienste(), '15.01. 18:00-23:30 accepted dispo-test');

  -- 7. Tagdienst gestern, Fahrt heute frueh -> neuer Dienst
  perform pg_temp.leeren();
  perform pg_temp.dienst('2027-01-15', '06:00', '14:00');
  perform pg_temp.fahrt('2027-01-16', '10:00');
  perform pg_temp.pruefen('07 Dienst 15. 06-14, Fahrt 16. 10:00 -> neu 09:30', pg_temp.dienste(),
    '15.01. 06:00-14:00 accepted dispo-test | 16.01. 09:30-? pending automatisch');

  -- 8. Dispo-Dienst beginnt nach der Fahrt -> vorziehen, Herkunft und Ende bleiben, Fahrer bestaetigt
  perform pg_temp.leeren();
  perform pg_temp.dienst('2027-01-15', '14:00', '22:00');
  perform pg_temp.fahrt('2027-01-15', '10:30');
  perform pg_temp.pruefen('08 Dienst 14-22, Fahrt 10:30 -> 10:00-22:00', pg_temp.dienste(), '15.01. 10:00-22:00 pending dispo-test');
  perform pg_temp.pruefen('08 alter Stand gemerkt', (select a.vorher->>'start' from public.dienst_aenderung a
    join public.driver_service_requests d on d.id = a.dienst_id where d.driver_id = pg_temp.fahrer()), '14:00');

  -- 9. Spaetere Fahrt zuerst zugeteilt, dann fruehere -> ein Dienst, vorgezogen
  perform pg_temp.leeren();
  perform pg_temp.fahrt('2027-01-16', '00:15');
  perform pg_temp.fahrt('2027-01-15', '22:00');
  perform pg_temp.pruefen('09 erst 00:15, dann 22:00 -> 21:30', pg_temp.dienste(), '15.01. 21:30-? pending automatisch');
  perform pg_temp.fahrt('2027-01-16', '01:30');
  perform pg_temp.pruefen('09 weitere Fahrt 01:30 -> unveraendert', pg_temp.dienste(), '15.01. 21:30-? pending automatisch');

  -- 10. Fahrt einem anderen Fahrer gegeben -> unbestaetigter Auto-Dienst wird zurueckgezogen
  perform pg_temp.leeren();
  j := pg_temp.fahrt('2027-01-16', '00:15');
  update public.jobs set driver_id = null where id = j;
  perform pg_temp.pruefen('10 Fahrt weg -> Dienst zurueckgezogen', pg_temp.dienste(), '(keiner)');

  -- 11. Fahrt spaeter gelegt, Dienst noch offen -> Start wandert mit
  perform pg_temp.leeren();
  j := pg_temp.fahrt('2027-01-15', '10:30');
  update public.jobs set etd = '14:00' where id = j;
  perform pg_temp.pruefen('11 Fahrt 10:30 -> 14:00, offen -> 13:30', pg_temp.dienste(), '15.01. 13:30-? pending automatisch');

  -- 12. Bestaetigter Auto-Dienst wird nie nach hinten geschoben
  perform pg_temp.leeren();
  j := pg_temp.fahrt('2027-01-15', '10:30');
  update public.driver_service_requests set status = 'accepted' where driver_id = pg_temp.fahrer();
  update public.jobs set etd = '14:00' where id = j;
  perform pg_temp.pruefen('12 bestaetigt, Fahrt spaeter -> bleibt 10:00', pg_temp.dienste(), '15.01. 10:00-? accepted automatisch');

  -- 13. Bestaetigter Auto-Dienst, fruehere Fahrt kommt dazu -> vorziehen (Aenderung)
  perform pg_temp.fahrt('2027-01-15', '08:00');
  perform pg_temp.pruefen('13 bestaetigt, Fahrt 08:00 -> 07:30 offen', pg_temp.dienste(), '15.01. 07:30-? pending automatisch');

  -- 14. Erste von zwei Fahrten storniert -> Start auf die naechste
  perform pg_temp.leeren();
  j := pg_temp.fahrt('2027-01-15', '10:30');
  j2 := pg_temp.fahrt('2027-01-15', '12:00');
  update public.jobs set status = 'cancelled' where id = j;
  perform pg_temp.pruefen('14 10:30 storniert -> 11:30', pg_temp.dienste(), '15.01. 11:30-? pending automatisch');

  -- 15. Abgelehnter Dienst am Tag -> nichts erneut schicken
  perform pg_temp.leeren();
  perform pg_temp.dienst('2027-01-15', '06:00', '14:00', 'refused');
  perform pg_temp.fahrt('2027-01-15', '18:00');
  perform pg_temp.pruefen('15 abgelehnt -> nichts', pg_temp.dienste(), '15.01. 06:00-14:00 refused dispo-test');

  -- 16. Offener Auto-Dienst deckt die Nacht, Fahrt danach <3 h -> nichts
  perform pg_temp.leeren();
  perform pg_temp.fahrt('2027-01-15', '10:30');
  perform pg_temp.fahrt('2027-01-16', '01:30');
  perform pg_temp.fahrt('2027-01-16', '03:00');
  perform pg_temp.pruefen('16 10:30, 01:30, 03:00 -> ein Dienst', pg_temp.dienste(), '15.01. 10:00-? pending automatisch');

  -- 17. Tagdienst, Fahrt am selben Abend -> Tag belegt, nichts (Hinweis)
  perform pg_temp.leeren();
  perform pg_temp.dienst('2027-01-15', '06:00', '14:00');
  perform pg_temp.fahrt('2027-01-15', '22:00');
  perform pg_temp.pruefen('17 Dienst 06-14, Fahrt 22:00 -> nichts', pg_temp.dienste(), '15.01. 06:00-14:00 accepted dispo-test');

  -- 18. Zeitumstellung: 28.03.2027 02:00 -> 03:00
  perform pg_temp.leeren();
  perform pg_temp.fahrt('2027-03-28', '03:10');
  perform pg_temp.pruefen('18 Sommerzeit Fahrt 03:10 -> 01:40', pg_temp.dienste(), '28.03. 01:40-? pending automatisch');
  perform pg_temp.leeren();
  perform pg_temp.fahrt('2027-03-28', '00:10');
  perform pg_temp.pruefen('18 Fahrt 28. 00:10 -> 27. 23:40', pg_temp.dienste(), '27.03. 23:40-? pending automatisch');

  -- 19. Vergangenheit und ohne Uhrzeit -> nichts
  perform pg_temp.leeren();
  perform pg_temp.fahrt('2026-01-15', '10:30');
  perform pg_temp.fahrt('2027-01-15', null);
  perform pg_temp.pruefen('19 vorbei / ohne etd -> nichts', pg_temp.dienste(), '(keiner)');

  -- 20. Vorlauf aus -> nichts
  perform pg_temp.leeren();
  update public.dispo_einstellungen set wert = 'null'::jsonb where schluessel = 'dienststart_vorlauf_min';
  perform pg_temp.fahrt('2027-01-15', '10:30');
  perform pg_temp.pruefen('20 Vorlauf aus (wert null) -> nichts', pg_temp.dienste(), '(keiner)');
  update public.dispo_einstellungen set wert = '60' where schluessel = 'dienststart_vorlauf_min';

  -- 21. Vorlauf 60 -> Fahrt 00:30 ergibt 23:30 Vortag
  perform pg_temp.leeren();
  perform pg_temp.fahrt('2027-01-16', '00:30');
  perform pg_temp.pruefen('21 Vorlauf 60, Fahrt 00:30 -> 15. 23:30', pg_temp.dienste(), '15.01. 23:30-? pending automatisch');

  raise notice 'ALLE TESTS OK';
end $$;
