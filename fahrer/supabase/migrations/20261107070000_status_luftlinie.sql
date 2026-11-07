-- Auto-Status nach Luftlinie statt nur Routen-Distanz.
--
-- Probefahrt 07.11. (iOS-Fahrer-App): Fahrer war am Abholort, der Auftrag sprang nie auf
-- "beim Gast". Die DB-Engine entschied nur nach ext_driver_to_pickup_distance_m, und die rechnet
-- nur ein Routen-Sync. iOS und Android loesen den nur beim Annehmen aus, waehrend der Anfahrt
-- also nie (die Web-App hat eine eigene Luftlinien-Logik im Browser, die nativen Apps nicht).
-- Jetzt rechnet die Engine bei jeder Live-Position die Luftlinie selbst (Trigger auf
-- driver_live_locations gibt es schon) und nimmt die Routen-Distanz nur noch als Rueckfall.
-- Beim Gast, solange der Fahrer im Radius ist (status_pickup_enter_radius_m), unterwegs, sobald
-- er ihn verlaesst: 2 Punkte in Folge draussen (App alle 5 s, also ca. 10 s). Die alte Regel
-- (100 m weg, 3 Treffer, Abstand muss wachsen) ist raus, status_pickup_exit_radius_m bleibt unbenutzt.

update public.integration_settings
   set value = '2'::jsonb,
       description = 'Punkte in Folge ausserhalb des Abholradius, bevor beim Gast -> unterwegs',
       updated_at = now()
 where key = 'status_pickup_depart_hits';

create or replace function public.trisar_luftlinie_m(
  p_lat1 double precision, p_lng1 double precision,
  p_lat2 double precision, p_lng2 double precision
)
returns integer
language sql
immutable
as $$
  select case when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else round(6371000 * 2 * asin(sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
    )))::integer end
$$;

