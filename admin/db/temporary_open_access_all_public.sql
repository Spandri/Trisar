-- WARNUNG: NUR FUER TESTING
-- Dieses Script oeffnet das komplette public-Schema fuer anon/authenticated.
-- Nicht fuer Produktion geeignet.

begin;

-- Schema-Nutzung erlauben
grant usage on schema public to anon, authenticated;

-- Bestehende Objekte komplett freigeben
grant all privileges on all tables in schema public to anon, authenticated;
grant all privileges on all sequences in schema public to anon, authenticated;
grant all privileges on all routines in schema public to anon, authenticated;

-- Auch zukuenftige Objekte im public-Schema automatisch freigeben
alter default privileges in schema public
  grant all on tables to anon, authenticated;
alter default privileges in schema public
  grant all on sequences to anon, authenticated;
alter default privileges in schema public
  grant all on routines to anon, authenticated;

-- RLS auf allen public-Tabellen deaktivieren
do $$
declare
  rec record;
begin
  for rec in
    select schemaname, tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table %I.%I disable row level security', rec.schemaname, rec.tablename);
  end loop;
end
$$;

commit;

-- Optionaler Check:
-- select schemaname, tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
-- order by tablename;
