-- Benutzername fuer die Anmeldung. Konten legt die Disposition an (Edge Function dispo-admin),
-- Fahrer melden sich mit Benutzername oder E-Mail plus Passwort an (Edge Function anmelden).
-- Kleinschreibung, 3 bis 32 Zeichen aus a-z, 0-9, Punkt, Unterstrich, Bindestrich.
alter table public.profiles
  add column if not exists username text;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9._-]{3,32}$');

create unique index if not exists profiles_username_unique
  on public.profiles (username)
  where username is not null;
