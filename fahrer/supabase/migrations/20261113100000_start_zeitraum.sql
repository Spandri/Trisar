-- Start Zeitraum (13.11.): Fahrt kann statt einer Startzeit einen Zeitraum haben (etd .. etd_bis).
-- Abfahrt und Planung rechnen weiter mit etd (Fahrer soll zum Anfang da sein), "zu spaet" erst nach etd_bis.
alter table public.jobs add column if not exists etd_bis time without time zone;
comment on column public.jobs.etd_bis is 'Ende des Start-Zeitraums (null = feste Startzeit etd). Zu spaet erst danach.';

CREATE OR REPLACE FUNCTION public.push_dispo_warnungen()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r record;
  d uuid;
  dispo uuid[];
  anzahl int := 0;
  jetzt timestamptz := now();
  heute date := (now() at time zone 'Europe/Berlin')::date;
  merker text;
  minuten int;
begin
  select coalesce(array_agg(k), '{}') into dispo
  from public.push_dispo_konten() k
  where not exists (select 1 from public.profiles p where p.id = k and lower(coalesce(p.role, '')) = 'pruefung');
  if cardinality(dispo) = 0 then return 0; end if;

  -- Fahrer ohne Signal (wie die Dispo-Karte: driver_live_locations.captured_at, 5 min = grau)
  for r in
    select l.driver_id, l.captured_at, public.push_name(l.driver_id) as name
    from public.driver_live_locations l
    join public.profiles p on p.id = l.driver_id
    where l.captured_at is not null
      and l.captured_at < jetzt - interval '5 minutes'
      and lower(coalesce(p.role, '')) not in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator', 'pruefung')
      and (
        -- laufende Fahrt oder offene Fahrt, die in den naechsten 2 Stunden beginnt (oder schon faellig ist)
        exists (
          select 1 from public.jobs j
          where (j.driver_id = l.driver_id or j.id = l.active_job_id
                 or exists (select 1 from public.convoy_assignments c
                            where c.job_id = j.id and c.driver_id = l.driver_id
                              and lower(coalesce(c.response_status, 'pending')) <> 'refused'))
            and j.ride_date between heute - 1 and heute + 1
            and lower(coalesce(j.status, '')) not in ('done', 'completed', 'arrived', 'cancelled', 'canceled', 'storniert', 'refused')
            and not exists (select 1 from public.jobs_archive a where a.job_id = j.id)
            and (
              lower(coalesce(j.status, '')) in ('at_pickup', 'pickup', 'beim_pickup', 'beim pickup', 'in_progress', 'started',
                                                 'unterwegs', 'active', 'ongoing', 'on_trip')
              or (j.etd is not null
                  and (j.ride_date + j.etd) at time zone 'Europe/Berlin' between jetzt - interval '2 hours' and jetzt + interval '2 hours')
            )
        )
        -- oder im angenommenen Dienst
        or exists (
          select 1 from public.driver_service_requests s
          where s.driver_id = l.driver_id
            and lower(coalesce(s.status, '')) = 'accepted'
            and s.service_date between heute - 1 and heute
            and s.service_start_time is not null
            and jetzt >= (s.service_date + s.service_start_time) at time zone 'Europe/Berlin'
            and (s.service_end_time is null
                 or jetzt < (s.service_date + s.service_end_time
                             + case when s.service_end_time <= s.service_start_time then interval '1 day' else interval '0' end)
                            at time zone 'Europe/Berlin')
        )
      )
  loop
    -- Ein Ereignis je Signalverlust: neues Signal und erneuter Verlust melden wieder.
    merker := 'dispo_signal:' || r.driver_id || ':' || extract(epoch from r.captured_at)::bigint;
    continue when exists (select 1 from public.push_erinnert e where e.schluessel = merker);
    insert into public.push_erinnert (schluessel) values (merker);
    minuten := greatest(5, round(extract(epoch from jetzt - r.captured_at) / 60))::int;
    foreach d in array dispo loop
      perform public.push_melden(d, 'dispo', 'dispo_ohne_signal', 'Kein Signal',
        r.name || ' sendet seit ' || case when minuten >= 120 then (minuten / 60) || ' h' else minuten || ' min' end
          || ' kein Signal.',
        jsonb_build_object('ziel', 'fahrer', 'driver_id', r.driver_id));
    end loop;
    anzahl := anzahl + 1;
  end loop;

  -- Fahrten ohne Fahrer, die in hoechstens 30 min beginnen
  for r in
    select j as fahrt, j.id, (j.ride_date + j.etd) at time zone 'Europe/Berlin' as beginn
    from public.jobs j
    where j.ride_date between heute - 1 and heute + 1
      and j.etd is not null
      and j.driver_id is null
      and lower(coalesce(j.status, '')) not in ('done', 'completed', 'arrived', 'cancelled', 'canceled', 'storniert', 'refused')
      and not exists (select 1 from public.jobs_archive a where a.job_id = j.id)
      and not exists (select 1 from public.convoy_assignments c
                      where c.job_id = j.id and c.driver_id is not null
                        and lower(coalesce(c.response_status, 'pending')) <> 'refused')
      and (j.ride_date + j.etd) at time zone 'Europe/Berlin' between jetzt and jetzt + interval '30 minutes'
  loop
    merker := 'dispo_ohne_fahrer:' || r.id;
    continue when exists (select 1 from public.push_erinnert e where e.schluessel = merker);
    insert into public.push_erinnert (schluessel) values (merker);
    foreach d in array dispo loop
      perform public.push_melden(d, 'dispo', 'dispo_ohne_fahrer', 'Fahrt ohne Fahrer',
        'In ' || greatest(1, round(extract(epoch from r.beginn - jetzt) / 60))::int || ' min: '
          || public.push_fahrt_text(r.fahrt) || '. Noch kein Fahrer zugeteilt.',
        jsonb_build_object('ziel', 'fahrt', 'job_id', r.id));
    end loop;
    anzahl := anzahl + 1;
  end loop;

  -- Fahrer kommt zu spaet zum Abholort: letzte Anfahrt (ext_driver_to_pickup_*, hoechstens 15 min alt)
  for r in
    select j as fahrt, j.id, j.driver_id,
           -- Start Zeitraum (13.11.): zu spaet erst nach dem Ende des Zeitraums.
           (j.ride_date + coalesce(j.etd_bis, j.etd)
             + case when j.etd_bis is not null and j.etd_bis < j.etd then interval '1 day' else interval '0' end)
             at time zone 'Europe/Berlin' as beginn,
           j.ext_driver_to_pickup_last_sync_at
             + make_interval(mins => coalesce(j.ext_driver_to_pickup_duration_in_traffic_mins, j.ext_driver_to_pickup_duration_mins)) as ankunft
    from public.jobs j
    where j.ride_date between heute - 1 and heute + 1
      and j.etd is not null
      and j.driver_id is not null
      and coalesce(j.ext_driver_to_pickup_duration_in_traffic_mins, j.ext_driver_to_pickup_duration_mins) is not null
      and j.ext_driver_to_pickup_last_sync_at > jetzt - interval '15 minutes'
      -- nur solange der Fahrer noch zum Gast unterwegs ist
      and lower(coalesce(j.status, '')) not in ('done', 'completed', 'arrived', 'cancelled', 'canceled', 'storniert', 'refused',
                                               'at_pickup', 'pickup', 'beim_pickup', 'beim pickup', 'in_progress', 'started',
                                               'unterwegs', 'ongoing', 'on_trip')
      and not exists (select 1 from public.jobs_archive a where a.job_id = j.id)
      and (j.ride_date + j.etd) at time zone 'Europe/Berlin' between jetzt - interval '1 hour' and jetzt + interval '3 hours'
  loop
    continue when r.ankunft <= r.beginn + interval '5 minutes';
    merker := 'dispo_verspaetet:' || r.id;
    continue when exists (select 1 from public.push_erinnert e where e.schluessel = merker);
    insert into public.push_erinnert (schluessel) values (merker);
    foreach d in array dispo loop
      perform public.push_melden(d, 'dispo', 'dispo_verspaetet', 'Fahrer kommt zu spät',
        public.push_name(r.driver_id) || ' ist etwa ' || round(extract(epoch from r.ankunft - r.beginn) / 60)::int
          || ' min zu spät am Abholort (an ' || to_char(r.ankunft at time zone 'Europe/Berlin', 'HH24:MI') || '). '
          || public.push_fahrt_text(r.fahrt) || '.',
        jsonb_build_object('ziel', 'fahrt', 'job_id', r.id, 'driver_id', r.driver_id));
    end loop;
    anzahl := anzahl + 1;
  end loop;

  return anzahl;
end;
$function$;
