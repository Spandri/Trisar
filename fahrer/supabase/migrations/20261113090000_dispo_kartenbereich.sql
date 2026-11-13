-- Eigener Kartenbereich der Dispo (13.11.): frei mit dem Finger gezeichnete Flaeche, auf die
-- "Maps" in der Navileiste zoomt statt auf alle Fahrer. Persoenlich, je Benutzer genau einer.
create table if not exists public.dispo_kartenbereich (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Umriss als [[lng, lat], ...], offen (letzter Punkt != erster).
  punkte jsonb not null,
  aktualisiert timestamptz not null default now()
);

alter table public.dispo_kartenbereich enable row level security;

drop policy if exists kartenbereich_eigen on public.dispo_kartenbereich;
create policy kartenbereich_eigen on public.dispo_kartenbereich
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.dispo_kartenbereich to authenticated;
