-- Zwischenstopps einer Fahrt (Sammelfahrt): Adressen in Fahrtreihenfolge zwischen Start und Ziel.
-- Eine Fahrt mit Stopps bleibt eine Fahrt, die Statusregel laeuft weiter ueber Start und Ziel.
-- Die zweite Abholung auf dem Weg war bisher eine eigene Fahrt, die bei laufender erster Fahrt
-- nie automatisch starten konnte (trisar_fahrt_ist_dran erlaubt je Fahrer nur eine laufende Fahrt).

alter table public.jobs
  add column if not exists zwischenstopps jsonb not null default '[]'::jsonb;

alter table public.jobs drop constraint if exists jobs_zwischenstopps_ist_liste;
alter table public.jobs
  add constraint jobs_zwischenstopps_ist_liste check (jsonb_typeof(zwischenstopps) = 'array');

-- Route neu rechnen, auch wenn sich nur die Stopps aendern.
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
     and new.zwischenstopps is not distinct from old.zwischenstopps then
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
  after insert or update of pickup_address, dropoff_address, zwischenstopps on public.jobs
  for each row execute function public.trisar_route_anstossen();
