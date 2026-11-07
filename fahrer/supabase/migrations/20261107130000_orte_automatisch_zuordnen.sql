-- Fahrten automatisch einem eigenen Ort zuordnen, wenn die Adresse dazu passt.
--
-- Bisher bekam eine Fahrt nur dann pickup_ort_id/dropoff_ort_id, wenn der Ort beim Anlegen aus
-- den Vorschlaegen gewaehlt wurde. Getippte oder importierte Adressen ("Kongress am Park,
-- Goegginger Str. 10, 86159 Augsburg") blieben ohne Ort: kein Icon beim Fahrer, kein Ortsradius.
--
-- Zuordnung (nur wenn noch keine *_ort_id gesetzt ist):
--   1. Koordinaten der Fahrt (TomTom-Payload) liegen im Reinfahr-Radius eines Orts, naechster gewinnt.
--   2. Sonst gleiche Strasse + Hausnummer wie die Ortsadresse ("Str."/"Strasse"/"Straße" gleich),
--      und falls die Fahrt Koordinaten hat, hoechstens 2 km vom Ort entfernt.
-- Laeuft beim Anlegen, bei geaenderter Adresse oder wenn TomTom die Koordinaten nachliefert.
-- Neue oder verschobene Orte ordnen offene Fahrten nachtraeglich zu.

create or replace function public.trisar_adress_kern(p_text text)
returns text
language sql
immutable
as $$
  select case when m is null then null else
    regexp_replace(regexp_replace(m[1], '(strasse|straße|str\.?)$', 'str'), '[^a-z0-9äöü]', '', 'g') || lower(m[3])
  end
  from (select regexp_match(
          lower(coalesce(p_text, '')),
          '([a-zäöüß][a-zäöüß.\- ]*?(strasse|straße|str\.?|weg|platz|allee|ring|gasse|damm|ufer|markt|steig|chaussee))\s*(\d+\s*[a-z]?)\M'
        ) as m) x
$$;

create or replace function public.trisar_ort_finden(p_adresse text, p_lat double precision, p_lng double precision)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_kern text := public.trisar_adress_kern(p_adresse);
begin
  if p_lat is not null and p_lng is not null then
    select o.id into v_id from public.orte o
     where public.trisar_luftlinie_m(p_lat, p_lng, o.lat, o.lng) <= o.radius_rein_m
     order by public.trisar_luftlinie_m(p_lat, p_lng, o.lat, o.lng)
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  if v_kern is not null and length(v_kern) >= 5 then
    select o.id into v_id from public.orte o
     where public.trisar_adress_kern(o.adresse) = v_kern
       and (p_lat is null or p_lng is null or public.trisar_luftlinie_m(p_lat, p_lng, o.lat, o.lng) <= 2000)
     order by o.erstellt
     limit 1;
  end if;
  return v_id;
end;
$$;

create or replace function public.trisar_jobs_ort_zuordnen()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.pickup_ort_id is null then
    new.pickup_ort_id := public.trisar_ort_finden(
      new.pickup_address,
      (new.ext_route_payload->'von'->>'lat')::double precision,
      coalesce((new.ext_route_payload->'von'->>'lon')::double precision, (new.ext_route_payload->'von'->>'lng')::double precision));
  end if;
  if new.dropoff_ort_id is null then
    new.dropoff_ort_id := public.trisar_ort_finden(
      new.dropoff_address,
      (new.ext_route_payload->'nach'->>'lat')::double precision,
      coalesce((new.ext_route_payload->'nach'->>'lon')::double precision, (new.ext_route_payload->'nach'->>'lng')::double precision));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_jobs_ort_zuordnen on public.jobs;
create trigger trg_jobs_ort_zuordnen
  before insert or update of pickup_address, dropoff_address, ext_route_payload, pickup_ort_id, dropoff_ort_id
  on public.jobs
  for each row execute function public.trisar_jobs_ort_zuordnen();

-- Neuer oder verschobener Ort: offene Fahrten ohne Ort nachtraeglich zuordnen.
create or replace function public.trisar_orte_fahrten_nachziehen()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.jobs j
     set pickup_ort_id = public.trisar_ort_finden(j.pickup_address,
           (j.ext_route_payload->'von'->>'lat')::double precision,
           coalesce((j.ext_route_payload->'von'->>'lon')::double precision, (j.ext_route_payload->'von'->>'lng')::double precision))
   where j.pickup_ort_id is null
     and lower(coalesce(j.status, '')) not in ('done', 'completed', 'arrived', 'beendet', 'cancelled', 'canceled', 'storniert', 'stoniert', 'refused')
     and public.trisar_ort_finden(j.pickup_address,
           (j.ext_route_payload->'von'->>'lat')::double precision,
           coalesce((j.ext_route_payload->'von'->>'lon')::double precision, (j.ext_route_payload->'von'->>'lng')::double precision)) is not null;
  update public.jobs j
     set dropoff_ort_id = public.trisar_ort_finden(j.dropoff_address,
           (j.ext_route_payload->'nach'->>'lat')::double precision,
           coalesce((j.ext_route_payload->'nach'->>'lon')::double precision, (j.ext_route_payload->'nach'->>'lng')::double precision))
   where j.dropoff_ort_id is null
     and lower(coalesce(j.status, '')) not in ('done', 'completed', 'arrived', 'beendet', 'cancelled', 'canceled', 'storniert', 'stoniert', 'refused')
     and public.trisar_ort_finden(j.dropoff_address,
           (j.ext_route_payload->'nach'->>'lat')::double precision,
           coalesce((j.ext_route_payload->'nach'->>'lon')::double precision, (j.ext_route_payload->'nach'->>'lng')::double precision)) is not null;
  return null;
end;
$$;

drop trigger if exists trg_orte_fahrten_nachziehen on public.orte;
create trigger trg_orte_fahrten_nachziehen
  after insert or update of adresse, lat, lng, radius_rein_m on public.orte
  for each statement execute function public.trisar_orte_fahrten_nachziehen();

-- Einmal fuer die schon vorhandenen offenen Fahrten.
update public.orte set radius_rein_m = radius_rein_m;
