-- Fuegt Dienststart/Dienstende-Spalten auf profiles hinzu,
-- damit KartenView echte Werte statt '--:--' anzeigen kann.

alter table public.profiles
  add column if not exists service_start_time time,
  add column if not exists service_end_time time;

create index if not exists idx_profiles_service_start_time
  on public.profiles (service_start_time);

create index if not exists idx_profiles_service_end_time
  on public.profiles (service_end_time);

-- Optional: Initialwerte fuer bestehende Fahrer setzen
-- update public.profiles
-- set service_start_time = coalesce(service_start_time, '09:00'::time),
--     service_end_time   = coalesce(service_end_time, '19:00'::time)
-- where coalesce(is_dispo, false) = false;
