-- Dienst ohne Dienstende gilt nicht als vorbei (13.11.2026).
--
-- stunden_verlauf meldete 'vorbei' fuer Dienste ohne service_end_time sofort (coalesce(.., now())).
-- Folge: aendert die Dispo einen Dienst auf "nur Dienststart", blendeten alle Fahrer-Apps die
-- Dienststart-Zeile aus und zeigten gleich die Stundenerfassung. Jetzt erst mit Dienstende.

CREATE OR REPLACE FUNCTION public.stunden_verlauf(p_driver uuid DEFAULT NULL::uuid, p_tage integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- Standby am Event-Ort an diesem Tag (Vermerk "BMW Welt 18:00–23:00").
      'standby', coalesce((select jsonb_agg(jsonb_build_object('ort', s.ort_name,
          'von', to_char(coalesce(sf.von_eigen, s.von), 'HH24:MI'), 'bis', to_char(coalesce(sf.bis_eigen, s.bis), 'HH24:MI'))
          order by s.von)
        from public.standby_fahrer sf join public.standby s on s.id = sf.standby_id
        where sf.driver_id = fahrer and sf.status = 'accepted' and s.datum = d.service_date), '[]'::jsonb),
      -- Erfassen erst, wenn der Dienst vorbei ist. Ohne Dienstende ist er NICHT vorbei (13.11.):
      -- erst wenn die Dispo das Ende schickt, kommt die Stundenerfassung (vorher galt coalesce(.., now())).
      'vorbei', d.service_end_time is not null and coalesce(public.stunden_zeitpunkt(d.service_date, d.service_end_time) +
                  case when d.service_end_time <= d.service_start_time then interval '1 day' else interval '0' end, 'infinity'::timestamptz) <= now()
    );
  end loop;
  return ergebnis;
end;
$function$;
