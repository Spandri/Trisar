-- Rundung immer zugunsten des Fahrers (statt zur naechsten halben Stunde):
-- Beginn auf die halbe Stunde abrunden, Ende aufrunden, Pause abrunden.
-- Die Arbeitszeit ergibt sich daraus und ist damit immer ein Vielfaches von 30 Minuten.
-- Als Pause zaehlt nur eine Unterbrechung von mindestens 3 Stunden. Kuerzere sind Arbeitszeit (Wartezeit).

create or replace function public.stunden_halbe_ab(p timestamptz)
returns timestamptz language sql immutable as $$
  select case when p is null then null else to_timestamp(floor(extract(epoch from p) / 1800) * 1800) end;
$$;

create or replace function public.stunden_halbe_auf(p timestamptz)
returns timestamptz language sql immutable as $$
  select case when p is null then null else to_timestamp(ceil(extract(epoch from p) / 1800) * 1800) end;
$$;

create or replace function public.stunden_vorschlag_server(p_dienst_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb := public.stunden_vorschlag_genau(p_dienst_id);
  beginn timestamptz;
  ende timestamptz;
  pause_min integer := 0;
  arbeits integer;
  p jsonb;
  lang jsonb := '[]'::jsonb;
  dauer integer;
begin
  if v is null then return null; end if;
  beginn := public.stunden_halbe_ab((v->>'beginn')::timestamptz);
  ende := public.stunden_halbe_auf((v->>'ende')::timestamptz);
  for p in select * from jsonb_array_elements(coalesce(v->'pausen', '[]'::jsonb)) loop
    dauer := round(extract(epoch from ((p->>'bis')::timestamptz - (p->>'von')::timestamptz)) / 60)::int;
    if dauer >= 180 then
      lang := lang || p;
      pause_min := pause_min + dauer;
    end if;
  end loop;
  pause_min := (floor(pause_min / 30.0) * 30)::int;
  v := jsonb_set(v, '{pausen}', lang);
  arbeits := case when beginn is null or ende is null then 0
                  else greatest(0, (extract(epoch from (ende - beginn)) / 60)::int - pause_min) end;
  return v || jsonb_build_object(
    'beginn', beginn, 'ende', ende, 'pause_min', pause_min, 'arbeits_min', arbeits,
    'beginn_genau', v->'beginn', 'ende_genau', v->'ende');
end;
$$;

revoke all on function public.stunden_vorschlag_server(uuid) from public, anon, authenticated;
grant execute on function public.stunden_vorschlag_server(uuid) to service_role;

drop function if exists public.stunden_halbe(timestamptz);
