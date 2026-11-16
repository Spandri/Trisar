-- Ortung endet zum gesendeten Dienstende (13.11.2026).
--
-- Bisher galt bei einer offenen Dienst-Aenderung fuer die Ortung der alte, bestaetigte Stand. Hatte der
-- kein Ende, schickten die Fahrer-Apps bis Mitternacht Standorte, obwohl die Dispo das Dienstende
-- schon gesendet hatte. Jetzt endet das Ortungsfenster zur gesendeten Endzeit (Start bleibt der alte).
-- OBD-Tracker sind wie bisher nicht betroffen.

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
$function$;
