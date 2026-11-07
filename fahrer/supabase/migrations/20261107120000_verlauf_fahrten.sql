-- Verlauf in den Fahrer-Apps (Profil -> Verlauf): erledigte Fahrten eines Fahrers, neueste zuerst.
-- Erledigt heisst Status done/completed/arrived/beendet. Stornierte Fahrten bleiben draussen.
-- Abfahrt kommt aus ride_date + etd (Europe/Berlin). Ankunft ist der letzte Wechsel auf einen
-- Erledigt-Status aus job_status_history, wenn er zwischen Abfahrt und Abfahrt + 12 h liegt,
-- sonst Abfahrt + ext_route_duration_mins (dann 'ankunft_genau' = false).
-- job_status_history darf der Fahrer nicht lesen, deshalb security definer.
-- Ohne p_driver die eigenen Fahrten, mit p_driver nur fuer die Dispo (wie stunden_verlauf).

create or replace function public.verlauf_fahrten(p_driver uuid default null, p_tage integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  fahrer uuid := coalesce(p_driver, auth.uid());
  heute date := (now() at time zone 'Europe/Berlin')::date;
begin
  if fahrer is null or (fahrer <> auth.uid() and not public.ist_dispo()) then
    raise exception 'kein Zugriff';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', f.id,
             'datum', f.ride_date,
             'abfahrt', f.abfahrt,
             'ankunft', coalesce(f.ende_protokoll, f.abfahrt + make_interval(mins => f.dauer)),
             'ankunft_genau', f.ende_protokoll is not null,
             'gaeste', to_jsonb(f.passengers),
             'anonym', coalesce(f.anonymous_guests, 0),
             'von', coalesce(nullif(f.pickup_name, ''), f.pickup_address),
             'nach', coalesce(nullif(f.dropoff_name, ''), f.dropoff_address),
             'status', f.status
           ) order by f.ride_date desc, f.abfahrt desc nulls last)
    from (
      select j.*,
             ((j.ride_date + coalesce(j.etd, j.original_etd)) at time zone 'Europe/Berlin') as abfahrt,
             j.ext_route_duration_mins as dauer,
             (select max(h.created_at) from public.job_status_history h
               where h.job_id = j.id
                 and lower(h.to_status) in ('done', 'completed', 'arrived', 'beendet')
                 and h.created_at >= ((j.ride_date + coalesce(j.etd, j.original_etd)) at time zone 'Europe/Berlin')
                 and h.created_at <= ((j.ride_date + coalesce(j.etd, j.original_etd)) at time zone 'Europe/Berlin') + interval '12 hours'
             ) as ende_protokoll
      from public.jobs j
      where (j.driver_id = fahrer
             or exists (select 1 from public.convoy_assignments ca where ca.job_id = j.id and ca.driver_id = fahrer))
        and lower(coalesce(j.status, '')) in ('done', 'completed', 'arrived', 'beendet')
        and j.ride_date <= heute
        and j.ride_date >= heute - p_tage
    ) f
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.verlauf_fahrten(uuid, integer) from public, anon;
grant execute on function public.verlauf_fahrten(uuid, integer) to authenticated;
