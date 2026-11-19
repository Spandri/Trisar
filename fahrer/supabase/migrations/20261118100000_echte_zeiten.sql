-- Echte Abfahrt und Ankunft je Fahrt (18.11.2026)
--
-- Die Dispo zeigte bei "Unterwegs" und "Beendet" nur den Plan: Startfenster (19:45/21:00) und
-- Ankunft = Plan + Fahrzeit. Jetzt merkt sich die Datenbank, wie es wirklich war:
--   abfahrt_echt      Moment, in dem der Fahrer den Abholort laut GPS verlassen hat
--                     (abfahrt_quelle 'gps'). Bis dahin der Moment, in dem er "Unterwegs" getippt hat
--                     (abfahrt_quelle 'status'). Tippt er zu frueh auf Start und steht noch beim Gast,
--                     zieht die GPS-Abfahrt nach, sobald er den Rausfahr-Radius verlaesst.
--   ankunft_echt      Moment, in dem die Fahrt auf "Erledigt" springt.
--   ankunft_erwartet  waehrend der Fahrt: Live-Ankunft von TomTom (ext_driver_to_dropoff_*),
--                     sonst Abfahrt + Fahrzeit mit Verkehr. Nach dem Ende = ankunft_echt.
-- Die Live-Ankunft holt die Datenbank selbst (ziel_eta_anstossen, alle 2 min je Fahrt), weil die
-- nativen Fahrer-Apps external-sync nur beim Annehmen aufrufen.

alter table public.jobs
  add column if not exists abfahrt_echt timestamptz,
  add column if not exists abfahrt_quelle text,
  add column if not exists ankunft_echt timestamptz,
  add column if not exists ankunft_erwartet timestamptz;

-- Abholpunkt und Rausfahr-Radius einer Fahrt (wie trisar_evaluate_job_status).
create or replace function public.trisar_abholpunkt(p_job public.jobs)
returns table (lat double precision, lng double precision, rein_m integer, raus_m integer)
language plpgsql stable security definer set search_path = public
as $$
declare
  o public.orte%rowtype;
  s public.orte_standard%rowtype;
begin
  select * into s from public.orte_standard limit 1;
  lat := coalesce((p_job.ext_route_payload->'von'->>'lat')::double precision,
                  (p_job.ext_driver_to_pickup_payload->'nach'->>'lat')::double precision);
  lng := coalesce((p_job.ext_route_payload->'von'->>'lon')::double precision,
                  (p_job.ext_route_payload->'von'->>'lng')::double precision,
                  (p_job.ext_driver_to_pickup_payload->'nach'->>'lon')::double precision);
  if p_job.pickup_ort_id is not null then
    select * into o from public.orte where id = p_job.pickup_ort_id;
  elsif lat is not null then
    select x.* into o from public.orte x
     where public.trisar_luftlinie_m(trisar_abholpunkt.lat, trisar_abholpunkt.lng, x.lat, x.lng) <= x.radius_raus_m
     order by public.trisar_luftlinie_m(trisar_abholpunkt.lat, trisar_abholpunkt.lng, x.lat, x.lng) limit 1;
  end if;
  if o.id is not null then
    lat := o.lat;
    lng := o.lng;
  end if;
  rein_m := coalesce(o.radius_rein_m, s.radius_rein_m, public.trisar_get_setting_int('status_pickup_enter_radius_m', 50));
  raus_m := greatest(coalesce(o.radius_raus_m, s.radius_raus_m, public.trisar_get_setting_int('status_pickup_exit_radius_m', 100)), rein_m + 1);
  return next;
end;
$$;

