-- Realtime Setup fuer Fahrten-Views (Koordinator/Admin/Fahrer)
-- In Supabase SQL Editor ausfuehren.

begin;

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'jobs',
    'convoy_assignments',
    'job_guests',
    'job_notes',
    'driver_live_locations',
    'messages'
  ]
  loop
    -- Fuer UPDATE/DELETE-Events vollstaendige Datensaetze bereitstellen.
    execute format('alter table public.%I replica identity full', table_name);

    begin
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    exception
      when duplicate_object then
        null;
      when undefined_table then
        null;
    end;
  end loop;
end
$$;

commit;

-- Verifikation:
-- select pubname, schemaname, tablename
-- from pg_publication_tables
-- where pubname = 'supabase_realtime'
--   and schemaname = 'public'
-- order by tablename;
