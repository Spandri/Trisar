-- Fahrt ohne Start: Abholort ist der Standort des Fahrers.
--
-- Wunsch 10.11.: Eine Fahrt muss auch ohne Start angelegt werden koennen (nur Ziel). Dann gilt
-- der Standort des Fahrers als Start.
--
-- Regeln:
--   * Leere Abholadresse beim Anlegen oder Bearbeiten setzt jobs.start_fahrerstandort.
--     pickup_name wird "Standort Fahrer", pickup_address bleibt leer, bis ein Standort da ist.
--   * Der Standort wird eingetragen, sobald die Fahrt dran ist (trisar_fahrt_ist_dran: keine andere
--     laufende Fahrt, Planzeit innerhalb status_vorlauf_min) und eine Live-Position des Fahrers
--     hoechstens 15 min alt ist. Vorher waere der Standort veraltet (Fahrt am Nachmittag, Zuweisung
--     morgens). Danach bleibt er fest, damit nicht jede Bewegung eine neue TomTom-Route ausloest.
--   * pickup_address wird "lat, lng". TomTom (_shared/tomtom-routing.ts, koordinatenAusText) nimmt
--     das direkt, trg_jobs_route_anstossen berechnet daraus die Route, die Status-Engine arbeitet
--     dann wie gewohnt (Fahrer steht am Start -> beim Gast, faehrt los -> unterwegs).
--   * Fahrerwechsel leert den eingetragenen Standort wieder, der neue Fahrer liefert ihn neu.
--   * Wer spaeter eine echte Startadresse eintraegt, schaltet die Regel fuer diese Fahrt ab.
--
-- Der BEFORE-Trigger heisst trg_jobs_a_..., damit er vor trg_jobs_ort_zuordnen laeuft (alphabetisch).

alter table public.jobs
  add column if not exists start_fahrerstandort boolean not null default false;

comment on column public.jobs.start_fahrerstandort is
  'Fahrt ohne Start: Abholort = Live-Standort des Fahrers, eingetragen sobald die Fahrt dran ist';

create or replace function public.trisar_ist_koordinatentext(p_text text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_text ~ '^\s*-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+\s*$', false)
$$;

-- Liefert "lat, lng" der frischen Live-Position, wenn die Fahrt dran ist, sonst null.
create or replace function public.trisar_fahrerstandort_text(p_job public.jobs)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_lat double precision;
  v_lng double precision;
begin
  if p_job.driver_id is null then
    return null;
  end if;
  if public.trisar_norm_status(p_job.status) not in (
       'pending', 'assigned', 'offen', 'new', 'requested', 'offered', 'zugewiesen') then
    return null;
  end if;
  if not public.trisar_fahrt_ist_dran(p_job) then
    return null;
  end if;
  select l.lat, l.lng into v_lat, v_lng
    from public.driver_live_locations l
   where l.driver_id = p_job.driver_id
     and coalesce(l.captured_at, l.updated_at) > now() - interval '15 minutes'
   order by coalesce(l.captured_at, l.updated_at) desc
   limit 1;
  if v_lat is null or v_lng is null then
    return null;
  end if;
  return to_char(v_lat, 'FM990.000000') || ', ' || to_char(v_lng, 'FM9990.000000');
end;
$$;

create or replace function public.trisar_jobs_start_fahrerstandort()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_text text;
begin
  -- Editoren zeigen bei solchen Fahrten "Standort Fahrer" im Startfeld und speichern das zurueck.
  if lower(btrim(coalesce(new.pickup_address, ''))) = 'standort fahrer' then
    new.pickup_address := case when tg_op = 'UPDATE' and old.start_fahrerstandort then old.pickup_address else '' end;
  end if;

  if coalesce(btrim(new.pickup_address), '') = '' then
    new.start_fahrerstandort := true;
  elsif tg_op = 'UPDATE'
        and old.start_fahrerstandort
        and new.pickup_address is distinct from old.pickup_address
        and not public.trisar_ist_koordinatentext(new.pickup_address) then
    -- Echte Adresse eingetragen: ab jetzt normale Fahrt.
    new.start_fahrerstandort := false;
  end if;

  if not new.start_fahrerstandort then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.driver_id is distinct from old.driver_id then
    new.pickup_address := '';
  end if;

  new.pickup_name := 'Standort Fahrer';
  new.pickup_ort_id := null;

  if coalesce(btrim(new.pickup_address), '') = '' then
    new.pickup_address := '';
    v_text := public.trisar_fahrerstandort_text(new);
    if v_text is not null then
      new.pickup_address := v_text;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_a_start_fahrerstandort on public.jobs;
create trigger trg_jobs_a_start_fahrerstandort
  before insert or update of pickup_address, driver_id, status, ride_date, etd, start_fahrerstandort on public.jobs
  for each row execute function public.trisar_jobs_start_fahrerstandort();

-- Jede Live-Position: offene Fahrten dieses Fahrers ohne Standort nachtragen.
create or replace function public.trisar_live_start_fahrerstandort()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_job public.jobs%rowtype;
  v_text text;
begin
  for v_job in
    select * from public.jobs j
     where j.driver_id = new.driver_id
       and j.start_fahrerstandort
       and coalesce(btrim(j.pickup_address), '') = ''
  loop
    v_text := public.trisar_fahrerstandort_text(v_job);
    if v_text is not null then
      update public.jobs set pickup_address = v_text where id = v_job.id;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists trg_driver_live_start_fahrerstandort on public.driver_live_locations;
create trigger trg_driver_live_start_fahrerstandort
  after insert or update of lat, lng, captured_at on public.driver_live_locations
  for each row execute function public.trisar_live_start_fahrerstandort();
