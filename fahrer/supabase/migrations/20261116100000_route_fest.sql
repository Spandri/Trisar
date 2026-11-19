-- Freigegebene Route der Dispo festschreiben (16.11.). Bisher lagen nur die Routenpunkte an der Fahrt,
-- zwischen den Punkten rechnete TomTom bei jeder Abfrage neu (je nach Verkehr ein anderer Weg).
-- Jetzt gilt: was die Dispo im Routen-Editor sieht und uebernimmt, wird genau so gespeichert und dem
-- Fahrer genau so gezeigt. route_fest = {v, polyline, laenge_m, dauer_s, hinweise, wegpunkte, punkte}
-- kommt aus places-proxy (route_vorschau) und wird von den Dispo-Apps mit der Fahrt gespeichert.
-- TomTom rechnet danach nur noch die Anfahrt und den Weg zurueck auf die Route, wenn sich der Fahrer verfaehrt.

alter table public.jobs add column if not exists route_fest jsonb;

-- Aendern sich Start, Ziel, Stopps oder Routenpunkte ohne neue Freigabe, gilt die alte nicht mehr.
create or replace function public.trisar_routen_punkte_pruefen()
returns trigger
language plpgsql
as $$
declare
  v_adressen_neu boolean;
begin
  v_adressen_neu := new.pickup_address is distinct from old.pickup_address
     or new.dropoff_address is distinct from old.dropoff_address
     or new.zwischenstopps is distinct from old.zwischenstopps;
  if v_adressen_neu and new.routen_punkte is not distinct from old.routen_punkte then
    new.routen_punkte := '[]'::jsonb;
  end if;
  if (v_adressen_neu or new.routen_punkte is distinct from old.routen_punkte)
     and new.route_fest is not distinct from old.route_fest then
    new.route_fest := null;
  end if;
  if jsonb_array_length(new.routen_punkte) = 0 then
    new.route_fest := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_routen_punkte_pruefen on public.jobs;
create trigger trg_jobs_routen_punkte_pruefen
  before update of pickup_address, dropoff_address, zwischenstopps, routen_punkte, route_fest on public.jobs
  for each row execute function public.trisar_routen_punkte_pruefen();

-- Route der Fahrt auch dann auffrischen, wenn nur die Freigabe neu ist.
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
     and new.routen_punkte is not distinct from old.routen_punkte
     and new.route_fest is not distinct from old.route_fest then
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
  after insert or update of pickup_address, dropoff_address, zwischenstopps, routen_punkte, route_fest on public.jobs
  for each row execute function public.trisar_route_anstossen();
