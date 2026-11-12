-- Fahrt ohne Start: nicht vor dem Annehmen auf "Beim Gast" springen.
--
-- Befund 11.11.: Fahrt ohne Start an Stefano (pickup = sein Standort). 20 s nach dem Anlegen stand
-- sie auf at_pickup, weil der Fahrer natuerlich "am Start" steht. Danach zeigt die Fahrer-App kein
-- Annehmen mehr (nur offene Fahrten koennen angenommen werden).
-- Aenderung gegenueber dem Live-Stand von trisar_evaluate_job_status (Stand 11.11., aufgebaut auf
-- 20261107140000_statusregel_zusammengefuehrt): nur die Bedingung im Zweig "offen".
-- Zusaetzlich: bereits so falsch gesprungene, nie angenommene Fahrten ohne Start zurueck auf pending.

CREATE OR REPLACE FUNCTION public.trisar_evaluate_job_status(p_job_id uuid, p_source text DEFAULT 'driver_live_trigger'::text)
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
  v_pickup_ort public.orte%rowtype;
  v_dropoff_ort public.orte%rowtype;
  v_std public.orte_standard%rowtype;
  v_pickup_rein integer;
  v_pickup_raus integer;
  v_dropoff_rein integer;
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

  -- Eigene Orte der Dispo: Radien (und genauer Pin) des Orts statt Standard.
  -- Erst die Zuordnung aus der Fahrt (gewaehlt beim Erstellen), sonst der naechste Ort, in dessen
  -- Rausfahr-Radius die Adresse der Fahrt liegt (getippte Adresse, Import, alte Fahrten).
  select * into v_std from public.orte_standard limit 1;
  if v_job.pickup_ort_id is not null then
    select * into v_pickup_ort from public.orte where id = v_job.pickup_ort_id;
  elsif v_pickup_lat is not null then
    select o.* into v_pickup_ort from public.orte o
     where public.trisar_luftlinie_m(v_pickup_lat, v_pickup_lng, o.lat, o.lng) <= o.radius_raus_m
     order by public.trisar_luftlinie_m(v_pickup_lat, v_pickup_lng, o.lat, o.lng) limit 1;
  end if;
  if v_job.dropoff_ort_id is not null then
    select * into v_dropoff_ort from public.orte where id = v_job.dropoff_ort_id;
  elsif v_dropoff_lat is not null then
    select o.* into v_dropoff_ort from public.orte o
     where public.trisar_luftlinie_m(v_dropoff_lat, v_dropoff_lng, o.lat, o.lng) <= o.radius_raus_m
     order by public.trisar_luftlinie_m(v_dropoff_lat, v_dropoff_lng, o.lat, o.lng) limit 1;
  end if;
  if v_pickup_ort.id is not null then
    v_pickup_lat := v_pickup_ort.lat;
    v_pickup_lng := v_pickup_ort.lng;
  end if;
  if v_dropoff_ort.id is not null then
    v_dropoff_lat := v_dropoff_ort.lat;
    v_dropoff_lng := v_dropoff_ort.lng;
  end if;
  v_pickup_rein := coalesce(v_pickup_ort.radius_rein_m, v_std.radius_rein_m, v_enter_radius);
  v_pickup_raus := greatest(coalesce(v_pickup_ort.radius_raus_m, v_std.radius_raus_m, v_exit_radius), v_pickup_rein + 1);
  v_dropoff_rein := coalesce(v_dropoff_ort.radius_rein_m, v_std.radius_rein_m, v_done_radius);

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

  -- Routen-Distanz nur, wenn sie frisch ist. Sie bleibt nach dem letzten Sync in der Fahrt stehen
  -- (z. B. 15 m zum Ziel nach dem Beenden). Setzte die Dispo die Fahrt danach wieder auf unterwegs
  -- oder offen, sprang sie mit diesem alten Wert sofort zurueck auf beendet bzw. beim Gast.
  v_pickup_distance := coalesce(
    v_pickup_luft,
    case when v_job.ext_driver_to_pickup_last_sync_at > now() - interval '5 minutes'
         then v_job.ext_driver_to_pickup_distance_m end,
    2147483647);
  v_dropoff_distance := coalesce(
    v_dropoff_luft,
    case when v_job.ext_driver_to_dropoff_last_sync_at > now() - interval '5 minutes'
         then v_job.ext_driver_to_dropoff_distance_m end,
    2147483647);
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
    -- Fahrt ohne Start: der Start IST der Standort des Fahrers, er steht also sofort "am Abholort".
    -- Erst nach dem Annehmen (assigned/zugewiesen) darf daraus "Beim Gast" werden, sonst
    -- verschwindet das Annehmen in der Fahrer-App, bevor er es tippen kann.
    if v_pickup_distance <= v_pickup_rein and public.trisar_fahrt_ist_dran(v_job)
       and not (coalesce(v_job.start_fahrerstandort, false) and v_status not in ('assigned', 'zugewiesen')) then
      perform public.trisar_transition_job_status(
        p_job_id,
        'at_pickup',
        p_source,
        jsonb_build_object('pickup_distance_m', v_pickup_distance, 'radius_m', v_pickup_rein, 'ort', v_pickup_ort.name)
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
    elsif v_pickup_distance > v_pickup_raus then
      -- Beim Gast ab dem Reinfahr-Radius, unterwegs erst ausserhalb des (groesseren) Rausfahr-Radius,
      -- sobald genug Punkte in Folge draussen sind (status_pickup_depart_hits, gegen GPS-Ausreisser).
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
    if v_dropoff_distance <= v_dropoff_rein then
      v_dropoff_near_hits := v_dropoff_near_hits + 1;
    else
      v_dropoff_near_hits := greatest(v_dropoff_near_hits - 1, 0);
    end if;

    if v_dropoff_near_hits >= greatest(v_done_hits_required, 1) then
      perform public.trisar_transition_job_status(
        p_job_id,
        'done',
        p_source,
        jsonb_build_object('dropoff_distance_m', v_dropoff_distance, 'dropoff_hits', v_dropoff_near_hits,
                           'radius_m', v_dropoff_rein, 'ort', v_dropoff_ort.name)
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
$function$
;

update public.jobs j
   set status = 'pending'
 where j.start_fahrerstandort
   and public.trisar_norm_status(j.status) in ('at_pickup', 'pickup', 'beim_pickup', 'beim pickup')
   and j.ride_date >= current_date - 1
   -- nur, wenn sie direkt aus "nicht angenommen" auf at_pickup gesprungen ist
   and exists (
     select 1 from public.job_status_history e
      where e.job_id = j.id and e.to_status = 'at_pickup'
        and e.from_status in ('pending', 'new', 'requested', 'offered', 'offen'));
