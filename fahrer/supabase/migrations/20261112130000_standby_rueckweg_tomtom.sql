-- Standby-Rueckweg: Ankunft zurueck am Event rechnet der Server mit TomTom (Live-Verkehr) (12.11.2026).
--
-- Bisher rechnete das Web im Browser mit TomTom und iOS mit OSRM ohne Verkehr. Jetzt einheitlich:
--   * standby_fahrer.rueck_ankunft / rueck_minuten / rueck_sync: Ergebnis je Fahrer auf dem Rueckweg.
--   * Neuer Standort eines Fahrers auf dem Rueckweg, oder Wechsel auf "rueckweg": hoechstens alle
--     45 s ruft die Datenbank external-sync (aktion standby_rueckweg) per pg_net auf. Die Funktion
--     fragt TomTom vom Live-Standort zum Event-Ort und schreibt die Ankunft zurueck.
--   * Verlaesst der Fahrer den Rueckweg, werden die Werte geleert.
-- Web, iOS und Android lesen nur noch rueck_ankunft (Realtime auf standby_fahrer).

alter table public.standby_fahrer add column if not exists rueck_ankunft timestamptz;
alter table public.standby_fahrer add column if not exists rueck_minuten integer;
alter table public.standby_fahrer add column if not exists rueck_sync timestamptz;

-- Aufruf der Edge-Funktion (wie trisar_route_anstossen).
create or replace function public.standby_rueckweg_rufen(p_standby uuid, p_fahrer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schluessel text;
begin
  select value #>> '{}' into v_schluessel from public.integration_settings where key = 'edge_service_role_key';
  if coalesce(v_schluessel, '') = '' then return; end if;
  perform net.http_post(
    url := 'http://kong:8000/functions/v1/external-sync',
    body := jsonb_build_object('aktion', 'standby_rueckweg', 'standby_id', p_standby, 'driver_id', p_fahrer),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_schluessel,
                                  'apikey', v_schluessel),
    timeout_milliseconds := 30000
  );
end;
$$;
revoke all on function public.standby_rueckweg_rufen(uuid, uuid) from public, anon, authenticated;

-- Neuer Standort: fuer jeden Standby auf dem Rueckweg (gedrosselt) neu rechnen lassen.
create or replace function public.standby_rueckweg_standort()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  for f in
    update public.standby_fahrer s set rueck_sync = now()
     where s.driver_id = new.driver_id and s.zustand = 'rueckweg' and lower(s.status) = 'accepted'
       and (s.rueck_sync is null or s.rueck_sync < now() - interval '45 seconds')
    returning s.standby_id, s.driver_id
  loop
    perform public.standby_rueckweg_rufen(f.standby_id, f.driver_id);
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_standby_rueckweg_standort on public.driver_live_locations;
create trigger trg_standby_rueckweg_standort
  after insert or update of lat, lng, captured_at on public.driver_live_locations
  for each row execute function public.standby_rueckweg_standort();

-- Zustand wechselt: auf Rueckweg sofort rechnen, sonst Werte leeren.
create or replace function public.standby_rueckweg_zustand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.zustand is distinct from old.zustand then
    if new.zustand = 'rueckweg' then
      new.rueck_sync := now();
      perform public.standby_rueckweg_rufen(new.standby_id, new.driver_id);
    else
      new.rueck_ankunft := null;
      new.rueck_minuten := null;
      new.rueck_sync := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_standby_rueckweg_zustand on public.standby_fahrer;
create trigger trg_standby_rueckweg_zustand
  before update of zustand on public.standby_fahrer
  for each row execute function public.standby_rueckweg_zustand();
