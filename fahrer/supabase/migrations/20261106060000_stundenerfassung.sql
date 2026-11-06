-- Stundenerfassung: Der Fahrer bekommt nach dem Dienst einen Vorschlag (Beginn, Ende, Pausen aus
-- Dienst und Fahrten), bestaetigt ihn oder passt ihn mit Begruendung an. Die Dispo prueft beim
-- Fahrer und bestaetigt. Export als Excel ueber dispo-admin (stunden_export).

-- 1. Pausen plant die Dispo am Dienst:
--    {"art":"fest","von":"12:00","bis":"12:30"}
--    {"art":"nach_fahrt","job_id":"...","nach_min":0,"dauer_min":180}  (Pause beginnt nach Ende der Fahrt)
-- Eigene Tabelle, weil driver_service_requests einer anderen Rolle gehoert (keine neuen Spalten moeglich).
create table if not exists public.dienst_pausen (
  dienst_id uuid primary key,
  pausen jsonb not null default '[]'::jsonb,
  aktualisiert timestamptz not null default now()
);
alter table public.dienst_pausen enable row level security;
drop policy if exists dienst_pausen_dispo on public.dienst_pausen;
create policy dienst_pausen_dispo on public.dienst_pausen for all using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists dienst_pausen_fahrer on public.dienst_pausen;
create policy dienst_pausen_fahrer on public.dienst_pausen for select
  using (exists (select 1 from public.driver_service_requests d where d.id = dienst_id and d.driver_id = auth.uid()));

-- 2. Jeder Statuswechsel einer Fahrt mit Zeitpunkt, auch die aus den Apps. Bisher protokollierte nur
--    die Status-Automatik (trisar_transition_job_status). Die setzt jetzt eine Markierung, damit ihre
--    eigenen Wechsel nicht doppelt eingetragen werden.
create or replace function public.trisar_transition_job_status(p_job_id uuid, p_next_status text, p_source text default 'db_engine'::text, p_meta jsonb default '{}'::jsonb)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current text;
begin
  select status into v_current
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    return false;
  end if;

  if public.trisar_norm_status(v_current) = public.trisar_norm_status(p_next_status) then
    return false;
  end if;

  perform set_config('trisar.status_protokolliert', p_job_id::text, true);
  update public.jobs
  set status = p_next_status,
      updated_at = now()
  where id = p_job_id;
  perform set_config('trisar.status_protokolliert', '', true);

  insert into public.job_status_history(job_id, from_status, to_status, source, meta)
  values (p_job_id, v_current, p_next_status, coalesce(p_source, 'db_engine'), coalesce(p_meta, '{}'::jsonb));

  return true;
end;
$function$;

create or replace function public.jobs_status_protokoll()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('trisar.status_protokolliert', true), '') <> new.id::text then
    insert into public.job_status_history(job_id, from_status, to_status, source, meta)
    values (new.id, old.status, new.status, 'app', jsonb_build_object('driver_id', new.driver_id));
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_status_protokoll on public.jobs;
create trigger jobs_status_protokoll after update of status on public.jobs
  for each row execute function public.jobs_status_protokoll();

-- 3. Stundenzettel je Dienst.
create table if not exists public.stundenzettel (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  -- Dienst (driver_service_requests.id), ohne Fremdschluessel: die Tabelle gehoert einer anderen Rolle.
  dienst_id uuid,
  datum date not null,
  beginn timestamptz not null,
  ende timestamptz not null,
  -- [{"von": timestamptz, "bis": timestamptz}]
  pausen jsonb not null default '[]'::jsonb,
  pause_min integer not null default 0,
  arbeits_min integer not null default 0,
  -- Vorschlag des Systems zum Zeitpunkt der Erfassung, fuer den Vergleich in der Dispo.
  vorschlag jsonb,
  angepasst boolean not null default false,
  begruendung text,
  status text not null default 'eingereicht' check (status in ('eingereicht', 'bestaetigt', 'zurueckgewiesen')),
  dispo_notiz text,
  geprueft_von uuid references public.profiles(id) on delete set null,
  geprueft_am timestamptz,
  eingereicht_am timestamptz not null default now(),
  aktualisiert timestamptz not null default now(),
  check (ende > beginn)
);
create unique index if not exists stundenzettel_dienst_idx on public.stundenzettel(dienst_id) where dienst_id is not null;
create index if not exists stundenzettel_fahrer_datum_idx on public.stundenzettel(driver_id, datum);

