-- Route einer Fahrt anpassen (Pilotkunden-Wunsch 15.11.): die Dispo setzt Routenpunkte auf der Karte.
-- Ein Routenpunkt ist {lat, lng, nach}. "nach" ist der Abschnitt der Fahrt: 0 = zwischen Start und
-- erstem Zwischenstopp (ohne Stopps: Ziel), k = nach Zwischenstopp k. Reihenfolge in der Liste = Fahrtreihenfolge.
-- Die Route rechnet der Server mit diesen Punkten (TomTom), der Fahrer bekommt sie als Zwischenziele
-- im Google-Maps-Link. Google erlaubt 9 Zwischenziele, die Abholung und die Stopps zaehlen mit.

alter table public.jobs
  add column if not exists routen_punkte jsonb not null default '[]'::jsonb;

alter table public.jobs drop constraint if exists jobs_routen_punkte_ist_liste;
alter table public.jobs
  add constraint jobs_routen_punkte_ist_liste check (jsonb_typeof(routen_punkte) = 'array');

-- Aendern sich Start, Ziel oder Stopps ohne neue Routenpunkte, passen die alten nicht mehr: weg damit.
create or replace function public.trisar_routen_punkte_pruefen()
returns trigger
language plpgsql
as $$
begin
  if new.routen_punkte is distinct from old.routen_punkte then
    return new;
  end if;
  if new.pickup_address is distinct from old.pickup_address
     or new.dropoff_address is distinct from old.dropoff_address
     or new.zwischenstopps is distinct from old.zwischenstopps then
    new.routen_punkte := '[]'::jsonb;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_routen_punkte_pruefen on public.jobs;
create trigger trg_jobs_routen_punkte_pruefen
  before update of pickup_address, dropoff_address, zwischenstopps on public.jobs
  for each row execute function public.trisar_routen_punkte_pruefen();

-- Route neu rechnen, auch wenn sich nur die Routenpunkte aendern.
create or replace function public.trisar_route_anstossen()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_schluessel text;
begin
  if tg_op = 'UPDATE'
     and new.pickup_address is not distinct from old.pickup_address
     and new.dropoff_address is not distinct from old.dropoff_address
     and new.zwischenstopps is not distinct from old.zwischenstopps
     and new.routen_punkte is not distinct from old.routen_punkte then
    return new;
  end if;
  if coalesce(btrim(new.pickup_address), '') = '' or coalesce(btrim(new.dropoff_address), '') = '' then
    return new;
  end if;
  select value #>> '{}' into v_schluessel from public.integration_settings where key = 'edge_service_role_key';
  if coalesce(v_schluessel, '') = '' then
    return new;
  end if;
  perform net.http_post(
    url := 'http://kong:8000/functions/v1/external-sync',
    body := jsonb_build_object('reason', 'create', 'force_refresh', true, 'job_ids', jsonb_build_array(new.id)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_schluessel,
                                  'apikey', v_schluessel),
    timeout_milliseconds := 30000
  );
  return new;
end;
$$;

drop trigger if exists trg_jobs_route_anstossen on public.jobs;
create trigger trg_jobs_route_anstossen
  after insert or update of pickup_address, dropoff_address, zwischenstopps, routen_punkte on public.jobs
  for each row execute function public.trisar_route_anstossen();
