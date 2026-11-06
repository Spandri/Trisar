-- Tracker-Nummern: jeder OBD-Tracker hat eine Nummer, die auf dem Geraet klebt.
-- Die Dispo zeigt beim Fahrer "Nr. 2 · IMEI" statt nur der IMEI und listet auch
-- Tracker, die noch nie einem Fahrer zugeordnet waren.

create table if not exists public.obd_tracker (
  imei text primary key check (imei ~ '^\d{15}$'),
  nummer integer not null unique check (nummer > 0),
  modell text,
  sim text,
  erstellt timestamptz not null default now()
);

alter table public.obd_tracker enable row level security;
drop policy if exists dispo_alles on public.obd_tracker;
create policy dispo_alles on public.obd_tracker
  for all to authenticated using (public.ist_dispo()) with check (public.ist_dispo());

insert into public.obd_tracker (imei, nummer, modell, sim) values
  ('357544371355146', 1, 'FMB010', '…825295'),
  ('860848088205357', 2, 'FMC003', '…825298'),
  ('860848088432159', 3, 'FMC003', '…825299')
on conflict (imei) do update set nummer = excluded.nummer, modell = excluded.modell, sim = excluded.sim;
