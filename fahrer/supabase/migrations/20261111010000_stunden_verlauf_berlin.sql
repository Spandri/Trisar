-- Stundenerfassung: "heute" in deutscher Zeit statt current_date (Datenbank laeuft in UTC).
-- Sonst fehlten zwischen 00:00 und 01:00 (Winter) bzw. 02:00 (Sommer) alle Dienste des neuen Tages,
-- z. B. ein Dienst ab 00:30 erschien nicht im Verlauf des Fahrers. Sonst wie 20261106090000.

create or replace function public.stunden_verlauf(p_driver uuid default null, p_tage integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  fahrer uuid := coalesce(p_driver, auth.uid());
  heute date := (now() at time zone 'Europe/Berlin')::date;
  ergebnis jsonb := '[]'::jsonb;
  d record;
  z record;
begin
  if fahrer <> auth.uid() and not public.ist_dispo() then
    raise exception 'kein Zugriff';
  end if;
  -- Stundenerfassung fuer diesen Fahrer aus: der Fahrer-App (fragt ohne p_driver) nichts zeigen.
  -- Die Dispo fragt immer mit p_driver und sieht weiter alles.
  if p_driver is null and not public.stundenerfassung_an(fahrer) then
    return '[]'::jsonb;
  end if;
  for d in
    select * from public.driver_service_requests
    where driver_id = fahrer
      and lower(coalesce(status, '')) in ('accepted', 'assigned', 'approved')
      and service_date <= heute
      and service_date >= heute - p_tage
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

grant execute on function public.stunden_verlauf(uuid, integer) to authenticated;
