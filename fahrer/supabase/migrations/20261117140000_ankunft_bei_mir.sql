-- "Ankuenfte bei mir" (17.11.2026, Kundenwunsch): Die Dispo schaltet im Fahrten Filter ein, dass sie
-- Fahrzeuge zu ihrem Ort gemeldet bekommt. Ort = einmal uebernommener Standort des Handys oder ein
-- eigener Ort (orte). Gemeldet werden Fahrten, deren Ziel (Ankunft) oder Abholort (Abfahrt) im Umkreis
-- liegt, per Push "in 5 min bei dir" und "ist angekommen". Die Listen Ankuenfte/Abfahrten zeigen mit dem
-- Schalter nur diese Fahrten, mit Restzeit.
--
-- Restzeit:
--   1. Live-Anfahrt der Fahrt (ext_driver_to_dropoff_* bzw. ext_driver_to_pickup_*), hoechstens 3 min alt
--   2. sonst Luftlinie vom frischen Live-Standort (hoechstens 3 min alt) mal 1,3 geteilt durch das
--      Tempo der geplanten Route (ext_route_distance_m / Dauer), ohne Route 500 m/min. geschaetzt = true.
-- Angekommen: Fahrer hoechstens 150 m vom Ziel bzw. Abholort, oder Fahrt seit hoechstens 30 min beendet
-- (Ziel) bzw. Fahrer beim Gast (Abholung).
--
-- push_dispo_ankuenfte() ruft der push-dienst jede Minute auf. Jedes Ereignis nur einmal (push_erinnert).

create table if not exists public.dispo_ankunft_melden (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  an boolean not null default false,
  ort_id uuid references public.orte(id) on delete set null,
  ort_name text,
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  umkreis_m integer not null default 300 check (umkreis_m between 50 and 5000),
  minuten integer not null default 5 check (minuten between 1 and 60),
  bei_ankunft boolean not null default true,
  geaendert timestamptz not null default now()
);

alter table public.dispo_ankunft_melden enable row level security;
drop policy if exists eigene_zeile on public.dispo_ankunft_melden;
create policy eigene_zeile on public.dispo_ankunft_melden for all to authenticated
  using (user_id = auth.uid() and public.ist_dispo())
  with check (user_id = auth.uid() and public.ist_dispo());
grant select, insert, update, delete on public.dispo_ankunft_melden to authenticated;

drop trigger if exists dispo_ankunft_melden_geaendert on public.dispo_ankunft_melden;
create trigger dispo_ankunft_melden_geaendert before update on public.dispo_ankunft_melden
  for each row execute function public.orte_geaendert_setzen();

