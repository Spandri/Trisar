-- Jede Fahrt bekommt ihre Route (TomTom: Koordinaten, Strecke, Dauer) direkt vom Server.
--
-- Bisher stiess nur die Web-Dispo die Routenberechnung (Edge Function external-sync) an, und das
-- nur bei Flughafenfahrten mit geprueftem Flug. Normale, importierte oder in den Apps angelegte
-- Fahrten hatten keine Koordinaten, bis ein Fahrer annahm. Folge: keine Route auf der Karte, kein
-- Ortsradius, Adresssuche mit Freitext ("Friedberger Str. 71, Augsburg, nach Abstimmung") scheitert.
--
-- Jetzt: Beim Anlegen und bei geaenderter Abhol- oder Zieladresse ruft die DB selbst external-sync
-- auf (pg_net, asynchron nach dem Commit). Der Schluessel liegt in integration_settings
-- ('edge_service_role_key', nur service_role lesbar), das Ausroll-Skript traegt ihn ein.
-- Fehlt er, passiert nichts.

create extension if not exists pg_net;

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
     and new.dropoff_address is not distinct from old.dropoff_address then
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
  after insert or update of pickup_address, dropoff_address on public.jobs
  for each row execute function public.trisar_route_anstossen();