create or replace function public.trisar_evaluate_job_status(p_job_id uuid, p_source text DEFAULT 'driver_live_trigger'::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job public.jobs%rowtype;
  v_runtime public.job_status_runtime%rowtype;
  v_status text;
  v_open_statuses constant text[] := array['pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen'];
  v_pickup_statuses constant text[] := array['at_pickup', 'pickup', 'beim_pickup', 'beim pickup'];
  v_trip_statuses constant text[] := array['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
  v_done_statuses constant text[] := array['done', 'completed', 'arrived', 'beendet'];
  v_terminal_statuses constant text[] := array['cancelled', 'canceled', 'refused', 'storniert', 'stoniert'];
  v_enter_radius integer := public.trisar_get_setting_int('status_pickup_enter_radius_m', 50);
  v_exit_radius integer := public.trisar_get_setting_int('status_pickup_exit_radius_m', 100);
  v_depart_hits_required integer := public.trisar_get_setting_int('status_pickup_depart_hits', 3);
  v_progress_delta integer := public.trisar_get_setting_int('status_progress_delta_m', 25);
  v_done_radius integer := public.trisar_get_setting_int('status_dropoff_done_radius_m', 50);
  v_done_hits_required integer := public.trisar_get_setting_int('status_dropoff_done_hits', 2);
  v_pickup_distance integer;
  v_dropoff_distance integer;
  v_pickup_exit_hits integer;
  v_dropoff_near_hits integer;
  v_depart_confirmed boolean := false;
  v_dropoff_progressing boolean := false;
  v_live public.driver_live_locations%rowtype;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_dropoff_lat double precision;
  v_dropoff_lng double precision;
  v_pickup_luft integer;
  v_dropoff_luft integer;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id;

  if not found then
    return null;
  end if;

  v_status := public.trisar_norm_status(v_job.status);

  insert into public.job_status_runtime(job_id)
  values (p_job_id)
  on conflict (job_id) do nothing;

  select * into v_runtime
  from public.job_status_runtime
  where job_id = p_job_id
  for update;

  -- Luftlinie von der frischen Live-Position (App alle 5 s, OBD je Paket) zu Abhol- und Zielort.
  -- Die Routen-Distanz (ext_driver_to_*) rechnet nur ein Sync (Annehmen, Gateway, Web-Details),
  -- bei iOS/Android lief der waehrend der Anfahrt gar nicht, deshalb kam nie "beim Gast".
  -- Koordinaten: TomTom-Payload der Fahrt (von = Abholort, nach = Ziel), sonst der Anfahrts-Payloads.
  v_pickup_lat := coalesce((v_job.ext_route_payload->'von'->>'lat')::double precision,
                           (v_job.ext_driver_to_pickup_payload->'nach'->>'lat')::double precision);
  v_pickup_lng := coalesce((v_job.ext_route_payload->'von'->>'lon')::double precision,
                           (v_job.ext_route_payload->'von'->>'lng')::double precision,
                           (v_job.ext_driver_to_pickup_payload->'nach'->>'lon')::double precision);
  v_dropoff_lat := coalesce((v_job.ext_route_payload->'nach'->>'lat')::double precision,
                            (v_job.ext_driver_to_dropoff_payload->'nach'->>'lat')::double precision);
  v_dropoff_lng := coalesce((v_job.ext_route_payload->'nach'->>'lon')::double precision,
                            (v_job.ext_route_payload->'nach'->>'lng')::double precision,
                            (v_job.ext_driver_to_dropoff_payload->'nach'->>'lon')::double precision);

  if v_job.driver_id is not null then
    select * into v_live
    from public.driver_live_locations
    where driver_id = v_job.driver_id
      and coalesce(captured_at, updated_at) > now() - interval '2 minutes';
    if found and v_live.lat is not null and v_live.lng is not null then
      v_pickup_luft := public.trisar_luftlinie_m(v_live.lat, v_live.lng, v_pickup_lat, v_pickup_lng);
      v_dropoff_luft := public.trisar_luftlinie_m(v_live.lat, v_live.lng, v_dropoff_lat, v_dropoff_lng);
    end if;
  end if;

  v_pickup_distance := coalesce(v_pickup_luft, v_job.ext_driver_to_pickup_distance_m, 2147483647);
  v_dropoff_distance := coalesce(v_dropoff_luft, v_job.ext_driver_to_dropoff_distance_m, 2147483647);
  v_pickup_exit_hits := coalesce(v_runtime.pickup_exit_hits, 0);
  v_dropoff_near_hits := coalesce(v_runtime.dropoff_near_hits, 0);

  if v_status = any(v_terminal_statuses) or v_status = any(v_done_statuses) then
    update public.job_status_runtime
    set pickup_exit_hits = 0,
        dropoff_near_hits = 0,
        last_pickup_distance_m = null,
        last_dropoff_distance_m = null,
        updated_at = now()
    where job_id = p_job_id;
    return v_job.status;
  end if;

  if v_status = any(v_open_statuses) then
    if v_pickup_distance <= v_enter_radius then
      perform public.trisar_transition_job_status(
        p_job_id,
        'at_pickup',
        p_source,
        jsonb_build_object('pickup_distance_m', v_pickup_distance)
      );
      v_status := 'at_pickup';
      v_pickup_exit_hits := 0;
      v_dropoff_near_hits := 0;
    end if;
  elsif v_status = any(v_pickup_statuses) then
    if v_pickup_distance = 2147483647 then
      -- Ohne Distanz (weder Luftlinie noch Route) keine Entscheidung. Vorher zaehlte NULL als unendlich weit weg,
      -- und der Auftrag sprang faelschlich auf unterwegs, bevor der Fahrer losgefahren war.
      null;
    elsif v_pickup_distance > v_enter_radius then
      -- Beim Gast = im Radius. Raus aus dem Radius = unterwegs, sobald genug Punkte in Folge
      -- draussen sind (status_pickup_depart_hits, gegen einzelne GPS-Ausreisser).
      v_pickup_exit_hits := v_pickup_exit_hits + 1;
    else
      v_pickup_exit_hits := 0;
    end if;

    if v_pickup_exit_hits >= greatest(v_depart_hits_required, 1) then
      perform public.trisar_transition_job_status(
        p_job_id,
        'in_progress',
        p_source,
        jsonb_build_object(
          'pickup_distance_m', v_pickup_distance,
          'dropoff_distance_m', case when v_dropoff_distance = 2147483647 then null else v_dropoff_distance end,
          'departure_hits', v_pickup_exit_hits
        )
      );
      v_status := 'in_progress';
      v_pickup_exit_hits := 0;
      v_dropoff_near_hits := 0;
    end if;
  elsif v_status = any(v_trip_statuses) then
    if v_dropoff_distance <= v_done_radius then
      v_dropoff_near_hits := v_dropoff_near_hits + 1;
    else
      v_dropoff_near_hits := greatest(v_dropoff_near_hits - 1, 0);
    end if;

    if v_dropoff_near_hits >= greatest(v_done_hits_required, 1) then
      perform public.trisar_transition_job_status(
        p_job_id,
        'done',
        p_source,
        jsonb_build_object('dropoff_distance_m', v_dropoff_distance, 'dropoff_hits', v_dropoff_near_hits)
      );
      v_status := 'done';
      v_pickup_exit_hits := 0;
      v_dropoff_near_hits := 0;
    end if;
  end if;

  update public.job_status_runtime
  set pickup_exit_hits = v_pickup_exit_hits,
      dropoff_near_hits = v_dropoff_near_hits,
      last_pickup_distance_m = case when v_pickup_distance = 2147483647 then null else v_pickup_distance end,
      last_dropoff_distance_m = case when v_dropoff_distance = 2147483647 then null else v_dropoff_distance end,
      updated_at = now()
  where job_id = p_job_id;

  return v_status;
end;
$function$;

-- Jede Live-Position bewertet einen Auftrag nur einmal.
create or replace function public.trisar_driver_live_status_eval_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_job_id uuid;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.active_job_id is not null then
    perform public.trisar_evaluate_job_status(new.active_job_id, 'driver_live_trigger');
  end if;

  for v_job_id in
    select j.id
    from public.jobs j
    where j.driver_id = new.driver_id
      -- Schon oben bewertet. Zweimal je Punkt hob den Abfahrts-Treffer wieder auf
      -- (zweiter Lauf sieht keine Bewegung, zieht einen ab), "unterwegs" kam so nie.
      and j.id is distinct from new.active_job_id
      and lower(coalesce(j.status, '')) in (
        'pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen',
        'at_pickup', 'pickup', 'beim_pickup', 'beim pickup',
        'in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'
      )
    order by j.updated_at desc
    limit 5
  loop
    perform public.trisar_evaluate_job_status(v_job_id, 'driver_live_trigger');
  end loop;

  return new;
end;
$function$;
