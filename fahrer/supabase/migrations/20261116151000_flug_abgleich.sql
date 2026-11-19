-- Flugposition regelmaessig holen (16.11.2026).
--
-- Befund: Die Position des Flugzeugs kam nur an, wenn eine App external-sync aufrief. Die Web-Fahrer-App tut das
-- einmal beim Oeffnen der Fahrt, die iOS- und Android-App nur beim Annehmen. Im Test (VL1979, 16.11.) gab es
-- genau einen Abgleich (von Hand um 14:15), danach keinen mehr, und die App blendet eine Position nach 2 Minuten
-- aus. Das Flugzeug war also praktisch nie auf der Karte.
--
-- Jetzt stoesst die Datenbank den Abgleich selbst an, unabhaengig von der App:
--   * Ausloeser ist jeder neue Fahrer-Standort (wie beim Standby-Rueckweg), hoechstens alle 10 s geprueft.
--   * Betroffen sind Fahrten mit Flugnummer, die noch nicht gestartet sind und deren Ankunft (etd) zwischen
--     30 min zurueck und 45 min voraus liegt. Je Fahrt hoechstens ein Aufruf pro Minute. 45 min, weil OpenSky
--     ohne Konto nur 400 Abfragen-Punkte am Tag gibt (eine Abfrage kostet etwa 2). Mit Konto kann das Fenster groesser werden.
--   * external-sync bekommt nur_flug = true: nur Flugstatus und Position, keine Routen (keine TomTom-Kosten).
--     Ob OpenSky wirklich gefragt wird, entscheidet weiter external-sync (erst nach dem Abflug, hoechstens
--     einmal pro Minute, Pause nach einem 429).

create table if not exists public.flug_abgleich (
  job_id uuid primary key references public.jobs(id) on delete cascade,
  zuletzt timestamptz not null default now()
);
alter table public.flug_abgleich enable row level security;

create table if not exists public.flug_abgleich_takt (
  id boolean primary key default true check (id),
  zuletzt timestamptz not null default 'epoch'
);
alter table public.flug_abgleich_takt enable row level security;
insert into public.flug_abgleich_takt (id) values (true) on conflict do nothing;

create or replace function public.flug_abgleich_anstossen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schluessel text;
  v_jetzt timestamp := now() at time zone 'Europe/Berlin';
  f record;
begin
  update public.flug_abgleich_takt set zuletzt = now() where zuletzt < now() - interval '10 seconds';
  if not found then return null; end if;
  select value #>> '{}' into v_schluessel from public.integration_settings where key = 'edge_service_role_key';
  if coalesce(v_schluessel, '') = '' then return null; end if;
  for f in
    select j.id
      from public.jobs j
      left join public.flug_abgleich a on a.job_id = j.id
     where j.ride_date between (v_jetzt::date - 1) and (v_jetzt::date + 1)
       and coalesce(btrim(j.flight_number), '') <> ''
       and j.etd is not null
       and lower(coalesce(j.status, '')) in ('pending', 'assigned', 'accepted', 'at_pickup')
       and (j.ride_date + j.etd) between v_jetzt - interval '30 minutes' and v_jetzt + interval '45 minutes'
       and (a.zuletzt is null or a.zuletzt < now() - interval '60 seconds')
     order by j.ride_date, j.etd
     limit 4
  loop
    insert into public.flug_abgleich (job_id, zuletzt) values (f.id, now())
      on conflict (job_id) do update set zuletzt = now();
    perform net.http_post(
      url := 'http://kong:8000/functions/v1/external-sync',
      body := jsonb_build_object('reason', 'live_view', 'job_ids', jsonb_build_array(f.id), 'nur_flug', true),
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'Authorization', 'Bearer ' || v_schluessel,
                                    'apikey', v_schluessel),
      timeout_milliseconds := 30000
    );
  end loop;
  return null;
exception when others then
  -- Der Standort des Fahrers darf nie an diesem Abgleich scheitern.
  return null;
end;
$$;
revoke all on function public.flug_abgleich_anstossen() from public, anon, authenticated;

drop trigger if exists trg_flug_abgleich on public.driver_live_locations;
create trigger trg_flug_abgleich
  after insert or update of lat, lng, captured_at on public.driver_live_locations
  for each row execute function public.flug_abgleich_anstossen();
