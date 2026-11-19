-- Danach Dienstende (19.11.2026).
--
-- Wunsch: Beim Fahrt erstellen und bearbeiten kann die Dispo "Danach: Dienstende" waehlen. Dann endet
-- der Dienst des Fahrers direkt nach dieser Fahrt, mit der Uhrzeit, zu der die Fahrt endet.
-- Entscheidungen 19.11.:
--   * Uhrzeit: erst die geplante Ankunft (ride_date + etd, Europe/Berlin, plus Fahrzeit der Route),
--     nach "Erledigt" die echte Ankunft (jobs.ankunft_echt). Keine Live-ETA.
--   * Verschiebt sich die Fahrt (Zeit, Route, Fahrer, Konvoi), zieht das Dienstende mit. Faellt das
--     Feld weg oder wird die Fahrt storniert, gilt wieder das Dienstende von vorher.
--   * Gilt direkt: nur service_end_time des vorhandenen Dienstes (nicht abgelehnt, Tag der Fahrt oder
--     Vortag bei Nachtdienst) wird gesetzt, der Status bleibt. Ohne Dienst passiert nichts, bis einer
--     da ist (z. B. der automatische Dienststart, trg_jobs_dienststart laeuft vorher).
--   * Aendert jemand das Dienstende danach selbst (Dienste planen, KI), gilt seins, die Fahrt laesst
--     den Dienst ab da in Ruhe.
--   * Push "Dienst geändert" nur beim Planwert, nicht beim Nachziehen auf die echte Ankunft.
-- Trigger auf jobs, convoy_assignments und driver_service_requests, gilt fuer alle Apps, KI und Import.

alter table public.jobs add column if not exists danach_dienstende boolean not null default false;

-- Welche Fahrt welches Dienstende gesetzt hat und was vorher galt.
create table if not exists public.dienstende_fahrt (
  job_id uuid not null references public.jobs(id) on delete cascade,
  driver_id uuid not null,
  dienst_id uuid,
  ende_vorher time without time zone,
  ende_gesetzt time without time zone,
  aktualisiert timestamptz not null default now(),
  primary key (job_id, driver_id)
);
alter table public.dienstende_fahrt enable row level security;
drop policy if exists dienstende_fahrt_dispo on public.dienstende_fahrt;
create policy dienstende_fahrt_dispo on public.dienstende_fahrt for select to authenticated
  using (public.ist_dispo() or driver_id = auth.uid());
grant select on public.dienstende_fahrt to authenticated;

-- Ende der Fahrt: echte Ankunft, sonst Plan (Start + Fahrzeit). Null, solange keine Fahrzeit bekannt ist.
create or replace function public.trisar_fahrt_ende(p_job public.jobs)
returns timestamptz
language sql stable
as $$
  select coalesce(
    p_job.ankunft_echt,
    case when p_job.ride_date is not null and coalesce(p_job.etd, p_job.original_etd) is not null
              and coalesce(p_job.ext_route_duration_in_traffic_mins, p_job.ext_route_duration_mins) is not null
      then ((p_job.ride_date + coalesce(p_job.etd, p_job.original_etd)) at time zone 'Europe/Berlin')
           + make_interval(mins => coalesce(p_job.ext_route_duration_in_traffic_mins, p_job.ext_route_duration_mins)::int)
    end);
$$;

