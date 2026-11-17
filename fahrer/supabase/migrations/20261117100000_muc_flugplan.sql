-- Saisonflugplan Flughafen Muenchen (17.11.2026).
--
-- Kostenlose Flugdaten fuer die Forschungsphase. Der Flughafen stellt den Saisonflugplan taeglich neu als PDF
-- bereit (munich-airport.de/saisonflugplan). _shared/muc-flughafen.ts laedt ihn hoechstens einmal am Tag in diese
-- Tabelle (nur Ankuenfte). flight-validate prueft damit Fahrten, die weiter als morgen in der Zukunft liegen.
-- Fuer gestern bis morgen gilt die Live-Flugsuche des Flughafens (findet auch Codeshares), nicht diese Tabelle.
--
-- Nur fuer nicht gewerblichen Gebrauch (Nutzungsbedingungen des Flughafens). Lesen nur ueber den Server
-- (Service-Rolle), darum RLS ohne Policies.

create table if not exists public.muc_flugplan (
  id bigserial primary key,
  stand uuid not null,
  flugnummer text not null,
  zeit_andere time,
  zeit_muc time not null,
  tage text not null check (tage ~ '^[1-7-]{7}$'),
  flughafen text,
  gueltig_von date not null,
  gueltig_bis date not null,
  terminal text,
  airline text
);
create index if not exists muc_flugplan_flugnummer_idx on public.muc_flugplan (flugnummer, gueltig_von, gueltig_bis);
create index if not exists muc_flugplan_stand_idx on public.muc_flugplan (stand);
alter table public.muc_flugplan enable row level security;

create table if not exists public.muc_flugplan_stand (
  id int primary key default 1 check (id = 1),
  geladen_am timestamptz,
  datenstand text,
  zeilen int,
  fehler text
);
alter table public.muc_flugplan_stand enable row level security;
insert into public.muc_flugplan_stand (id) values (1) on conflict (id) do nothing;
