-- "Ankuenfte bei mir", zweite Stufe (17.11.2026):
-- 1. minuten = 0 heisst "sobald unterwegs": Meldung, sobald ein Fahrzeug zu mir unterwegs ist
--    (Restzeit bekannt), egal wie weit weg. Auswahl in den Apps: sobald unterwegs, 1 bis 60 min.
-- 2. automatisch: Die App waehlt den Ort selbst (gespeicherter Ort, an dem ich gerade bin, sonst mein
--    Standort) und schreibt lat/lng nach, solange sie offen ist. Aus = fest gewaehlter Ort.

alter table public.dispo_ankunft_melden drop constraint if exists dispo_ankunft_melden_minuten_check;
alter table public.dispo_ankunft_melden add constraint dispo_ankunft_melden_minuten_check check (minuten between 0 and 60);
alter table public.dispo_ankunft_melden add column if not exists automatisch boolean not null default true;

create or replace function public.push_dispo_ankuenfte()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  r record;
  anzahl int := 0;
  merker text;
  ort text;
  name text;
  fahrt public.jobs;
begin
  for m in
    select d.*, o.name as o_name from public.dispo_ankunft_melden d
    join public.profiles p on p.id = d.user_id
    left join public.orte o on o.id = d.ort_id
    where d.an and d.lat is not null and d.lng is not null
      and lower(coalesce(p.role, '')) <> 'pruefung'
  loop
    ort := coalesce(nullif(btrim(m.ort_name), ''), m.o_name);
    for r in select * from public.ankunft_liste_fuer(m.user_id) loop
      continue when r.driver_id is null;
      select * into fahrt from public.jobs where id = r.job_id;
      name := public.push_name(r.driver_id);
      if r.angekommen then
        continue when not m.bei_ankunft;
        -- Schon laenger beendete Fahrten nicht nachmelden (z. B. direkt nach dem Einschalten)
        continue when public.trisar_norm_status(fahrt.status) in ('done', 'completed', 'arrived', 'beendet')
          and not exists (select 1 from public.job_status_history h
                          where h.job_id = r.job_id and h.created_at > now() - interval '5 minutes'
                            and public.trisar_norm_status(h.to_status) in ('done', 'completed', 'arrived', 'beendet'));
        merker := 'ankunft_da:' || m.user_id || ':' || r.job_id || ':' || r.art;
        continue when exists (select 1 from public.push_erinnert e where e.schluessel = merker);
        insert into public.push_erinnert (schluessel) values (merker);
        perform public.push_melden(m.user_id, 'dispo', 'dispo_ankunft',
          case when r.art = 'ziel' then 'Angekommen' else 'Zum Abholen da' end,
          name || case when r.art = 'ziel' then ' ist angekommen' else ' ist zum Abholen da' end
            || coalesce(' (' || ort || ')', '') || '. ' || public.push_fahrt_text(fahrt) || '.',
          jsonb_build_object('ziel', 'fahrt', 'job_id', r.job_id, 'driver_id', r.driver_id));
        anzahl := anzahl + 1;
      elsif r.rest_min is not null and (m.minuten = 0 or r.rest_min <= m.minuten) then
        merker := 'ankunft_bald:' || m.user_id || ':' || r.job_id || ':' || r.art;
        continue when exists (select 1 from public.push_erinnert e where e.schluessel = merker);
        insert into public.push_erinnert (schluessel) values (merker);
        perform public.push_melden(m.user_id, 'dispo', 'dispo_ankunft',
          case when m.minuten = 0 then 'Unterwegs zu dir'
               when r.art = 'ziel' then 'Gleich da' else 'Kommt zum Abholen' end,
          name || ' in ' || case when r.geschaetzt then 'ca. ' else '' end || greatest(1, r.rest_min) || ' min bei dir'
            || coalesce(' (' || ort || ')', '') || '. ' || public.push_fahrt_text(fahrt) || '.',
          jsonb_build_object('ziel', 'fahrt', 'job_id', r.job_id, 'driver_id', r.driver_id));
        anzahl := anzahl + 1;
      end if;
    end loop;
  end loop;
  return anzahl;
end;
$$;

revoke all on function public.push_dispo_ankuenfte() from public, anon, authenticated;
grant execute on function public.push_dispo_ankuenfte() to service_role;