-- Erwartete Ankunft waehrend der Fahrt.
create or replace function public.trisar_ankunft_erwartet(p_job public.jobs)
returns timestamptz
language sql stable
as $$
  select case
    when p_job.abfahrt_echt is null then null
    -- Live-Ankunft, sofern nach der Abfahrt gemessen (sonst stammt sie vom Annehmen).
    when p_job.ext_driver_to_dropoff_last_sync_at >= p_job.abfahrt_echt - interval '1 minute'
         and coalesce(p_job.ext_driver_to_dropoff_duration_in_traffic_mins, p_job.ext_driver_to_dropoff_duration_mins) is not null
      then p_job.ext_driver_to_dropoff_last_sync_at
           + make_interval(mins => coalesce(p_job.ext_driver_to_dropoff_duration_in_traffic_mins,
                                            p_job.ext_driver_to_dropoff_duration_mins)::int)
    when coalesce(p_job.ext_route_duration_in_traffic_mins, p_job.ext_route_duration_mins) is not null
      then p_job.abfahrt_echt
           + make_interval(mins => coalesce(p_job.ext_route_duration_in_traffic_mins, p_job.ext_route_duration_mins)::int)
  end;
$$;

-- Statuswechsel setzen die echten Zeiten.
create or replace function public.trisar_echte_zeiten()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_fahrt constant text[] := array['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
  v_fertig constant text[] := array['done', 'completed', 'arrived', 'beendet'];
  v_weg constant text[] := array['cancelled', 'canceled', 'refused', 'storniert', 'stoniert'];
  st_neu text := public.trisar_norm_status(new.status);
  st_alt text := case when tg_op = 'UPDATE' then public.trisar_norm_status(old.status) end;
  -- Die Engine (GPS) setzt den Status ueber trisar_transition_job_status, das markiert die Fahrt.
  v_automatisch boolean := coalesce(current_setting('trisar.status_protokolliert', true), '') = new.id::text;
begin
  if st_neu = any (v_fahrt) and (st_alt is null or st_alt <> all (v_fahrt)) then
    if st_alt = any (v_fertig) and new.abfahrt_echt is not null then
      null;  -- Dispo setzt eine beendete Fahrt zurueck auf unterwegs: Abfahrt bleibt
    else
      new.abfahrt_echt := now();
      new.abfahrt_quelle := case when v_automatisch then 'gps' else 'status' end;
    end if;
    new.ankunft_echt := null;
  elsif st_neu = any (v_fertig) and (st_alt is null or st_alt <> all (v_fertig)) then
    new.ankunft_echt := now();
  elsif st_neu <> all (v_fahrt) and st_neu <> all (v_fertig) and st_neu <> all (v_weg) then
    -- Zurueck auf offen oder beim Gast: noch nicht losgefahren
    new.abfahrt_echt := null;
    new.abfahrt_quelle := null;
    new.ankunft_echt := null;
  end if;

  if st_neu = any (v_fertig) then
    new.ankunft_erwartet := new.ankunft_echt;
  elsif st_neu = any (v_fahrt) then
    new.ankunft_erwartet := public.trisar_ankunft_erwartet(new);
  elsif st_neu <> all (v_weg) then
    new.ankunft_erwartet := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_echte_zeiten on public.jobs;
create trigger trg_jobs_echte_zeiten
  before insert or update of status, abfahrt_echt, ext_driver_to_dropoff_last_sync_at,
    ext_driver_to_dropoff_duration_in_traffic_mins, ext_driver_to_dropoff_duration_mins,
    ext_route_duration_in_traffic_mins, ext_route_duration_mins
  on public.jobs
  for each row execute function public.trisar_echte_zeiten();

-- GPS: verlaesst der Fahrer den Abholort, ist das die echte Abfahrt.
-- Live-Ankunft am Ziel: alle 2 min je Fahrt "Unterwegs" neu holen (TomTom ueber external-sync, nur_ziel).
create table if not exists public.ziel_eta_takt (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  zuletzt timestamptz not null default now()
);
alter table public.ziel_eta_takt enable row level security;

create or replace function public.trisar_fahrt_live()
returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare
  j public.jobs%rowtype;
  p record;
  v_schluessel text;
  v_drin timestamptz;
begin
  if new.lat is null or new.lng is null then return null; end if;
  for j in
    select * from public.jobs x
     where x.driver_id = new.driver_id
       and public.trisar_norm_status(x.status) in ('in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active')
     order by x.ride_date desc nulls last, x.etd desc nulls last
     limit 3
  loop
    -- 1) GPS-Abfahrt
    if j.abfahrt_quelle is distinct from 'gps' then
      select * into p from public.trisar_abholpunkt(j);
      if p.lat is not null
         and public.trisar_luftlinie_m(new.lat, new.lng, p.lat, p.lng) > p.raus_m then
        -- Abfahrt = letzter Punkt noch im Reinfahr-Radius (da stand er beim Gast), sonst dieser Punkt.
        -- Am liebsten der letzte Stillstand (unter 2 m/s), da rollte er los.
        select coalesce(max(l.captured_at) filter (where coalesce(l.speed_mps, 0) < 2), max(l.captured_at))
          into v_drin from public.driver_location_history l
         where l.driver_id = new.driver_id
           and l.captured_at >= coalesce(j.abfahrt_echt, now() - interval '6 hours')
           and l.captured_at <= coalesce(new.captured_at, now())
           and public.trisar_luftlinie_m(l.lat, l.lng, p.lat, p.lng) <= p.rein_m;
        update public.jobs
           set abfahrt_echt = coalesce(v_drin, new.captured_at, now()),
               abfahrt_quelle = 'gps'
         where id = j.id;
      end if;
    end if;

    -- 2) Live-Ankunft holen (gedrosselt)
    if j.ext_driver_to_dropoff_last_sync_at is null or j.ext_driver_to_dropoff_last_sync_at < now() - interval '2 minutes' then
      insert into public.ziel_eta_takt (job_id, zuletzt) values (j.id, now())
        on conflict (job_id) do update set zuletzt = now()
        where ziel_eta_takt.zuletzt < now() - interval '2 minutes';
      if found then
        select value #>> '{}' into v_schluessel from public.integration_settings where key = 'edge_service_role_key';
        if coalesce(v_schluessel, '') <> '' then
          perform net.http_post(
            url := 'http://kong:8000/functions/v1/external-sync',
            body := jsonb_build_object('reason', 'live_view', 'job_ids', jsonb_build_array(j.id),
                                       'requested_by', j.driver_id, 'nur_ziel', true,
                                       'current_location', jsonb_build_object('lat', new.lat, 'lng', new.lng)),
            headers := jsonb_build_object('Content-Type', 'application/json',
                                          'Authorization', 'Bearer ' || v_schluessel,
                                          'apikey', v_schluessel),
            timeout_milliseconds := 30000
          );
        end if;
      end if;
    end if;
  end loop;
  return null;
