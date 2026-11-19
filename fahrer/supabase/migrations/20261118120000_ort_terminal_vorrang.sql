-- Terminal im Adresstext vor Entfernung (18.11.2026)
--
-- "Flughafen München Terminal 1" landete bei MUC T2: die Adresse liegt 691 m vom Pin MUC T2 und 900 m vom
-- Pin MUC T1, die Radien ueberlappen, der naechste gewann. Steht ein Terminal in der Adresse ("Terminal 1",
-- "T1", "Terminal 2", "T2"), gewinnt jetzt der eigene Ort mit diesem Terminal im Namen, sofern er im
-- Rausfahr-Radius liegt (bzw. ohne Koordinaten). Danach wie bisher.

create or replace function public.trisar_ort_finden(p_adresse text, p_lat double precision, p_lng double precision)
 returns uuid
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_kern text := public.trisar_adress_kern(p_adresse);
  v_terminal text := (regexp_match(coalesce(p_adresse, ''), '(?:\mterminal\s*|\mT)([1-9])\M', 'i'))[1];
begin
  if v_terminal is not null then
    select o.id into v_id from public.orte o
     where o.name ~* ('(\mterminal\s*|\mT)' || v_terminal || '\M')
       and (p_lat is null or p_lng is null or public.trisar_luftlinie_m(p_lat, p_lng, o.lat, o.lng) <= greatest(o.radius_raus_m, 2000))
     order by case when p_lat is null then 0 else public.trisar_luftlinie_m(p_lat, p_lng, o.lat, o.lng) end
     limit 1;
    if v_id is not null then return v_id; end if;
  end if;
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
$function$;

-- Die Fahrt von heute frueh (Terminal 1, MUC T2 zugeordnet) korrigieren, und alle offenen Fahrten, bei denen
-- das Terminal im Text nicht zum zugeordneten Ort passt.
update public.jobs j
   set dropoff_ort_id = public.trisar_ort_finden(j.dropoff_address,
         (j.ext_route_payload->'nach'->>'lat')::double precision,
         coalesce((j.ext_route_payload->'nach'->>'lon')::double precision, (j.ext_route_payload->'nach'->>'lng')::double precision))
 where j.ride_date >= current_date - 1
   and (regexp_match(coalesce(j.dropoff_address, ''), '(?:\mterminal\s*|\mT)([1-9])\M', 'i'))[1] is not null
   and lower(coalesce(j.status, '')) not in ('done', 'completed', 'cancelled', 'canceled', 'storniert');
update public.jobs j
   set pickup_ort_id = public.trisar_ort_finden(j.pickup_address,
         (j.ext_route_payload->'von'->>'lat')::double precision,
         coalesce((j.ext_route_payload->'von'->>'lon')::double precision, (j.ext_route_payload->'von'->>'lng')::double precision))
 where j.ride_date >= current_date - 1
   and (regexp_match(coalesce(j.pickup_address, ''), '(?:\mterminal\s*|\mT)([1-9])\M', 'i'))[1] is not null
   and lower(coalesce(j.status, '')) not in ('done', 'completed', 'cancelled', 'canceled', 'storniert');