alter table public.stundenzettel enable row level security;
drop policy if exists stundenzettel_dispo on public.stundenzettel;
create policy stundenzettel_dispo on public.stundenzettel for all using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists stundenzettel_fahrer_lesen on public.stundenzettel;
create policy stundenzettel_fahrer_lesen on public.stundenzettel for select using (driver_id = auth.uid());
-- Fahrer reicht ein und darf aendern, solange die Dispo noch nicht bestaetigt hat.
drop policy if exists stundenzettel_fahrer_einreichen on public.stundenzettel;
create policy stundenzettel_fahrer_einreichen on public.stundenzettel for insert
  with check (driver_id = auth.uid() and status = 'eingereicht');
drop policy if exists stundenzettel_fahrer_aendern on public.stundenzettel;
create policy stundenzettel_fahrer_aendern on public.stundenzettel for update
  using (driver_id = auth.uid() and status <> 'bestaetigt')
  with check (driver_id = auth.uid() and status = 'eingereicht');

-- 4. Zeitpunkt aus Datum + Uhrzeit in Deutschland.
create or replace function public.stunden_zeitpunkt(p_datum date, p_zeit time)
returns timestamptz language sql immutable as $$
  select case when p_datum is null or p_zeit is null then null
              else (p_datum + p_zeit) at time zone 'Europe/Berlin' end;
$$;