-- Dienstende fuer eine Fahrt setzen, nachziehen oder zuruecknehmen.
create or replace function public.trisar_dienstende_fahrt_anwenden(p_job_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  j public.jobs%rowtype;
  v_weg constant text[] := array['cancelled', 'canceled', 'refused', 'storniert', 'stoniert'];
  v_aktiv boolean;
  v_ende timestamptz;
  v_zeit time;
  v_echt boolean;
  v_fahrer uuid[];
  f uuid;
  v_hat boolean;
  l record;
  d record;
begin
  select * into j from public.jobs where id = p_job_id;
  v_aktiv := found and coalesce(j.danach_dienstende, false)
             and public.trisar_norm_status(j.status) <> all (v_weg);
  if v_aktiv then
    v_ende := public.trisar_fahrt_ende(j);
    v_echt := j.ankunft_echt is not null;
    select array_agg(distinct x) into v_fahrer from (
      select j.driver_id as x where j.driver_id is not null
      union
      select ca.driver_id from public.convoy_assignments ca
       where ca.job_id = j.id and ca.driver_id is not null
         and lower(coalesce(ca.response_status, '')) not in ('refused', 'declined', 'abgelehnt')
    ) q;
  end if;
  v_fahrer := coalesce(v_fahrer, '{}'::uuid[]);
  if v_ende is not null then
    v_zeit := date_trunc('minute', v_ende at time zone 'Europe/Berlin')::time;
  end if;

  -- 1) Nicht mehr gueltige Verknuepfungen zuruecknehmen (Feld aus, storniert, Fahrer weg).
  for l in select * from public.dienstende_fahrt where job_id = p_job_id loop
    if not v_aktiv or not (l.driver_id = any (v_fahrer)) then
      -- Nur zuruecksetzen, wenn das Ende noch das von der Fahrt gesetzte ist.
      update public.driver_service_requests
         set service_end_time = l.ende_vorher
       where id = l.dienst_id and service_end_time is not distinct from l.ende_gesetzt;
      delete from public.dienstende_fahrt where job_id = l.job_id and driver_id = l.driver_id;
    end if;
  end loop;

  if not v_aktiv or v_zeit is null then
    return;
  end if;

  -- 2) Je Fahrer das Ende setzen oder nachziehen.
  foreach f in array v_fahrer loop
    select * into l from public.dienstende_fahrt where job_id = p_job_id and driver_id = f;
    v_hat := found;
    if v_hat then
      select * into d from public.driver_service_requests where id = l.dienst_id;
      if not found or lower(coalesce(d.status, '')) = 'refused' then
        delete from public.dienstende_fahrt where job_id = p_job_id and driver_id = f;
        v_hat := false;
      elsif d.service_end_time is distinct from l.ende_gesetzt then
        -- Jemand hat das Dienstende selbst geaendert: seins gilt.
        continue;
      end if;
    end if;

    if not v_hat then
      select * into d from public.driver_service_requests s
       where s.driver_id = f and lower(coalesce(s.status, '')) <> 'refused'
         and s.service_date in (j.ride_date, j.ride_date - 1)
       order by s.service_date desc, s.created_at desc
       limit 1;
      if not found then
        continue;
      end if;
      insert into public.dienstende_fahrt (job_id, driver_id, dienst_id, ende_vorher, ende_gesetzt)
      values (p_job_id, f, d.id, d.service_end_time, v_zeit);
    else
      update public.dienstende_fahrt set ende_gesetzt = v_zeit, aktualisiert = now()
       where job_id = p_job_id and driver_id = f;
    end if;

    if d.service_end_time is distinct from v_zeit then
      if v_echt then
        perform set_config('trisar.dienst_antwort', '1', true);  -- kein Push beim Nachziehen auf echt
      end if;
      update public.driver_service_requests set service_end_time = v_zeit where id = d.id;
      perform set_config('trisar.dienst_antwort', '', true);
      update public.profiles set service_end_time = v_zeit, service_end_date = d.service_date
       where id = f and service_end_date is not distinct from d.service_date;
    end if;
    update public.dienstende_fahrt set ende_gesetzt = v_zeit where job_id = p_job_id and driver_id = f;
  end loop;
end;
$$;
revoke all on function public.trisar_dienstende_fahrt_anwenden(uuid) from public, anon, authenticated;

create or replace function public.trisar_jobs_dienstende()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' and not coalesce(new.danach_dienstende, false) then
    return null;
  end if;
  if tg_op = 'UPDATE' and not coalesce(new.danach_dienstende, false) and not coalesce(old.danach_dienstende, false) then
    return null;
  end if;
  perform public.trisar_dienstende_fahrt_anwenden(new.id);
  return null;
