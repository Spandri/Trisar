-- Push: "Kolonnenfahrt" nur, wenn die Fahrt wirklich eine Kolonne ist.
--
-- Jede Fahrt hat mindestens eine Zeile in convoy_assignments (auch die normale mit einem Fahrer),
-- und die Apps nehmen dort an (response_status). Der Ausloeser auf convoy_assignments schrieb
-- deshalb auch bei normalen Fahrten "Kolonnenfahrt angenommen" an die Dispo.
-- Kolonne = mehr als ein Fahrer an der Fahrt. Sonst heisst es "Fahrt ...".

create or replace function public.push_kolonne_ausloeser()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  j public.jobs;
  d uuid;
  kolonne boolean;
  wort text;
begin
  select * into j from public.jobs where id = coalesce(new.job_id, old.job_id);
  if j.id is null then return coalesce(new, old); end if;

  -- Nach dem Einfuegen zaehlt die neue Zeile mit, nach dem Loeschen fehlt die alte schon.
  kolonne := (select count(distinct ca.driver_id) from public.convoy_assignments ca where ca.job_id = j.id)
             + case when tg_op = 'DELETE' then 1 else 0 end > 1;
  wort := case when kolonne then 'Kolonnenfahrt' else 'Fahrt' end;

  if tg_op = 'INSERT' then
    if new.driver_id is not null and new.driver_id is distinct from j.driver_id then
      perform public.push_melden(new.driver_id, 'fahrer', 'fahrt_neu', 'Neue ' || wort,
        public.push_fahrt_text(j) || '. Bitte annehmen.', jsonb_build_object('ziel', 'fahrt', 'job_id', j.id));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.driver_id is not null and old.driver_id is distinct from j.driver_id
       and coalesce(old.response_status, '') <> 'refused' then
      perform public.push_melden(old.driver_id, 'fahrer', 'fahrt_entzogen', 'Fahrt entzogen',
        public.push_fahrt_text(j) || ' ist dir nicht mehr zugeteilt.', jsonb_build_object('ziel', 'liste'));
    end if;
    return old;
  end if;

  if new.response_status is distinct from old.response_status and new.response_status in ('accepted', 'refused') then
    for d in select public.push_dispo_konten() loop
      perform public.push_melden(d, 'dispo',
        case when new.response_status = 'refused' then 'dispo_abgelehnt' else 'dispo_angenommen' end,
        wort || case when new.response_status = 'refused' then ' abgelehnt' else ' angenommen' end,
        public.push_name(new.driver_id) || ' hat ' || public.push_fahrt_text(j)
          || case when new.response_status = 'refused' then ' abgelehnt' || coalesce(': ' || nullif(trim(new.refusal_reason), ''), '') else ' angenommen' end || '.',
        jsonb_build_object('ziel', 'fahrt', 'job_id', j.id));
    end loop;
  end if;
  return new;
end;
$function$;