-- 5. Vorschlag fuer einen Dienst.
-- Beginn: Dienstbeginn oder Anfahrt zur ersten Fahrt, falls frueher.
-- Ende: letzte erledigte Fahrt oder Dienstende, falls spaeter.
-- Fahrtzeiten: erster/letzter Ortungspunkt der Fahrt, sonst Statuswechsel, sonst Plan.
-- Pausen: wie am Dienst geplant (fest oder nach einer Fahrt).
-- Ohne Zugriffspruefung, nur fuer den Server (dispo-admin) und die Funktionen unten.
create or replace function public.stunden_vorschlag_server(p_dienst_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d record;
  dienst_beginn timestamptz;
  dienst_ende timestamptz;
  fahrten jsonb := '[]'::jsonb;
  f record;
  f_start timestamptz;
  f_ende timestamptz;
  f_genau boolean;
  erster timestamptz;
  letzter timestamptz;
  beginn timestamptz;
  ende timestamptz;
  p jsonb;
  pausen jsonb := '[]'::jsonb;
  p_von timestamptz;
  p_bis timestamptz;
  pause_min integer := 0;
  ende_je_fahrt jsonb := '{}'::jsonb;
begin
  select * into d from public.driver_service_requests where id = p_dienst_id;
  if not found then return null; end if;

  dienst_beginn := public.stunden_zeitpunkt(d.service_date, d.service_start_time);
  dienst_ende := public.stunden_zeitpunkt(d.service_date, d.service_end_time);
  if dienst_ende is not null and dienst_beginn is not null and dienst_ende <= dienst_beginn then
    dienst_ende := dienst_ende + interval '1 day';  -- Nachtdienst
  end if;

  for f in
    select j.* from public.jobs j
    where j.driver_id = d.driver_id
      and j.ride_date = d.service_date
      and lower(coalesce(j.status, '')) not in ('cancelled', 'canceled', 'refused', 'storniert', 'stoniert')
    order by j.etd nulls last
  loop
    f_genau := true;
    select min(h.captured_at) into f_start from public.driver_location_history h where h.job_id = f.id;
    if f_start is null then
      select min(s.created_at) into f_start from public.job_status_history s
      where s.job_id = f.id and lower(s.to_status) in ('at_pickup', 'pickup', 'beim_pickup', 'in_progress', 'unterwegs', 'started', 'on_trip', 'ongoing', 'active');
    end if;
    if f_start is null then
      f_genau := false;
      f_start := public.stunden_zeitpunkt(f.ride_date, f.etd) - make_interval(mins => coalesce(f.ext_driver_to_pickup_duration_mins, 0));
    end if;

    select min(s.created_at) into f_ende from public.job_status_history s
    where s.job_id = f.id and lower(s.to_status) in ('done', 'completed', 'arrived', 'beendet');
    if f_ende is null then
      select max(h.captured_at) into f_ende from public.driver_location_history h where h.job_id = f.id;
    end if;
    if f_ende is null or f_ende <= f_start then
      f_genau := false;
      f_ende := public.stunden_zeitpunkt(f.ride_date, f.etd) + make_interval(mins => coalesce(f.ext_route_duration_mins, 30));
    end if;

    if f_start is not null then
      erster := least(coalesce(erster, f_start), f_start);
      letzter := greatest(coalesce(letzter, f_ende), f_ende);
    end if;
    ende_je_fahrt := ende_je_fahrt || jsonb_build_object(f.id::text, f_ende);
    fahrten := fahrten || jsonb_build_object(
      'id', f.id, 'zeit', to_char(f.etd, 'HH24:MI'),
      'gaeste', coalesce(array_to_string(f.passengers, ', '), ''),
      'von', coalesce(f.pickup_name, f.pickup_address), 'nach', coalesce(f.dropoff_name, f.dropoff_address),
      'start', f_start, 'ende', f_ende, 'genau', f_genau, 'status', f.status);
  end loop;

  beginn := least(dienst_beginn, erster);
  ende := greatest(dienst_ende, letzter);
  if beginn is null then beginn := coalesce(dienst_beginn, erster); end if;
  if ende is null then ende := coalesce(dienst_ende, letzter); end if;

  for p in select * from jsonb_array_elements(coalesce((select dp.pausen from public.dienst_pausen dp where dp.dienst_id = d.id), '[]'::jsonb))
  loop
    p_von := null; p_bis := null;
    if p->>'art' = 'fest' then
      p_von := public.stunden_zeitpunkt(d.service_date, (p->>'von')::time);
      p_bis := public.stunden_zeitpunkt(d.service_date, (p->>'bis')::time);
      if p_bis <= p_von then p_bis := p_bis + interval '1 day'; end if;
    elsif p->>'art' = 'nach_fahrt' and ende_je_fahrt ? (p->>'job_id') then
      p_von := (ende_je_fahrt->>(p->>'job_id'))::timestamptz + make_interval(mins => coalesce((p->>'nach_min')::int, 0));
      p_bis := p_von + make_interval(mins => coalesce((p->>'dauer_min')::int, 0));
    end if;
    if p_von is not null and p_bis is not null and beginn is not null then
      -- Nur der Teil innerhalb der Arbeitszeit zaehlt.
      p_von := greatest(p_von, beginn);
      p_bis := least(p_bis, ende);
      if p_bis > p_von then
        pausen := pausen || jsonb_build_object('von', p_von, 'bis', p_bis, 'art', p->>'art');
        pause_min := pause_min + round(extract(epoch from (p_bis - p_von)) / 60)::int;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'dienst_id', d.id,
    'datum', d.service_date,
    'dienst_beginn', dienst_beginn,
    'dienst_ende', dienst_ende,
    'beginn', beginn,
    'ende', ende,
    'pausen', pausen,
    'pause_min', pause_min,
    'arbeits_min', case when beginn is null or ende is null then 0
                        else greatest(0, round(extract(epoch from (ende - beginn)) / 60)::int - pause_min) end,
    'fahrten', fahrten
  );
end;
$$;

revoke all on function public.stunden_vorschlag_server(uuid) from public, anon, authenticated;
grant execute on function public.stunden_vorschlag_server(uuid) to service_role;

