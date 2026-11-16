-- Dienststart automatisch vor der ersten Fahrt (15.11.2026).
--
-- Pilotkunde: Die Dispo schickt den Dienststart heute von Hand. Bekommt ein Fahrer eine Fahrt und ist
-- das die erste Fahrt seines Dienstes, geht jetzt automatisch eine Dienstanfrage mit, Vorlauf
-- einstellbar im Karten Filter (dispo_einstellungen 'dienststart_vorlauf_min'). Standard 60 min (Wunsch
-- 15.11.), "Aus" im Filter speichert wert = null (Zeile bleibt, damit Aus nicht wieder zum Standard wird).
-- Trigger auf jobs, gilt fuer Web, iOS, Android und den KI-Assistenten.
--
-- Fahrtzeit T (ride_date + etd, Europe/Berlin), Vorlauf V, Dienststart S = T - V. Der Tag von S kann
-- der Vortag sein (Fahrt 16.11. 00:15, V 30 -> Dienst am 15.11. ab 23:45).
-- Spanne eines Dienstes: Start bis Ende, Ende <= Start = Folgetag. Ohne Ende 16 h ab Start.
--   1. Aus, ohne Fahrer, ohne etd, nicht aktiv oder T vorbei -> nichts.
--   2. Ein Dienst (nicht abgelehnt) deckt T -> nichts. Ist es ein automatischer Dienst am Tag von S,
--      der nach S beginnt, wird er auf S vorgezogen.
--   3. Letzter Dienst vor T liegt am Tag von S (nur ein Dienst je Tag) oder endete weniger als 3 h
--      vor T -> nichts. Hatte er ein gesetztes Dienstende, bekommt die Dispo "Dienst prüfen".
--   4. Dienst am Tag von S beginnt erst nach T -> Dienststart auf S vorziehen (Fahrer bestaetigt).
--   5. Abgelehnter Dienst am Tag von S -> nichts erneut schicken.
--   6. Sonst neuer Dienst am Tag von S, Start S, ohne Ende, offen, requested_by 'automatisch'.
-- Faellt eine Fahrt weg (anderer Fahrer, storniert, Zeit geaendert), wird ein automatischer Dienst,
-- den der Fahrer noch nicht bestaetigt hat, neu berechnet oder zurueckgezogen. Bestaetigte Dienste
-- werden nie nach hinten geschoben.

create table if not exists public.dispo_einstellungen (
  schluessel text primary key,
  wert jsonb,
  aktualisiert timestamptz not null default now()
);
alter table public.dispo_einstellungen enable row level security;
drop policy if exists dispo_einstellungen_dispo on public.dispo_einstellungen;
create policy dispo_einstellungen_dispo on public.dispo_einstellungen for all to authenticated
  using (public.ist_dispo()) with check (public.ist_dispo());
grant select, insert, update, delete on public.dispo_einstellungen to authenticated;
insert into public.dispo_einstellungen (schluessel, wert) values ('dienststart_vorlauf_min', '60')
on conflict (schluessel) do nothing;