exception when others then
  -- Der Standort des Fahrers darf nie daran scheitern.
  return null;
end;
$$;

drop trigger if exists trg_fahrt_live on public.driver_live_locations;
create trigger trg_fahrt_live
  after insert or update on public.driver_live_locations
  for each row execute function public.trisar_fahrt_live();

-- Fahrer-Historie: echte Zeiten vor Plan.
create or replace function public.verlauf_fahrten(p_driver uuid default null, p_tage integer default 60)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  fahrer uuid := coalesce(p_driver, auth.uid());
  heute date := (now() at time zone 'Europe/Berlin')::date;
begin
  if fahrer is null or (fahrer <> auth.uid() and not public.ist_dispo()) then
    raise exception 'kein Zugriff';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id,
             'datum', f.ride_date,
             'abfahrt', coalesce(f.abfahrt_echt, f.abfahrt),
             'ankunft', coalesce(f.ankunft_echt, f.ende_protokoll,
                                 coalesce(f.abfahrt_echt, f.abfahrt) + make_interval(mins => f.dauer)),
             'ankunft_genau', coalesce(f.ankunft_echt, f.ende_protokoll) is not null,
             'gaeste', to_jsonb(f.passengers),
             'anonym', coalesce(f.anonymous_guests, 0),
             'von', coalesce(nullif(f.pickup_name, ''), f.pickup_address),
             'nach', coalesce(nullif(f.dropoff_name, ''), f.dropoff_address),
             'status', f.status
           ) order by f.ride_date desc, f.abfahrt desc nulls last)
    from (
      select j.*,
             ((j.ride_date + coalesce(j.etd, j.original_etd)) at time zone 'Europe/Berlin') as abfahrt,
             j.ext_route_duration_mins as dauer,
             (select max(h.created_at) from public.job_status_history h
               where h.job_id = j.id
                 and lower(h.to_status) in ('done', 'completed', 'arrived', 'beendet')
                 and h.created_at >= ((j.ride_date + coalesce(j.etd, j.original_etd)) at time zone 'Europe/Berlin')
                 and h.created_at <= ((j.ride_date + coalesce(j.etd, j.original_etd)) at time zone 'Europe/Berlin') + interval '12 hours'
             ) as ende_protokoll
      from public.jobs j
      where (j.driver_id = fahrer
             or exists (select 1 from public.convoy_assignments ca where ca.job_id = j.id and ca.driver_id = fahrer))
        and lower(coalesce(j.status, '')) in ('done', 'completed', 'arrived', 'beendet')
        and j.ride_date <= heute
        and j.ride_date >= heute - p_tage
    ) f
  ), '[]'::jsonb);
