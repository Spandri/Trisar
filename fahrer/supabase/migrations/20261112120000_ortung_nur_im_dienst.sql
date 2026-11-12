-- App-Ortung nur in der Arbeitszeit (12.11.2026). OBD-Tracker sind ausgenommen.
--
-- Ein Standort aus der Fahrer-App zaehlt nur, wenn eins davon gilt:
--   * bestaetigter Dienst des Fahrers: Dienststart bis Dienstende (ueber Mitternacht moeglich).
--     Bei offener Aenderung gilt der bestaetigte alte Stand (dienst_aenderung.vorher).
--     Fehlt der Start, ab 00:00, fehlt das Ende, bis 24:00 des Diensttages.
--   * angenommener Standby: von bis bis (eigene Zeiten nach abgelehnter Aenderung).
--   * zugewiesene Fahrt (nicht erledigt/storniert/abgelehnt): ab 60 Minuten vor der Abfahrt (etd)
--     bis sie erledigt ist, hoechstens 12 Stunden nach der Abfahrt. "Hat er eine Fahrt, aber noch
--     keinen Dienst, ist die Fahrt sein Dienststart."
--
-- ortung_fenster(fahrer): alle Zeitfenster von gestern bis uebermorgen.
-- ortung_status(): fuer die Apps, ob gerade geortet werden darf und wann sich das aendert.
-- Trigger auf driver_live_locations und driver_location_history verwerfen App-Standorte ausserhalb
-- (source teltonika*/obd* bleibt immer). So gilt die Regel auch fuer alte App-Versionen.

create or replace function public.ortung_fenster(p_fahrer uuid)
returns table (von timestamptz, bis timestamptz, art text)
language sql
stable
security definer
set search_path = public
as $$
  with dienst as (
    select d.service_date as tag,
           case when lower(coalesce(d.status, '')) = 'accepted' then d.service_start_time
                else nullif(a.vorher->>'start', '')::time end as s,
           case when lower(coalesce(d.status, '')) = 'accepted' then d.service_end_time
                else nullif(a.vorher->>'ende', '')::time end as e,
           (lower(coalesce(d.status, '')) = 'accepted' or a.vorher is not null) as gilt
      from public.driver_service_requests d
      left join public.dienst_aenderung a on a.dienst_id = d.id
     where d.driver_id = p_fahrer
       and d.service_date between (now() at time zone 'Europe/Berlin')::date - 1 and (now() at time zone 'Europe/Berlin')::date + 2
       and lower(coalesce(d.status, '')) in ('accepted', 'pending')
  ), standby as (
    select s.datum as tag, coalesce(f.von_eigen, s.von) as s, coalesce(f.bis_eigen, s.bis) as e
      from public.standby_fahrer f join public.standby s on s.id = f.standby_id
     where f.driver_id = p_fahrer and lower(coalesce(f.status, '')) = 'accepted'
       and s.datum between (now() at time zone 'Europe/Berlin')::date - 1 and (now() at time zone 'Europe/Berlin')::date + 2
  ), fahrt as (
    select ((j.ride_date + coalesce(j.etd, time '00:00')) at time zone 'Europe/Berlin') as ab
      from public.jobs j
     where j.driver_id = p_fahrer
       and j.ride_date between (now() at time zone 'Europe/Berlin')::date - 1 and (now() at time zone 'Europe/Berlin')::date + 2
       and lower(coalesce(j.status, '')) not in ('done', 'completed', 'cancelled', 'canceled', 'storniert', 'refused')
  )
  select ((tag + coalesce(s, time '00:00')) at time zone 'Europe/Berlin'),
         ((tag + coalesce(e, time '00:00') + case when e is null or (s is not null and e <= s) then interval '1 day' else interval '0' end) at time zone 'Europe/Berlin'),
         'dienst'
    from dienst where gilt and (s is not null or e is not null)
  union all
  select ((tag + s) at time zone 'Europe/Berlin'),
         ((tag + e + case when e <= s then interval '1 day' else interval '0' end) at time zone 'Europe/Berlin'),
         'standby'
    from standby where s is not null and e is not null
  union all
  select ab - interval '60 minutes', ab + interval '12 hours', 'fahrt' from fahrt;
$$;
revoke all on function public.ortung_fenster(uuid) from public, anon, authenticated;

create or replace function public.ortung_erlaubt(p_fahrer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.ortung_fenster(p_fahrer) f where now() >= f.von and now() < f.bis);
$$;
revoke all on function public.ortung_erlaubt(uuid) from public, anon, authenticated;

-- Fuer die Apps: darf jetzt geortet werden, und wann sich das aendert (naechster Start bzw. Ende).
create or replace function public.ortung_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with f as (select * from public.ortung_fenster(auth.uid())),
  jetzt as (select exists (select 1 from f where now() >= von and now() < bis) as an)
  select jsonb_build_object(
    'erlaubt', (select an from jetzt),
    'wechsel', case when (select an from jetzt)
                    then (select max(bis) from f where now() >= von and now() < bis)
                    else (select min(von) from f where von > now()) end);
$$;
revoke all on function public.ortung_status() from public, anon;
grant execute on function public.ortung_status() to authenticated;

-- App-Standorte ausserhalb der Arbeitszeit still verwerfen.
create or replace function public.ortung_pruefen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(new.source, '')) like 'teltonika%' or lower(coalesce(new.source, '')) like 'obd%' then
    return new;
  end if;
  if public.ortung_erlaubt(new.driver_id) then
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_ortung_nur_im_dienst on public.driver_live_locations;
create trigger trg_ortung_nur_im_dienst
  before insert or update of lat, lng, captured_at on public.driver_live_locations
  for each row execute function public.ortung_pruefen();

drop trigger if exists trg_ortung_nur_im_dienst on public.driver_location_history;
create trigger trg_ortung_nur_im_dienst
  before insert on public.driver_location_history
  for each row execute function public.ortung_pruefen();
