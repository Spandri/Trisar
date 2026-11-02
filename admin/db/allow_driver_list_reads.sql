-- Ermöglicht der Koordinator-App (anon/authenticated) das Lesen der Fahrer-Liste.
-- Sicherer Scope: nur Nicht-Dispo-Profile, plus zugehörige Fahrzeuge.

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;

-- Select-Rechte für Client-Rollen
grant select on public.profiles to anon, authenticated;
grant select on public.vehicles to anon, authenticated;

-- Alte Policies mit gleichem Namen entfernen (idempotent)
drop policy if exists p_profiles_read_driver_list_anon on public.profiles;
drop policy if exists p_profiles_read_driver_list_auth on public.profiles;
drop policy if exists p_vehicles_read_driver_list_anon on public.vehicles;
drop policy if exists p_vehicles_read_driver_list_auth on public.vehicles;
drop policy if exists p_profiles_read_driver_list_public on public.profiles;
drop policy if exists p_vehicles_read_driver_list_public on public.vehicles;

-- Profiles: nur Fahrer sichtbar (für anon + authenticated)
create policy p_profiles_read_driver_list_public
on public.profiles
for select
to public
using (
  coalesce(is_dispo, false) = false
  and coalesce(lower(role), 'fahrer') not in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator')
);

-- Vehicles: lesbar für Kennzeichenanzeige in Fahrer-Liste
create policy p_vehicles_read_driver_list_public
on public.vehicles
for select
to public
using (true);
