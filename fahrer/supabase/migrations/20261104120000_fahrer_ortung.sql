-- Ortung je Fahrer: Handy-App oder OBD-Tracker.
-- 'app': Fahrer-App schreibt den Standort (driver_live_locations).
-- 'obd': Nur der Tracker aus imei_driver_map schreibt, die App zeigt die Position nur lokal.
alter table public.profiles
  add column if not exists tracking_mode text not null default 'app';

alter table public.profiles drop constraint if exists profiles_tracking_mode_check;
alter table public.profiles
  add constraint profiles_tracking_mode_check check (tracking_mode in ('app', 'obd'));

-- Wer heute schon einen aktiven Tracker hat, faehrt ab jetzt mit OBD.
update public.profiles p
set tracking_mode = 'obd'
where exists (
  select 1 from public.imei_driver_map m
  where m.driver_id = p.id and m.is_active = true
);
