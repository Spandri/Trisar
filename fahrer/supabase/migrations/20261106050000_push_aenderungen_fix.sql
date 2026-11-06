-- Fix: Fahrt speichern scheiterte mit "malformed array literal: \"Datum\"".
-- In push_jobs_ausloeser() las Postgres bei  text[] || 'Datum'  das Literal als Array.
-- Jetzt array_append(). Nur die Funktion wird ersetzt, der Ausloeser push_jobs bleibt.

create or replace function public.push_jobs_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fahrt text;
  daten jsonb;
  f uuid;
  d uuid;
  aenderungen text[] := '{}';
  alt_s jsonb;
  neu_s jsonb;
  alt_eta timestamptz;
  neu_eta timestamptz;
  flug text;
  status_neu text;
  status_alt text;
  storno boolean;
begin
  fahrt := public.push_fahrt_text(new);
  daten := jsonb_build_object('ziel', 'fahrt', 'job_id', new.id);

  if tg_op = 'INSERT' then
    if new.driver_id is not null then
      perform public.push_melden(new.driver_id, 'fahrer', 'fahrt_neu', 'Neue Fahrt', fahrt || '. Bitte annehmen.', daten);
    end if;
    return new;
  end if;

  storno := lower(coalesce(new.status, '')) in ('cancelled', 'canceled', 'storniert');

  -- Fahrer gewechselt
  if new.driver_id is distinct from old.driver_id then
    if new.driver_id is not null and not storno then
      perform public.push_melden(new.driver_id, 'fahrer', 'fahrt_neu', 'Neue Fahrt', fahrt || '. Bitte annehmen.', daten);
    end if;
    if old.driver_id is not null and lower(coalesce(new.status, '')) <> 'refused' then
      perform public.push_melden(old.driver_id, 'fahrer', 'fahrt_entzogen', 'Fahrt entzogen',
        fahrt || ' ist dir nicht mehr zugeteilt.', jsonb_build_object('ziel', 'liste'));
    end if;
  end if;

  -- Storniert
  if storno and lower(coalesce(old.status, '')) not in ('cancelled', 'canceled', 'storniert') then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'fahrt_storniert', 'Fahrt storniert', fahrt || ' wurde storniert.',
        jsonb_build_object('ziel', 'liste'));
    end loop;
    return new;
  end if;

  -- Fahrdaten geaendert. Eine reine ETD-Verschiebung durch den Flugabgleich meldet der Flug-Teil.
  if new.ride_date is distinct from old.ride_date then aenderungen := array_append(aenderungen, 'Datum'); end if;
  if new.etd is distinct from old.etd
     and not (new.ext_flight_payload is distinct from old.ext_flight_payload) then
    aenderungen := array_append(aenderungen, 'Zeit ' || coalesce(to_char(old.etd, 'HH24:MI'), '–') || ' → ' || coalesce(to_char(new.etd, 'HH24:MI'), '–'));
  end if;
  if new.pickup_name is distinct from old.pickup_name or new.pickup_address is distinct from old.pickup_address then
    aenderungen := array_append(aenderungen, 'Abholort');
  end if;
  if new.dropoff_name is distinct from old.dropoff_name or new.dropoff_address is distinct from old.dropoff_address then
    aenderungen := array_append(aenderungen, 'Ziel');
  end if;
  if new.flight_number is distinct from old.flight_number then aenderungen := array_append(aenderungen, 'Flugnummer'); end if;
  if new.train_number is distinct from old.train_number then aenderungen := array_append(aenderungen, 'Zugnummer'); end if;
  if cardinality(aenderungen) > 0 and new.driver_id is not distinct from old.driver_id then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'fahrt_geaendert', 'Fahrt geändert',
        fahrt || ': ' || array_to_string(aenderungen, ', ') || '.', daten);
    end loop;
  end if;

  -- Gaeste und Merkmale
  if (new.passengers is distinct from old.passengers or new.anonymous_guests is distinct from old.anonymous_guests
      or new.is_vip is distinct from old.is_vip or new.needs_child_seat is distinct from old.needs_child_seat
      or new.needs_accessibility is distinct from old.needs_accessibility or new.needs_luggage is distinct from old.needs_luggage)
     and new.driver_id is not distinct from old.driver_id then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'gaeste_geaendert', 'Gäste geändert',
        fahrt || ': Gäste oder Hinweise (VIP, Kindersitz, Rollstuhl, Gepäck) wurden angepasst.', daten);
    end loop;
  end if;

  -- Anderes Fahrzeug fuer die Fahrt
  if new.vehicle_id is distinct from old.vehicle_id and new.vehicle_id is not null then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'fahrt_fahrzeug', 'Anderes Fahrzeug',
        fahrt || ' jetzt mit ' || coalesce((select v.license_plate from public.vehicles v where v.id = new.vehicle_id), 'anderem Fahrzeug') || '.',
        daten);
    end loop;
  end if;

  -- Flug: Status und erwartete Ankunft
  if new.ext_flight_payload is distinct from old.ext_flight_payload then
    alt_s := coalesce(old.ext_flight_payload -> 'summary', '{}'::jsonb);
    neu_s := coalesce(new.ext_flight_payload -> 'summary', '{}'::jsonb);
    flug := coalesce(nullif(trim(new.flight_number), ''), 'Flug');
    status_alt := upper(coalesce(alt_s ->> 'flight_status_code', ''));
    status_neu := upper(coalesce(neu_s ->> 'flight_status_code', ''));
    if status_neu <> status_alt and status_neu = 'LD' then
      for f in select public.push_fahrer_der_fahrt(new.id) loop
        perform public.push_melden(f, 'fahrer', 'flug_gelandet', flug || ' gelandet', fahrt || '.', daten);
      end loop;
    elsif status_neu <> status_alt and status_neu = 'CD' then
      for f in select public.push_fahrer_der_fahrt(new.id) loop
        perform public.push_melden(f, 'fahrer', 'flug_annulliert', flug || ' annulliert', fahrt || '. Bitte bei der Dispo melden.', daten);
      end loop;
    elsif status_neu <> status_alt and status_neu in ('RT', 'DV') then
      for f in select public.push_fahrer_der_fahrt(new.id) loop
        perform public.push_melden(f, 'fahrer', 'flug_umgeleitet', flug || ' umgeleitet', fahrt || '. Bitte bei der Dispo melden.', daten);
      end loop;
    else
      alt_eta := coalesce(public.push_zeit(alt_s ->> 'estimated_arrival_local'), public.push_zeit(alt_s ->> 'scheduled_arrival_local'));
      neu_eta := coalesce(public.push_zeit(neu_s ->> 'estimated_arrival_local'), public.push_zeit(neu_s ->> 'scheduled_arrival_local'));
      if alt_eta is not null and neu_eta is not null and abs(extract(epoch from neu_eta - alt_eta)) >= 600 then
        for f in select public.push_fahrer_der_fahrt(new.id) loop
          perform public.push_melden(f, 'fahrer', 'flug_zeit',
            flug || case when neu_eta > alt_eta then ' später' else ' früher' end,
            flug || ' landet ' || abs(round(extract(epoch from neu_eta - alt_eta) / 60))::int || ' min '
              || case when neu_eta > alt_eta then 'später' else 'früher' end
              || coalesce(', neue ETD ' || to_char(new.etd, 'HH24:MI'), '') || '. ' || fahrt || '.',
            daten);
        end loop;
      end if;
    end if;
  end if;

  -- Zug: Prognose verschiebt sich um mindestens 10 Minuten
  if new.train_predicted_time is distinct from old.train_predicted_time
     and new.train_predicted_time is not null
     and abs(extract(epoch from new.train_predicted_time - coalesce(old.train_predicted_time, new.train_planned_time, new.train_predicted_time))) >= 600 then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'zug_zeit', coalesce(nullif(trim(new.train_number), ''), 'Zug') || ' verspätet',
        'Neue Ankunft ' || to_char(new.train_predicted_time, 'HH24:MI')
          || coalesce(' (Plan ' || to_char(new.train_planned_time, 'HH24:MI') || ')', '') || '. ' || fahrt || '.',
        daten);
    end loop;
  end if;

  -- Dispo: Antwort des Fahrers
  if new.driver_response_status is distinct from old.driver_response_status
     and lower(coalesce(new.driver_response_status, '')) in ('accepted', 'refused') then
    for d in select public.push_dispo_konten() loop
      if lower(new.driver_response_status) = 'refused' then
        perform public.push_melden(d, 'dispo', 'dispo_abgelehnt', 'Fahrt abgelehnt',
          public.push_name(coalesce(new.refused_by_driver_id, old.driver_id)) || ' hat ' || fahrt || ' abgelehnt'
            || coalesce(': ' || nullif(trim(new.refusal_reason), ''), '') || '.', daten);
      else
        perform public.push_melden(d, 'dispo', 'dispo_angenommen', 'Fahrt angenommen',
          public.push_name(new.driver_id) || ' hat ' || fahrt || ' angenommen.', daten);
      end if;
    end loop;
  end if;

  return new;
end;
$$;
