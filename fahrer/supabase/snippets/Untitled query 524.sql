alter table public.profiles
  add column if not exists street text,
  add column if not exists street_number text,
  add column if not exists city text,
  add column if not exists zip text,
  add column if not exists language text default 'Deutsch';

-- Optional: bestehende NULL-Werte direkt auf Standard setzen
update public.profiles
set language = 'Deutsch'
where language is null;