-- Vorlauf in Minuten, null = aus.
create or replace function public.trisar_dienststart_vorlauf()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when jsonb_typeof(e.wert) = 'number' and (e.wert #>> '{}')::numeric > 0
              then (e.wert #>> '{}')::numeric::integer end
    from public.dispo_einstellungen e where e.schluessel = 'dienststart_vorlauf_min';
$$;
revoke all on function public.trisar_dienststart_vorlauf() from public, anon, authenticated;

-- Dienste eines Fahrers rund um einen Tag mit Spanne (timestamptz).
create or replace function public.trisar_dienst_spannen(p_fahrer uuid, p_von date, p_bis date)
returns table (id uuid, tag date, status text, requested_by text, hat_ende boolean, ende_zeit time,
               von timestamptz, bis timestamptz, geaendert boolean)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.service_date, lower(coalesce(d.status, '')), d.requested_by,
         d.service_end_time is not null, d.service_end_time,
         ((d.service_date + coalesce(d.service_start_time, time '00:00')) at time zone 'Europe/Berlin'),
         case when d.service_end_time is null
              then ((d.service_date + coalesce(d.service_start_time, time '00:00')) at time zone 'Europe/Berlin') + interval '16 hours'
              else ((d.service_date + d.service_end_time
                     + case when d.service_start_time is not null and d.service_end_time <= d.service_start_time
                            then interval '1 day' else interval '0' end) at time zone 'Europe/Berlin') end,
         exists (select 1 from public.dienst_aenderung a where a.dienst_id = d.id)
    from public.driver_service_requests d
   where d.driver_id = p_fahrer and d.service_date between p_von and p_bis;
$$;
revoke all on function public.trisar_dienst_spannen(uuid, date, date) from public, anon, authenticated;

create or replace function public.trisar_fahrt_aktiv(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_status, '')) not in ('done', 'completed', 'cancelled', 'canceled', 'storniert', 'stoniert', 'beendet', 'refused');
$$;

-- Hinweis an alle Dispo-Konten (auch an den, der die Fahrt gerade zuteilt).
create or replace function public.trisar_dienststart_hinweis(p_fahrer uuid, p_t timestamptz, p_ende time)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k uuid;
begin
  for k in select public.push_dispo_konten() loop
    if exists (select 1 from public.push_einstellungen e where e.user_id = k and 'dispo_dienst_pruefen' = any(e.aus)) then
      continue;
    end if;
    insert into public.push_ausgang (user_id, app, art, titel, text, daten)
    values (k, 'dispo', 'dispo_dienst_pruefen', 'Dienst prüfen',
      public.push_name(p_fahrer) || ': Fahrt ' || to_char(p_t at time zone 'Europe/Berlin', 'DD.MM. HH24:MI')
        || ' liegt nach dem Dienstende ' || to_char(p_ende, 'HH24:MI') || '. Bitte Dienst anpassen.',
      jsonb_build_object('ziel', 'fahrer', 'user_id', p_fahrer));
  end loop;
end;
$$;
revoke all on function public.trisar_dienststart_hinweis(uuid, timestamptz, time) from public, anon, authenticated;

-- Dienststart fuer eine Fahrt sicherstellen. Gibt zurueck, was passiert ist (fuer Tests).
create or replace function public.trisar_dienststart_sichern(p_fahrer uuid, p_t timestamptz, p_jetzt timestamptz default now())
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer := public.trisar_dienststart_vorlauf();
  s timestamptz;
  tag_s date;
  zeit_s time;
  d record;
  p record;
  n record;
begin
  if v is null or p_fahrer is null or p_t is null or p_t <= p_jetzt then
    return 'aus';
  end if;
  s := p_t - make_interval(mins => v);
  tag_s := (s at time zone 'Europe/Berlin')::date;
  zeit_s := (s at time zone 'Europe/Berlin')::time;

  -- 2. Ein Dienst deckt die Fahrt.
  select * into d from public.trisar_dienst_spannen(p_fahrer, tag_s - 1, tag_s + 1) x
   where x.status <> 'refused' and x.von <= p_t and p_t <= x.bis
   order by x.von desc limit 1;
  if found then
    if d.requested_by = 'automatisch' and d.tag = tag_s and d.von > s then
      insert into public.driver_service_requests (driver_id, service_date, service_start_time, status, requested_by)
      values (p_fahrer, tag_s, zeit_s, 'pending', 'automatisch');
      return 'vorgezogen';
    end if;
    return 'gedeckt';
  end if;

  -- 3. Letzter Dienst vor der Fahrt.
  select * into p from public.trisar_dienst_spannen(p_fahrer, tag_s - 2, tag_s + 1) x
   where x.status <> 'refused' and x.von <= p_t
   order by x.von desc limit 1;
  if found and (p.tag = tag_s or p_t - p.bis < interval '3 hours') then
    if p.hat_ende then
      perform public.trisar_dienststart_hinweis(p_fahrer, p_t, p.ende_zeit);
      return 'nach_dienstende';
    end if;
    return 'gedeckt';
  end if;

  -- 5. Abgelehnt am Tag von S.
  if exists (select 1 from public.trisar_dienst_spannen(p_fahrer, tag_s, tag_s) x where x.status = 'refused') then
    return 'abgelehnt';
  end if;

  -- 4. Dienst am Tag von S beginnt erst nach der Fahrt: vorziehen. Ende, Pausen und Treffpunkt bleiben
  -- (trisar_dienst_ein_pro_tag_vorher / trisar_dienst_zusammenfuehren), der Fahrer bestaetigt die Aenderung.
  select * into n from public.trisar_dienst_spannen(p_fahrer, tag_s, tag_s) x
   where x.status <> 'refused' and x.von > p_t
   order by x.von limit 1;
  if found then
    insert into public.driver_service_requests (driver_id, service_date, service_start_time, status, requested_by)
    -- Herkunft bleibt: ein Dispo-Dienst wird dadurch nie zum automatischen (nie automatisch zurueckgezogen).
    values (p_fahrer, tag_s, zeit_s, 'pending', coalesce(n.requested_by, 'dispo'));
    return 'vorgezogen';
  end if;

  -- 6. Neuer Dienst.
  insert into public.driver_service_requests (driver_id, service_date, service_start_time, status, requested_by)
  values (p_fahrer, tag_s, zeit_s, 'pending', 'automatisch');
  return 'neu';
end;
$$;
revoke all on function public.trisar_dienststart_sichern(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Fahrt faellt beim Fahrer weg oder verschiebt sich: noch nicht bestaetigten automatischen Dienst
-- neu berechnen oder zurueckziehen.
create or replace function public.trisar_dienststart_aufraeumen(p_fahrer uuid, p_t_alt timestamptz)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v integer := public.trisar_dienststart_vorlauf();
  a record;
  erste timestamptz;
  s timestamptz;
  tag date;
begin
  if p_fahrer is null or p_t_alt is null then
    return 'aus';
  end if;
  tag := (p_t_alt at time zone 'Europe/Berlin')::date;
  select * into a from public.trisar_dienst_spannen(p_fahrer, tag - 1, tag) x
   where x.requested_by = 'automatisch' and x.status = 'pending' and not x.geaendert
     and x.von <= p_t_alt and p_t_alt <= x.bis
   order by x.von desc limit 1;
  if not found then
    return 'nichts';
  end if;
  select min((j.ride_date + j.etd) at time zone 'Europe/Berlin') into erste
    from public.jobs j
   where j.driver_id = p_fahrer and j.etd is not null and public.trisar_fahrt_aktiv(j.status)
     and j.ride_date between a.tag and a.tag + 1
     and ((j.ride_date + j.etd) at time zone 'Europe/Berlin') between a.von and a.bis;
  if erste is null then
    delete from public.driver_service_requests where id = a.id;
    return 'zurueckgezogen';
  end if;
  if v is null then
    return 'bleibt';
  end if;
  s := erste - make_interval(mins => v);
  if s <= a.von then
    return 'bleibt';
  end if;
  if (s at time zone 'Europe/Berlin')::date = a.tag then
    update public.driver_service_requests set service_start_time = (s at time zone 'Europe/Berlin')::time where id = a.id;
    return 'verschoben';
  end if;
  -- Erste verbleibende Fahrt liegt so spaet, dass ihr Dienst an einem anderen Tag beginnt.
  delete from public.driver_service_requests where id = a.id;
  perform public.trisar_dienststart_sichern(p_fahrer, erste);
  return 'neu_berechnet';
end;
$$;
revoke all on function public.trisar_dienststart_aufraeumen(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.trisar_jobs_dienststart()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t_alt timestamptz;
  t_neu timestamptz;
  alt_aktiv boolean;
  neu_aktiv boolean;
begin
  if tg_op = 'UPDATE' then
    alt_aktiv := old.driver_id is not null and old.etd is not null and public.trisar_fahrt_aktiv(old.status);
    t_alt := (old.ride_date + old.etd) at time zone 'Europe/Berlin';
  else
    alt_aktiv := false;
  end if;
  neu_aktiv := new.driver_id is not null and new.etd is not null and public.trisar_fahrt_aktiv(new.status);
  t_neu := (new.ride_date + new.etd) at time zone 'Europe/Berlin';

  if tg_op = 'UPDATE' and alt_aktiv = neu_aktiv and old.driver_id is not distinct from new.driver_id
     and t_alt is not distinct from t_neu then
    return null;
  end if;

  -- Fehler hier duerfen das Speichern der Fahrt nie verhindern.
  begin
    if alt_aktiv then
      perform public.trisar_dienststart_aufraeumen(old.driver_id, t_alt);
    end if;
    if neu_aktiv then
      perform public.trisar_dienststart_sichern(new.driver_id, t_neu);
    end if;
  exception when others then
    raise warning 'Dienststart automatisch: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_jobs_dienststart on public.jobs;
create trigger trg_jobs_dienststart
  after insert or update of driver_id, ride_date, etd, status on public.jobs
  for each row execute function public.trisar_jobs_dienststart();
