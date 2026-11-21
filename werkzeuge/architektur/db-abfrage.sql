-- Liest Struktur und Logik der DB als ein JSON (nur lesend).
select json_build_object(
  'stand', now(),
  'tabellen', (select json_agg(json_build_object(
      'name', c.relname,
      'art', case c.relkind when 'r' then 'tabelle' when 'v' then 'view' when 'm' then 'mview' when 'p' then 'tabelle' end,
      'zeilen_ca', greatest(c.reltuples::bigint, 0),
      'rls', c.relrowsecurity,
      'spalten', (select json_agg(json_build_object('name', a.attname, 'typ', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
                  from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
      'kommentar', obj_description(c.oid)
    ) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','v','m','p')),
  'fremdschluessel', (select json_agg(json_build_object(
      'von', cl.relname, 'spalten', (select json_agg(attname) from pg_attribute where attrelid = co.conrelid and attnum = any(co.conkey)),
      'nach', cf.relname, 'loeschen', co.confdeltype))
    from pg_constraint co join pg_class cl on cl.oid = co.conrelid join pg_class cf on cf.oid = co.confrelid
    join pg_namespace n on n.oid = cl.relnamespace where co.contype = 'f' and n.nspname = 'public'),
  'trigger', (select json_agg(json_build_object(
      'name', t.tgname, 'tabelle', c.relname, 'aktiv', t.tgenabled <> 'D',
      'definition', pg_get_triggerdef(t.oid), 'funktion', p.proname) order by c.relname, t.tgname)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid where not t.tgisinternal and n.nspname = 'public'),
  'funktionen', (select json_agg(json_build_object(
      'name', p.proname, 'argumente', pg_get_function_identity_arguments(p.oid),
      'rueckgabe', pg_get_function_result(p.oid), 'sprache', l.lanname,
      'security_definer', p.prosecdef, 'quelltext', p.prosrc,
      'kommentar', obj_description(p.oid),
      'ausfuehrbar_fuer', (select json_agg(r.rolname) from pg_roles r where r.rolname in ('anon','authenticated','service_role') and has_function_privilege(r.oid, p.oid, 'execute'))
    ) order by p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_language l on l.oid = p.prolang
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'views', (select json_agg(json_build_object('name', viewname, 'definition', definition)) from pg_views where schemaname = 'public'),
  'realtime', (select json_agg(tablename) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'),
  'status_uebergaenge', (select json_agg(json_build_object('von', lower(coalesce(from_status, '')), 'nach', lower(to_status), 'quelle', source, 'anzahl', n, 'zuletzt', zuletzt))
    from (select from_status, to_status, source, count(*) n, max(created_at) zuletzt from public.job_status_history group by 1, 2, 3) x),
  'status_bestand', (select json_object_agg(s, n) from (select lower(coalesce(status, '')) s, count(*) n from public.jobs group by 1) x),
  'status_einstellungen', (select json_object_agg(key, value) from public.integration_settings where key like 'status%'),
  'orte_radien', (select json_build_object(
      'standard', (select json_build_object('rein', radius_rein_m, 'raus', radius_raus_m) from public.orte_standard limit 1),
      'orte', (select json_agg(json_build_object('name', name, 'rein', radius_rein_m, 'raus', radius_raus_m) order by name) from public.orte))),
  'policies', (select json_agg(json_build_object('tabelle', tablename, 'name', policyname, 'befehl', cmd, 'rollen', roles, 'bedingung', qual, 'pruefung', with_check))
    from pg_policies where schemaname = 'public')
);
