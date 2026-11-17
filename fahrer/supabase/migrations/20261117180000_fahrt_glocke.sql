-- Glocke je Fahrt (17.11.2026): Die Dispo wischt eine Fahrt auf und tippt die Glocke. Dann bekommt sie
-- zu genau dieser Fahrt Meldungen: Fahrer beim Gast, mit Gast unterwegs, 5 min vor Ankunft, angekommen.
-- Ersetzt den Knopf "Fahrer hinzufuegen", der nie eine Funktion hatte.
-- push_fahrt_glocke() ruft der push-dienst jede Minute auf. Jedes Ereignis nur einmal (push_erinnert).

create table if not exists public.fahrt_glocke (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  erstellt timestamptz not null default now(),
  primary key (user_id, job_id)
);

alter table public.fahrt_glocke enable row level security;
drop policy if exists eigene_zeile on public.fahrt_glocke;
create policy eigene_zeile on public.fahrt_glocke for all to authenticated
  using (user_id = auth.uid() and public.ist_dispo())
  with check (user_id = auth.uid() and public.ist_dispo());
grant select, insert, delete on public.fahrt_glocke to authenticated;

-- Restzeit bis zum Ziel einer Fahrt, gleiche Regeln wie ankunft_liste_fuer (art ziel):
-- frische Live-Anfahrt (3 min), sonst Luftlinie vom frischen Live-Standort mal 1,3 durch Routentempo.
-- am_ziel: Fahrer hoechstens 150 m vom Ziel.
create or replace function public.fahrt_ziel_rest(p_job uuid)
returns table (rest_min integer, geschaetzt boolean, am_ziel boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  j record;
  live public.driver_live_locations%rowtype;
  jetzt timestamptz := now();
  luft integer;
  tempo numeric;
  dauer numeric;
  sync_min numeric;
begin
  select x.*,
    coalesce(zo.lat, (x.ext_route_payload->'nach'->>'lat')::float8,
             (x.ext_driver_to_dropoff_payload->'nach'->>'lat')::float8) as z_lat,
    coalesce(zo.lng, (x.ext_route_payload->'nach'->>'lon')::float8, (x.ext_route_payload->'nach'->>'lng')::float8,
             (x.ext_driver_to_dropoff_payload->'nach'->>'lon')::float8) as z_lng
  into j
  from public.jobs x
  left join public.orte zo on zo.id = x.dropoff_ort_id
  where x.id = p_job;
  if not found then return; end if;

  rest_min := null; geschaetzt := false; am_ziel := false;
  if j.driver_id is not null and j.z_lat is not null then
    select * into live from public.driver_live_locations l
    where l.driver_id = j.driver_id
      and coalesce(l.captured_at, l.updated_at) > jetzt - interval '3 minutes'
      and l.lat is not null and l.lng is not null;
    if found then luft := public.trisar_luftlinie_m(live.lat, live.lng, j.z_lat, j.z_lng); end if;
  end if;

  dauer := coalesce(j.ext_route_duration_in_traffic_mins, j.ext_route_duration_mins);
  tempo := case when coalesce(j.ext_route_distance_m, 0) > 0 and coalesce(dauer, 0) > 0
                then least(1500, greatest(200, j.ext_route_distance_m / dauer)) else 500 end;
  sync_min := coalesce(j.ext_driver_to_dropoff_duration_in_traffic_mins, j.ext_driver_to_dropoff_duration_mins);

  if luft is not null and luft <= 150 then
    am_ziel := true; rest_min := 0;
  elsif j.ext_driver_to_dropoff_last_sync_at > jetzt - interval '3 minutes' and sync_min is not null then
    rest_min := greatest(0, round(extract(epoch from j.ext_driver_to_dropoff_last_sync_at
                                  + make_interval(mins => sync_min::int) - jetzt) / 60))::int;
  elsif luft is not null then
    rest_min := ceil(luft * 1.3 / tempo)::int; geschaetzt := true;
  end if;
  return next;
end;
$$;

revoke all on function public.fahrt_ziel_rest(uuid) from public, anon, authenticated;
grant execute on function public.fahrt_ziel_rest(uuid) to service_role;

create or replace function public.push_fahrt_glocke()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  g record;
  r record;
  anzahl int := 0;
  heute date := (now() at time zone 'Europe/Berlin')::date;
  st text;
  name text;
  ziel text;
  v_fahrt constant text[] := array['in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active'];
  v_beim_gast constant text[] := array['at_pickup', 'pickup', 'beim_pickup', 'beim pickup'];
  v_fertig constant text[] := array['done', 'completed', 'arrived', 'beendet'];
  ereignisse text[];
  e text;
  merker text;
  titel text;
  text_ text;
begin
  for g in
    select fg.user_id, fg.job_id, fg.erstellt, j as fahrt, j.status, j.driver_id, j.dropoff_name, j.dropoff_address
    from public.fahrt_glocke fg
    join public.jobs j on j.id = fg.job_id
    join public.profiles p on p.id = fg.user_id
    where j.ride_date between heute - 1 and heute + 1
      and j.driver_id is not null
      and lower(coalesce(p.role, '')) <> 'pruefung'
      and not exists (select 1 from public.jobs_archive a where a.job_id = j.id)
  loop
    st := public.trisar_norm_status(g.status);
    name := public.push_name(g.driver_id);
    ziel := coalesce(nullif(btrim(split_part(g.dropoff_name, ',', 1)), ''),
                     nullif(btrim(split_part(g.dropoff_address, ',', 1)), ''), 'Ziel');
    select * into r from public.fahrt_ziel_rest(g.job_id);
    ereignisse := '{}';

    if st = any (v_fertig) then
      -- nur melden, wenn die Fahrt nach dem Glocke-Setzen (oder gerade eben) beendet wurde
      if exists (select 1 from public.job_status_history h
                 where h.job_id = g.job_id and public.trisar_norm_status(h.to_status) = any (v_fertig)
                   and h.created_at > least(g.erstellt, now() - interval '5 minutes')) then
        ereignisse := array['da'];
      end if;
    elsif st = any (v_fahrt) then
      if r.am_ziel then
        ereignisse := array['da'];
      else
        ereignisse := array['unterwegs'];
        if r.rest_min is not null and r.rest_min <= 5 then ereignisse := ereignisse || 'bald'::text; end if;
      end if;
    elsif st = any (v_beim_gast) then
      ereignisse := array['gast'];
    end if;

    foreach e in array ereignisse loop
      merker := 'glocke_' || e || ':' || g.user_id || ':' || g.job_id;
      continue when exists (select 1 from public.push_erinnert x where x.schluessel = merker);
      -- "angekommen" schliesst die anderen ab, damit danach nichts mehr nachkommt
      if e = 'da' then
        insert into public.push_erinnert (schluessel) values
          ('glocke_unterwegs:' || g.user_id || ':' || g.job_id),
          ('glocke_bald:' || g.user_id || ':' || g.job_id)
        on conflict do nothing;
      end if;
      insert into public.push_erinnert (schluessel) values (merker) on conflict do nothing;
      if e = 'gast' then
        titel := 'Beim Gast';
        text_ := name || ' ist beim Gast. ' || public.push_fahrt_text(g.fahrt) || '.';
      elsif e = 'unterwegs' then
        titel := 'Mit Gast unterwegs';
        text_ := name || ' ist mit dem Gast unterwegs nach ' || ziel
          || case when r.rest_min is not null
                  then ', an ' || case when r.geschaetzt then 'ca. ' else '' end
                       || to_char((now() + make_interval(mins => r.rest_min)) at time zone 'Europe/Berlin', 'HH24:MI')
                  else '' end || '.';
      elsif e = 'bald' then
        titel := 'Gleich am Ziel';
        text_ := name || ' ist in ' || case when r.geschaetzt then 'ca. ' else '' end
          || greatest(1, r.rest_min) || ' min am Ziel (' || ziel || ').';
      else
        titel := 'Angekommen';
        text_ := name || ' ist am Ziel angekommen (' || ziel || ').';
      end if;
      perform public.push_melden(g.user_id, 'dispo', 'dispo_fahrt_glocke', titel, text_,
        jsonb_build_object('ziel', 'fahrt', 'job_id', g.job_id, 'driver_id', g.driver_id));
      anzahl := anzahl + 1;
    end loop;
  end loop;
  return anzahl;
end;
$$;

revoke all on function public.push_fahrt_glocke() from public, anon, authenticated;
grant execute on function public.push_fahrt_glocke() to service_role;
