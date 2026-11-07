-- Eigene Orte der Dispo mit Reinfahr-/Rausfahr-Radius und Icon, plus Standard-Radien fuer den Rest.
--
-- Orte (z. B. "Mercedes Event Location") pflegt die Dispo im Karten Filter. Sie tauchen beim Fahrt
-- erstellen als Vorschlag fuer Start/Ziel auf. Die Fahrt merkt sich den Ort (pickup_ort_id /
-- dropoff_ort_id), Name und Adresse werden wie gewohnt in pickup_name/pickup_address kopiert, damit
-- Google Maps beim Fahrer die echte Adresse bekommt.
--
-- Statusregel (trisar_evaluate_job_status):
--   offen -> beim Gast      Fahrer innerhalb Reinfahr-Radius des Abholorts
--   beim Gast -> unterwegs  Fahrer ausserhalb Rausfahr-Radius (groesser), Punkte in Folge
--   unterwegs -> beendet    Fahrer innerhalb Reinfahr-Radius des Ziels, Punkte in Folge
-- Radien aus dem Ort, sonst aus orte_standard. Ohne gewaehlten Ort greift der naechste Ort, in dessen
-- Rausfahr-Radius die Adresse der Fahrt liegt.

create table if not exists public.orte (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  adresse text not null check (length(btrim(adresse)) > 0),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_rein_m integer not null default 50 check (radius_rein_m between 10 and 5000),
  radius_raus_m integer not null default 100 check (radius_raus_m between 11 and 10000),
  icon text not null default 'pin'
    check (icon in ('pin', 'haus', 'flughafen_abflug', 'flughafen_landung', 'fahrzeug', 'stern')),
  erstellt timestamptz not null default now(),
  geaendert timestamptz not null default now(),
  constraint orte_raus_groesser_rein check (radius_raus_m > radius_rein_m)
);
create unique index if not exists orte_name_eindeutig on public.orte (lower(btrim(name)));

alter table public.orte enable row level security;
drop policy if exists orte_lesen on public.orte;
create policy orte_lesen on public.orte for select to authenticated using (true);
drop policy if exists dispo_alles on public.orte;
create policy dispo_alles on public.orte for all to authenticated
  using (public.ist_dispo()) with check (public.ist_dispo());

-- Standard-Radien fuer alle Adressen ohne eigenen Ort (genau eine Zeile).
create table if not exists public.orte_standard (
  id boolean primary key default true check (id),
  radius_rein_m integer not null default 50 check (radius_rein_m between 10 and 5000),
  radius_raus_m integer not null default 100 check (radius_raus_m between 11 and 10000),
  geaendert timestamptz not null default now(),
  constraint orte_standard_raus_groesser_rein check (radius_raus_m > radius_rein_m)
);
insert into public.orte_standard (id, radius_rein_m, radius_raus_m)
values (true, 50, 100) on conflict (id) do nothing;

alter table public.orte_standard enable row level security;
drop policy if exists orte_standard_lesen on public.orte_standard;
create policy orte_standard_lesen on public.orte_standard for select to authenticated using (true);
drop policy if exists dispo_aendern on public.orte_standard;
create policy dispo_aendern on public.orte_standard for update to authenticated
  using (public.ist_dispo()) with check (public.ist_dispo());

create or replace function public.orte_geaendert_setzen()
returns trigger language plpgsql as $$
begin
  new.geaendert := now();
  return new;
end;
$$;
drop trigger if exists orte_geaendert on public.orte;
create trigger orte_geaendert before update on public.orte
  for each row execute function public.orte_geaendert_setzen();
drop trigger if exists orte_standard_geaendert on public.orte_standard;
create trigger orte_standard_geaendert before update on public.orte_standard
  for each row execute function public.orte_geaendert_setzen();

alter table public.jobs add column if not exists pickup_ort_id uuid references public.orte(id) on delete set null;
alter table public.jobs add column if not exists dropoff_ort_id uuid references public.orte(id) on delete set null;

-- Realtime, damit Karte und Apps neue Orte ohne Neuladen sehen.
do $$
begin
  alter publication supabase_realtime add table public.orte;
exception when duplicate_object or undefined_object then null;
end $$;

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
    if v_pickup_distance <= v_pickup_rein then
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
$function$;

