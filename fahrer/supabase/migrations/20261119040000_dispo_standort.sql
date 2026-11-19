-- Standort der Dispo (19.11.2026): Die Apps (Web, iOS, Android) schreiben hier ihren aktuellen Standort, wenn sie ihn
-- ohnehin holen (Dispo-Karte mit blauem Punkt, "Ankuenfte bei mir"), hoechstens einmal je Minute oder nach 100 m.
-- Eine Zeile je Dispo-Konto. Der KI-Assistent (dispo-admin/ortSuche.ts) sucht Adressen dann zuerst in der Naehe:
-- "Frühlingstr" ist erst die in München, dann Augsburg, dann Berlin.

create table if not exists public.dispo_standort (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  genau_m double precision,
  aktualisiert timestamptz not null default now()
);

alter table public.dispo_standort enable row level security;
drop policy if exists eigene_zeile on public.dispo_standort;
create policy eigene_zeile on public.dispo_standort for all to authenticated
  using (user_id = auth.uid() and public.ist_dispo())
  with check (user_id = auth.uid() and public.ist_dispo());
grant select, insert, update, delete on public.dispo_standort to authenticated;