exception when others then
  -- Eine Fahrt darf nie am Dienstende scheitern.
  raise warning 'danach_dienstende %: %', new.id, sqlerrm;
  return null;
end;
$$;

-- Name mit z: laeuft nach trg_jobs_dienststart (Dienst ist dann schon angelegt).
drop trigger if exists trg_jobs_z_danach_dienstende on public.jobs;
create trigger trg_jobs_z_danach_dienstende
  after insert or update of danach_dienstende, driver_id, ride_date, etd, original_etd, status,
    ext_route_duration_mins, ext_route_duration_in_traffic_mins, ankunft_echt
  on public.jobs
  for each row execute function public.trisar_jobs_dienstende();

-- Konvoi: Fahrer kommen dazu oder fallen weg.
create or replace function public.trisar_konvoi_dienstende()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_job uuid := coalesce(new.job_id, old.job_id);
begin
  if exists (select 1 from public.jobs where id = v_job and danach_dienstende)
     or exists (select 1 from public.dienstende_fahrt where job_id = v_job) then
    perform public.trisar_dienstende_fahrt_anwenden(v_job);
  end if;
  return null;
exception when others then
  raise warning 'danach_dienstende konvoi %: %', v_job, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_konvoi_danach_dienstende on public.convoy_assignments;
create trigger trg_konvoi_danach_dienstende
  after insert or update of driver_id, response_status or delete on public.convoy_assignments
  for each row execute function public.trisar_konvoi_dienstende();

-- Neuer Dienst (Dienste planen ersetzt die Zeile, trisar_dienst_ein_pro_tag): Verknuepfung umhaengen.
-- Bringt die neue Zeile ein anderes Ende mit, hat die Dispo es bewusst geaendert, dann gilt ihres.
create or replace function public.trisar_dienst_neu_dienstende()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  l record;
begin
  if lower(coalesce(new.status, '')) = 'refused' then
    return null;
  end if;
  for l in
    select df.* from public.dienstende_fahrt df
      join public.jobs j on j.id = df.job_id
     where df.driver_id = new.driver_id
       and new.service_date in (j.ride_date, j.ride_date - 1)
       and (df.dienst_id is null or not exists (select 1 from public.driver_service_requests s where s.id = df.dienst_id))
  loop
    if new.service_end_time is null or new.service_end_time = l.ende_gesetzt then
      update public.dienstende_fahrt set dienst_id = new.id, aktualisiert = now()
       where job_id = l.job_id and driver_id = l.driver_id;
      if new.service_end_time is null then
        update public.driver_service_requests set service_end_time = l.ende_gesetzt where id = new.id;
      end if;
    else
      delete from public.dienstende_fahrt where job_id = l.job_id and driver_id = l.driver_id;
    end if;
  end loop;
  -- Fahrten mit "Danach Dienstende", die noch keinen Dienst hatten.
  for l in
    select j.id from public.jobs j
     where j.danach_dienstende
       and (j.driver_id = new.driver_id
            or exists (select 1 from public.convoy_assignments ca where ca.job_id = j.id and ca.driver_id = new.driver_id))
       and new.service_date in (j.ride_date, j.ride_date - 1)
       and not exists (select 1 from public.dienstende_fahrt df where df.job_id = j.id and df.driver_id = new.driver_id)
  loop
    perform public.trisar_dienstende_fahrt_anwenden(l.id);
  end loop;
  return null;
exception when others then
  raise warning 'danach_dienstende dienst %: %', new.id, sqlerrm;
  return null;
end;
$$;

-- Name mit z: laeuft nach trg_dienst_ein_pro_tag_nachher (alte Zeile ist dann geloescht).
drop trigger if exists trg_dienst_z_danach_dienstende on public.driver_service_requests;
create trigger trg_dienst_z_danach_dienstende
  after insert on public.driver_service_requests
  for each row execute function public.trisar_dienst_neu_dienstende();

notify pgrst, 'reload schema';
