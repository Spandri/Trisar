-- Restreichweite aus dem Fahrzeug (Teltonika OEM Remaining Distance, AVL-ID 755).
alter table public.vehicle_telemetry_live add column if not exists oem_remaining_distance_km integer;
