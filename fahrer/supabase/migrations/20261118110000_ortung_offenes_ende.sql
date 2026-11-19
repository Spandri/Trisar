-- Ortung und Datumsgrenze (18.11.2026)
--
-- Anlass: Stefano, Dienst 17.11. ab 18:30 ohne Ende. Um 00:00 galt der Dienst fuer die Ortung als vorbei,
-- nur die offene 19:30-Fahrt hielt sie an. Storno der Fahrt um 01:20 schaltete die Ortung aus, das Dienstende
-- 01:25 (gesendet 01:23) schaltete sie fuer 2 Minuten wieder an und schickte "Arbeitszeit beginnt".
-- 1. ortung_fenster: Dienst ohne Ende bleibt offen, bis ein Ende gesendet wird (keine Obergrenze).
-- 2. ortung_wecken: "Arbeitszeit beginnt" nur, wenn die Arbeitszeit noch mindestens 15 Minuten laeuft.

CREATE OR REPLACE FUNCTION public.ortung_fenster(p_fahrer uuid)
 RETURNS TABLE(von timestamp with time zone, bis timestamp with time zone, art text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with dienst as (
    select d.service_date as tag,
           case when lower(coalesce(d.status, '')) = 'accepted' then d.service_start_time
                else nullif(a.vorher->>'start', '')::time end as s,
           -- Dienstende (13.11.): das von der Dispo gesendete Ende gilt fuer die Ortung sofort, auch wenn
           -- der Fahrer die Aenderung noch nicht bestaetigt hat. Ab dieser Uhrzeit keine App-Standorte mehr.
           case when lower(coalesce(d.status, '')) = 'accepted' then d.service_end_time
                else coalesce(d.service_end_time, nullif(a.vorher->>'ende', '')::time) end as e,
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
  ), reise as (
    -- Dienstreise (14.11.): angenommen und nicht beendet. Von 30 min vor Start bis Beenden, sonst bis
    -- 2 h nach der letzten Ankunft (Abschnitte), ohne Abschnitte 18 h nach Start.
    select ((r.datum + r.start_zeit) at time zone 'Europe/Berlin') as ab,
           (select max(((coalesce(a.an_datum, a.ab_datum, r.datum) + a.an_zeit) at time zone 'Europe/Berlin'))
              from public.dienstreise_abschnitt a where a.dienstreise_id = r.id and a.an_zeit is not null) as an
      from public.dienstreise_fahrer f join public.dienstreise r on r.id = f.dienstreise_id
     where f.driver_id = p_fahrer and lower(coalesce(f.status, '')) = 'accepted' and f.beendet is null
       and r.datum between (now() at time zone 'Europe/Berlin')::date - 1 and (now() at time zone 'Europe/Berlin')::date + 2
  ), fahrt as (
    select ((j.ride_date + coalesce(j.etd, time '00:00')) at time zone 'Europe/Berlin') as ab
      from public.jobs j
     where j.driver_id = p_fahrer
       and j.ride_date between (now() at time zone 'Europe/Berlin')::date - 1 and (now() at time zone 'Europe/Berlin')::date + 2
       and lower(coalesce(j.status, '')) not in ('done', 'completed', 'cancelled', 'canceled', 'storniert', 'refused')
  )
  -- Dienst ohne Ende (18.11.): offen bis die Dispo ein Ende sendet, nicht mehr nur bis Mitternacht.
  -- Vorher ging die Ortung um 00:00 aus, obwohl der Fahrer noch arbeitete.
  select ((tag + coalesce(s, time '00:00')) at time zone 'Europe/Berlin'),
         case when e is null then 'infinity'::timestamptz
              else ((tag + e + case when s is not null and e <= s then interval '1 day' else interval '0' end) at time zone 'Europe/Berlin') end,
         'dienst'
    from dienst where gilt and (s is not null or e is not null)
  union all
  select ((tag + s) at time zone 'Europe/Berlin'),
         ((tag + e + case when e <= s then interval '1 day' else interval '0' end) at time zone 'Europe/Berlin'),
         'standby'
    from standby where s is not null and e is not null
  union all
  select ab - interval '30 minutes', coalesce(an + interval '2 hours', ab + interval '18 hours'), 'dienstreise' from reise
  union all
  select ab - interval '60 minutes', ab + interval '12 hours', 'fahrt' from fahrt;
$function$;

create or replace function public.ortung_wecken()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  r record;
  jetzt_an boolean;
  vorher boolean;
  anzahl integer := 0;
  bis_wann timestamptz;
begin
  for r in
    select distinct g.user_id as id
      from public.push_geraete g join public.profiles p on p.id = g.user_id
     where g.app = 'fahrer' and coalesce(p.tracking_mode, 'app') <> 'obd'
  loop
    jetzt_an := public.ortung_erlaubt(r.id);
    select z.an into vorher from public.ortung_zustand z where z.driver_id = r.id;
    if vorher is distinct from jetzt_an then
      insert into public.ortung_zustand (driver_id, an, geaendert) values (r.id, jetzt_an, now())
      on conflict (driver_id) do update set an = excluded.an, geaendert = excluded.geaendert;
      if jetzt_an then
        -- Nur wecken, wenn die Arbeitszeit noch mindestens 15 Minuten laeuft (18.11.): ein Dienstende in
        -- 2 Minuten ist kein Arbeitsbeginn.
        select max(f.bis) into bis_wann from public.ortung_fenster(r.id) f where now() >= f.von and now() < f.bis;
        if bis_wann is not null and bis_wann >= now() + interval '15 minutes' then
          perform public.push_melden(r.id, 'fahrer', 'ortung_start', 'Arbeitszeit beginnt',
            'TRISAR sendet deinen Standort jetzt an die Disposition.', jsonb_build_object('ziel', 'liste'));
          anzahl := anzahl + 1;
        end if;
      end if;
    end if;
  end loop;
  return anzahl;
end;
$function$;

-- Offenes Ende an die Apps als null (kein Wechsel geplant), nicht als "infinity".
create or replace function public.ortung_status()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with f as (select * from public.ortung_fenster(auth.uid())),
  jetzt as (select exists (select 1 from f where now() >= von and now() < bis) as an)
  select jsonb_build_object(
    'erlaubt', (select an from jetzt),
    'wechsel', case when (select an from jetzt)
                    then (select nullif(max(bis), 'infinity'::timestamptz) from f where now() >= von and now() < bis)
                    else (select min(von) from f where von > now()) end);
$function$;