end;
$$;

-- Nachtragen fuer laufende und erledigte Fahrten der letzten 60 Tage aus Statusverlauf und GPS-Spur.
do $$
declare
  j public.jobs%rowtype;
  p record;
  v_start timestamptz;
  v_ende timestamptz;
  v_gps timestamptz;
  v_raus timestamptz;
begin
  for j in
    select * from public.jobs x
     where public.trisar_norm_status(x.status) in ('in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active',
                                                   'done', 'completed', 'arrived', 'beendet')
       and x.ride_date >= current_date - 60
       and x.abfahrt_echt is null
  loop
    select min(h.created_at) into v_start from public.job_status_history h
     where h.job_id = j.id
       and public.trisar_norm_status(h.to_status) in ('in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active');
    select max(h.created_at) into v_ende from public.job_status_history h
     where h.job_id = j.id
       and public.trisar_norm_status(h.to_status) in ('done', 'completed', 'arrived', 'beendet');
    if v_start is null then continue; end if;

    v_gps := null;
    v_raus := null;
    select * into p from public.trisar_abholpunkt(j);
    if p.lat is not null and j.driver_id is not null then
      select min(l.captured_at) into v_raus from public.driver_location_history l
       where l.driver_id = j.driver_id
         and l.captured_at >= v_start
         and (v_ende is null or l.captured_at <= v_ende)
         and public.trisar_luftlinie_m(l.lat, l.lng, p.lat, p.lng) > p.raus_m;
      if v_raus is not null then
        select coalesce(max(l.captured_at) filter (where coalesce(l.speed_mps, 0) < 2), max(l.captured_at), v_raus)
          into v_gps from public.driver_location_history l
         where l.driver_id = j.driver_id
           and l.captured_at >= v_start
           and l.captured_at <= v_raus
           and public.trisar_luftlinie_m(l.lat, l.lng, p.lat, p.lng) <= p.rein_m;
      end if;
    end if;

    update public.jobs
       set abfahrt_echt = coalesce(v_gps, v_start),
           abfahrt_quelle = case when v_gps is not null then 'gps' else 'status' end,
           ankunft_echt = case when public.trisar_norm_status(j.status) in ('done', 'completed', 'arrived', 'beendet')
                               then v_ende end
     where id = j.id;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
