-- Mapping fuer Teltonika IMEI -> Fahrerprofil
-- Beispiel:
-- insert into public.imei_driver_map (imei, driver_id)
-- values ('123456789012345', '00000000-0000-0000-0000-000000000000')
-- on conflict (imei) do update set driver_id = excluded.driver_id, is_active = true;

create table if not exists public.imei_driver_map (
  imei text primary key,
  driver_id uuid not null references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists idx_imei_driver_map_driver_id
  on public.imei_driver_map(driver_id);

create index if not exists idx_imei_driver_map_active
  on public.imei_driver_map(is_active)
  where is_active = true;

alter table public.imei_driver_map enable row level security;

drop policy if exists imei_driver_map_select_authenticated on public.imei_driver_map;
create policy imei_driver_map_select_authenticated
  on public.imei_driver_map
  for select
  to authenticated
  using (true);

drop policy if exists imei_driver_map_write_service_role on public.imei_driver_map;
create policy imei_driver_map_write_service_role
  on public.imei_driver_map
  for all
  to service_role
  using (true)
  with check (true);