-- Fuer Apps: nur der eigene Dienst bzw. als Dispo jeder.
create or replace function public.stunden_vorschlag(p_dienst_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.driver_service_requests d where d.id = p_dienst_id
                 and (d.driver_id = auth.uid() or public.ist_dispo())) then
    raise exception 'kein Zugriff';
  end if;
  return public.stunden_vorschlag_server(p_dienst_id);
end;
$$;

-- 6. Verlauf: vergangene Dienste eines Fahrers mit Fahrten und Stundenzettel.
create or replace function public.stunden_verlauf(p_driver uuid default null, p_tage integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  fahrer uuid := coalesce(p_driver, auth.uid());
  ergebnis jsonb := '[]'::jsonb;
  d record;
  z record;
begin
  if fahrer <> auth.uid() and not public.ist_dispo() then
    raise exception 'kein Zugriff';
  end if;
  for d in
    select * from public.driver_service_requests
    where driver_id = fahrer
      and lower(coalesce(status, '')) in ('accepted', 'assigned', 'approved')
      and service_date <= current_date
      and service_date >= current_date - p_tage
    order by service_date desc, service_start_time desc
  loop
    select * into z from public.stundenzettel where dienst_id = d.id;
    ergebnis := ergebnis || jsonb_build_object(
      'dienst', jsonb_build_object('id', d.id, 'datum', d.service_date,
        'beginn', to_char(d.service_start_time, 'HH24:MI'), 'ende', to_char(d.service_end_time, 'HH24:MI'),
        'pausen', coalesce((select dp.pausen from public.dienst_pausen dp where dp.dienst_id = d.id), '[]'::jsonb)),
      'vorschlag', public.stunden_vorschlag_server(d.id),
      'zettel', case when z.id is null then null else to_jsonb(z) end,
      -- Erfassen erst, wenn der Dienst vorbei ist.
      'vorbei', coalesce(public.stunden_zeitpunkt(d.service_date, d.service_end_time) +
                  case when d.service_end_time <= d.service_start_time then interval '1 day' else interval '0' end, now()) <= now()
    );
  end loop;
  return ergebnis;
end;
$$;

grant execute on function public.stunden_vorschlag(uuid) to authenticated;
grant execute on function public.stunden_verlauf(uuid, integer) to authenticated;

-- 7. Mitteilungen: Dispo bei Einreichung, Fahrer bei Pruefung.
create or replace function public.push_stunden_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k uuid;
  tag text := to_char(new.datum, 'DD.MM.');
begin
  if new.status = 'eingereicht' and (tg_op = 'INSERT' or old.status is distinct from 'eingereicht' or old.beginn <> new.beginn or old.ende <> new.ende) then
    for k in select public.push_dispo_konten() loop
      perform public.push_melden(k, 'dispo', 'dispo_stunden', 'Stunden eingereicht',
        coalesce(public.push_name(new.driver_id), 'Fahrer') || ', ' || tag || ': '
          || to_char(make_interval(mins => new.arbeits_min), 'HH24:MI') || ' h'
          || case when new.angepasst then ' (angepasst)' else '' end,
        jsonb_build_object('ziel', 'fahrer', 'driver_id', new.driver_id));
    end loop;
  elsif tg_op = 'UPDATE' and new.status in ('bestaetigt', 'zurueckgewiesen') and old.status is distinct from new.status then
    perform public.push_melden(new.driver_id, 'fahrer', 'fahrer_stunden',
      case when new.status = 'bestaetigt' then 'Stunden bestätigt' else 'Stunden zurückgegeben' end,
      tag || coalesce(': ' || nullif(trim(new.dispo_notiz), ''), ''),
      jsonb_build_object('ziel', 'verlauf'));
  end if;
  return new;
end;
$$;

drop trigger if exists push_stunden on public.stundenzettel;
create trigger push_stunden after insert or update on public.stundenzettel
  for each row execute function public.push_stunden_ausloeser();
