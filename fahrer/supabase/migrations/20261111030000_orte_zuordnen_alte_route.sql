-- Orts-Zuordnung beim Aendern der Adresse nicht mehr mit den Koordinaten der alten Route.
--
-- Fehler (11.11.): Ziel einer Fahrt von "Flughafen Terminal 2" auf "dm Kreillerstrasse" geaendert.
-- Die App leert dropoff_ort_id, der Trigger trg_jobs_ort_zuordnen sucht dann sofort einen Ort,
-- nimmt dafuer aber ext_route_payload->'nach' -- das ist noch die alte Route (Flughafen), die neue
-- rechnet external-sync erst danach. Ergebnis: die Fahrt bekam wieder den Ort "MUC T2" und
-- der Fahrer wurde zum Flughafen geschickt.
--
-- Jetzt: Hat sich die Adresse geaendert, die Route aber noch nicht, zaehlt nur die Adresse.
-- Kommt die neue Route, wird mit den neuen Koordinaten zugeordnet (wie bisher, nur wenn noch leer).

create or replace function public.trisar_jobs_ort_zuordnen()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  -- Route passt noch nicht zur neuen Adresse: Koordinaten nicht verwenden.
  v_start_veraltet boolean := tg_op = 'UPDATE'
    and new.pickup_address is distinct from old.pickup_address
    and new.ext_route_payload is not distinct from old.ext_route_payload;
  v_ziel_veraltet boolean := tg_op = 'UPDATE'
    and new.dropoff_address is distinct from old.dropoff_address
    and new.ext_route_payload is not distinct from old.ext_route_payload;
begin
  if new.pickup_ort_id is null then
    new.pickup_ort_id := public.trisar_ort_finden(
      new.pickup_address,
      case when v_start_veraltet then null else (new.ext_route_payload->'von'->>'lat')::double precision end,
      case when v_start_veraltet then null else coalesce((new.ext_route_payload->'von'->>'lon')::double precision, (new.ext_route_payload->'von'->>'lng')::double precision) end);
  end if;
  if new.dropoff_ort_id is null then
    new.dropoff_ort_id := public.trisar_ort_finden(
      new.dropoff_address,
      case when v_ziel_veraltet then null else (new.ext_route_payload->'nach'->>'lat')::double precision end,
      case when v_ziel_veraltet then null else coalesce((new.ext_route_payload->'nach'->>'lon')::double precision, (new.ext_route_payload->'nach'->>'lng')::double precision) end);
  end if;
  return new;
end;
$$;

-- Einmalig: Fahrten, deren Ort weit ausserhalb des Rausfahr-Radius ihrer (neuen) Route liegt,
-- verlieren die falsche Zuordnung. Der Trigger ordnet danach mit den aktuellen Koordinaten neu zu.
update public.jobs j
   set dropoff_ort_id = null
  from public.orte o
 where o.id = j.dropoff_ort_id
   and j.ext_route_payload->'nach'->>'lat' is not null
   and public.trisar_luftlinie_m(
         (j.ext_route_payload->'nach'->>'lat')::double precision,
         coalesce((j.ext_route_payload->'nach'->>'lon')::double precision, (j.ext_route_payload->'nach'->>'lng')::double precision),
         o.lat, o.lng) > o.radius_raus_m;

update public.jobs j
   set pickup_ort_id = null
  from public.orte o
 where o.id = j.pickup_ort_id
   and j.ext_route_payload->'von'->>'lat' is not null
   and public.trisar_luftlinie_m(
         (j.ext_route_payload->'von'->>'lat')::double precision,
         coalesce((j.ext_route_payload->'von'->>'lon')::double precision, (j.ext_route_payload->'von'->>'lng')::double precision),
         o.lat, o.lng) > o.radius_raus_m;
