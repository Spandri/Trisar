-- Stunden immer auf halbe oder ganze Stunden runden.
-- Der bisherige Vorschlag bleibt als stunden_vorschlag_genau erhalten (exakte Zeiten der Fahrten),
-- stunden_vorschlag_server liefert Beginn, Ende und Arbeitszeit gerundet auf 30 Minuten.
-- Alle Aufrufer (stunden_vorschlag, stunden_verlauf, Excel-Export) bekommen so die gerundeten Werte.

alter function public.stunden_vorschlag_server(uuid) rename to stunden_vorschlag_genau;
revoke all on function public.stunden_vorschlag_genau(uuid) from public, anon, authenticated;

-- Naechste halbe oder volle Stunde (Deutschland hat volle Stunden Versatz, daher reicht die Epoche).
create or replace function public.stunden_halbe(p timestamptz)
returns timestamptz language sql immutable as $$
  select case when p is null then null else to_timestamp(round(extract(epoch from p) / 1800) * 1800) end;
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
  pause_min integer;
  arbeits integer;
begin
  if v is null then return null; end if;
  beginn := public.stunden_halbe((v->>'beginn')::timestamptz);
  ende := public.stunden_halbe((v->>'ende')::timestamptz);
  pause_min := (round(coalesce((v->>'pause_min')::int, 0) / 30.0) * 30)::int;
  arbeits := case when beginn is null or ende is null then 0
                  else greatest(0, (round((extract(epoch from (ende - beginn)) / 60 - pause_min) / 30.0) * 30)::int) end;
  return v || jsonb_build_object(
    'beginn', beginn, 'ende', ende, 'pause_min', pause_min, 'arbeits_min', arbeits,
    'beginn_genau', v->'beginn', 'ende_genau', v->'ende');
end;
$$;

revoke all on function public.stunden_vorschlag_server(uuid) from public, anon, authenticated;
grant execute on function public.stunden_vorschlag_server(uuid) to service_role;

-- Ablehnen speichert 0 Stunden (Beginn = Ende), daher Ende gleich Beginn erlauben.
alter table public.stundenzettel drop constraint if exists stundenzettel_check;
alter table public.stundenzettel add constraint stundenzettel_check check (ende >= beginn);