-- Fahrten zum Ort einer Dispo. art 'ziel' = Fahrt endet bei mir, 'abholung' = Fahrt beginnt bei mir.
-- rest_min null = Fahrzeug ist noch nicht zu mir unterwegs (oder keine frische Position).
create or replace function public.ankunft_liste_fuer(p_user uuid)
returns table (
  job_id uuid,
  art text,
  rest_min integer,
  geschaetzt boolean,
  angekommen boolean,
  driver_id uuid
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.dispo_ankunft_melden%rowtype;
  j record;
  live public.driver_live_locations%rowtype;
  hat_live boolean;
  heute date := (now() at time zone 'Europe/Berlin')::date;
  jetzt timestamptz := now();
  v_fahrt constant text[] := array['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
  v_beim_gast constant text[] := array['at_pickup', 'pickup', 'beim_pickup', 'beim pickup'];
  v_fertig constant text[] := array['done', 'completed', 'arrived', 'beendet'];
  v_weg constant text[] := array['cancelled', 'canceled', 'refused', 'storniert', 'stoniert'];
  st text;
  t_lat double precision;
  t_lng double precision;
  sync_at timestamptz;
  sync_min numeric;
  luft integer;
  tempo numeric;
  dauer numeric;
begin
  select * into m from public.dispo_ankunft_melden d
  where d.user_id = p_user and d.an and d.lat is not null and d.lng is not null;
  if not found then return; end if;

  for j in
    select x.*,
      coalesce(po.lat, (x.ext_route_payload->'von'->>'lat')::float8,
               (x.ext_driver_to_pickup_payload->'nach'->>'lat')::float8) as p_lat,
      coalesce(po.lng, (x.ext_route_payload->'von'->>'lon')::float8, (x.ext_route_payload->'von'->>'lng')::float8,
               (x.ext_driver_to_pickup_payload->'nach'->>'lon')::float8) as p_lng,
      coalesce(zo.lat, (x.ext_route_payload->'nach'->>'lat')::float8,
               (x.ext_driver_to_dropoff_payload->'nach'->>'lat')::float8) as z_lat,
      coalesce(zo.lng, (x.ext_route_payload->'nach'->>'lon')::float8, (x.ext_route_payload->'nach'->>'lng')::float8,
               (x.ext_driver_to_dropoff_payload->'nach'->>'lon')::float8) as z_lng
    from public.jobs x
    left join public.orte po on po.id = x.pickup_ort_id
    left join public.orte zo on zo.id = x.dropoff_ort_id
    where x.ride_date between heute - 1 and heute + 1
      and public.trisar_norm_status(x.status) <> all (v_weg)
      and not exists (select 1 from public.jobs_archive a where a.job_id = x.id)
  loop
    st := public.trisar_norm_status(j.status);

    hat_live := false;
    if j.driver_id is not null then
      select * into live from public.driver_live_locations l
      where l.driver_id = j.driver_id
        and coalesce(l.captured_at, l.updated_at) > jetzt - interval '3 minutes'
        and l.lat is not null and l.lng is not null;
      hat_live := found;
    end if;

    -- Tempo der geplanten Route in m/min (fuer die Schaetzung aus der Luftlinie)
    dauer := coalesce(j.ext_route_duration_in_traffic_mins, j.ext_route_duration_mins);
    tempo := case when coalesce(j.ext_route_distance_m, 0) > 0 and coalesce(dauer, 0) > 0
                  then least(1500, greatest(200, j.ext_route_distance_m / dauer)) else 500 end;

    -- Fahrt endet bei mir
    if j.z_lat is not null
       and public.trisar_luftlinie_m(j.z_lat, j.z_lng, m.lat, m.lng) <= m.umkreis_m
       and (j.ride_date = heute or st = any (v_fahrt)) then
      t_lat := j.z_lat; t_lng := j.z_lng;
      job_id := j.id; art := 'ziel'; driver_id := j.driver_id;
      rest_min := null; geschaetzt := false; angekommen := false;
      if st = any (v_fertig) then
        -- beendet: nur kurz als angekommen zeigen
        if exists (select 1 from public.job_status_history h
                   where h.job_id = j.id and public.trisar_norm_status(h.to_status) = any (v_fertig)
                     and h.created_at > jetzt - interval '30 minutes') then
          angekommen := true;
          return next;
        end if;
      elsif st = any (v_fahrt) then
        luft := case when hat_live then public.trisar_luftlinie_m(live.lat, live.lng, t_lat, t_lng) end;
        sync_at := j.ext_driver_to_dropoff_last_sync_at;
        sync_min := coalesce(j.ext_driver_to_dropoff_duration_in_traffic_mins, j.ext_driver_to_dropoff_duration_mins);
        if luft is not null and luft <= 150 then
          angekommen := true; rest_min := 0;
        elsif sync_at > jetzt - interval '3 minutes' and sync_min is not null then
          rest_min := greatest(0, round(extract(epoch from sync_at + make_interval(mins => sync_min::int) - jetzt) / 60))::int;
        elsif luft is not null then
          rest_min := ceil(luft * 1.3 / tempo)::int; geschaetzt := true;
        end if;
        return next;
      else
        return next;  -- geplant, noch nicht mit Gast unterwegs
      end if;
    end if;

    -- Fahrt beginnt bei mir (Fahrer kommt zum Abholen)
    if j.p_lat is not null
       and public.trisar_luftlinie_m(j.p_lat, j.p_lng, m.lat, m.lng) <= m.umkreis_m
       and j.ride_date = heute
       and st <> all (v_fahrt) and st <> all (v_fertig) then
      t_lat := j.p_lat; t_lng := j.p_lng;
      job_id := j.id; art := 'abholung'; driver_id := j.driver_id;
      rest_min := null; geschaetzt := false; angekommen := false;
      if st = any (v_beim_gast) then
        angekommen := true; rest_min := 0;
      elsif j.driver_id is not null
            and j.etd is not null
            and (j.ride_date + j.etd) at time zone 'Europe/Berlin' between jetzt - interval '1 hour' and jetzt + interval '2 hours'
            -- Fahrer faehrt gerade keine andere Fahrt, sonst waere die Anfahrt falsch
            and not exists (select 1 from public.jobs o
                            where o.driver_id = j.driver_id and o.id <> j.id
                              and public.trisar_norm_status(o.status) = any (v_fahrt)) then
        luft := case when hat_live then public.trisar_luftlinie_m(live.lat, live.lng, t_lat, t_lng) end;
        sync_at := j.ext_driver_to_pickup_last_sync_at;
        sync_min := coalesce(j.ext_driver_to_pickup_duration_in_traffic_mins, j.ext_driver_to_pickup_duration_mins);
        if luft is not null and luft <= 150 then
          angekommen := true; rest_min := 0;
        elsif sync_at > jetzt - interval '3 minutes' and sync_min is not null then
          rest_min := greatest(0, round(extract(epoch from sync_at + make_interval(mins => sync_min::int) - jetzt) / 60))::int;
        elsif luft is not null then
          rest_min := ceil(luft * 1.3 / 500)::int; geschaetzt := true;
        end if;
      end if;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.ankunft_liste_fuer(uuid) from public, anon, authenticated;
grant execute on function public.ankunft_liste_fuer(uuid) to service_role;

-- Fuer die Apps: Liste der eigenen Dispo.
create or replace function public.ankunft_bei_mir()
returns table (
  job_id uuid,
  art text,
  rest_min integer,
  geschaetzt boolean,
  angekommen boolean,
  driver_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.ankunft_liste_fuer(auth.uid()) where public.ist_dispo();
$$;

revoke all on function public.ankunft_bei_mir() from public, anon;
grant execute on function public.ankunft_bei_mir() to authenticated;

-- Push an jede Dispo mit eingeschaltetem Schalter. Jede Minute vom push-dienst.
create or replace function public.push_dispo_ankuenfte()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  r record;
  anzahl int := 0;
  merker text;
  ort text;
  name text;
  fahrt public.jobs;
begin
  for m in
    select d.*, o.name as o_name from public.dispo_ankunft_melden d
    join public.profiles p on p.id = d.user_id
    left join public.orte o on o.id = d.ort_id
    where d.an and d.lat is not null and d.lng is not null
      and lower(coalesce(p.role, '')) <> 'pruefung'
  loop
    ort := coalesce(nullif(btrim(m.ort_name), ''), m.o_name);
    for r in select * from public.ankunft_liste_fuer(m.user_id) loop
      continue when r.driver_id is null;
      select * into fahrt from public.jobs where id = r.job_id;
      name := public.push_name(r.driver_id);
      if r.angekommen then
        continue when not m.bei_ankunft;
        -- Schon laenger beendete Fahrten nicht nachmelden (z. B. direkt nach dem Einschalten)
        continue when public.trisar_norm_status(fahrt.status) in ('done', 'completed', 'arrived', 'beendet')
          and not exists (select 1 from public.job_status_history h
                          where h.job_id = r.job_id and h.created_at > now() - interval '5 minutes'
                            and public.trisar_norm_status(h.to_status) in ('done', 'completed', 'arrived', 'beendet'));
        merker := 'ankunft_da:' || m.user_id || ':' || r.job_id || ':' || r.art;
        continue when exists (select 1 from public.push_erinnert e where e.schluessel = merker);
        insert into public.push_erinnert (schluessel) values (merker);
        perform public.push_melden(m.user_id, 'dispo', 'dispo_ankunft',
          case when r.art = 'ziel' then 'Angekommen' else 'Zum Abholen da' end,
          name || case when r.art = 'ziel' then ' ist angekommen' else ' ist zum Abholen da' end
            || coalesce(' (' || ort || ')', '') || '. ' || public.push_fahrt_text(fahrt) || '.',
          jsonb_build_object('ziel', 'fahrt', 'job_id', r.job_id, 'driver_id', r.driver_id));
        anzahl := anzahl + 1;
      elsif r.rest_min is not null and r.rest_min <= m.minuten then
        merker := 'ankunft_bald:' || m.user_id || ':' || r.job_id || ':' || r.art;
        continue when exists (select 1 from public.push_erinnert e where e.schluessel = merker);
        insert into public.push_erinnert (schluessel) values (merker);
        perform public.push_melden(m.user_id, 'dispo', 'dispo_ankunft',
          case when r.art = 'ziel' then 'Gleich da' else 'Kommt zum Abholen' end,
          name || ' in ' || case when r.geschaetzt then 'ca. ' else '' end || greatest(1, r.rest_min) || ' min bei dir'
            || coalesce(' (' || ort || ')', '') || '. ' || public.push_fahrt_text(fahrt) || '.',
          jsonb_build_object('ziel', 'fahrt', 'job_id', r.job_id, 'driver_id', r.driver_id));
        anzahl := anzahl + 1;
      end if;
    end loop;
  end loop;
  return anzahl;
end;
$$;

revoke all on function public.push_dispo_ankuenfte() from public, anon, authenticated;
grant execute on function public.push_dispo_ankuenfte() to service_role;
