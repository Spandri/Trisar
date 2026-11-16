-- Dienstreise (14.11.2026): Linie je Abschnitt fuer die Karte. Bus entlang der Strassen, U-Bahn und Tram
-- entlang ihrer Gleise. Berechnet die Edge Function abschnitt-linie (OSRM auf dem MacBook 2018), angestossen
-- von der Datenbank beim Anlegen oder Aendern eines Abschnitts (pg_net, wie trisar_route_anstossen).
-- Zuege und Fluege brauchen das nicht, deren Linie kommt live (train-validate) bzw. als Bogen.

alter table public.dienstreise_abschnitt add column if not exists linie jsonb;

create extension if not exists pg_net;

create or replace function public.dienstreise_linie_anstossen(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_schluessel text;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return;
  end if;
  select value #>> '{}' into v_schluessel from public.integration_settings where key = 'edge_service_role_key';
  if coalesce(v_schluessel, '') = '' then
    return;
  end if;
  perform net.http_post(
    url := 'http://kong:8000/functions/v1/abschnitt-linie',
    body := jsonb_build_object('abschnitt_ids', to_jsonb(p_ids)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_schluessel,
                                  'apikey', v_schluessel),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.dienstreise_linie_anstossen(uuid[]) from public, anon, authenticated;

create or replace function public.dienstreise_abschnitt_linie_trigger()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
begin
  if new.art not in ('bus', 'ubahn', 'tram') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.art is not distinct from old.art
     and new.von_lat is not distinct from old.von_lat and new.von_lng is not distinct from old.von_lng
     and new.nach_lat is not distinct from old.nach_lat and new.nach_lng is not distinct from old.nach_lng then
    return new;
  end if;
  perform public.dienstreise_linie_anstossen(array[new.id]);
  return new;
end;
$$;

drop trigger if exists trg_dienstreise_abschnitt_linie on public.dienstreise_abschnitt;
create trigger trg_dienstreise_abschnitt_linie
  after insert or update of art, von_lat, von_lng, nach_lat, nach_lng on public.dienstreise_abschnitt
  for each row execute function public.dienstreise_abschnitt_linie_trigger();

-- Bestehende Reisen ab gestern einmal nachrechnen.
select public.dienstreise_linie_anstossen(array(
  select a.id from public.dienstreise_abschnitt a
  join public.dienstreise d on d.id = a.dienstreise_id
  where d.datum >= current_date - 1 and a.art in ('bus', 'ubahn', 'tram') and a.linie is null
));
