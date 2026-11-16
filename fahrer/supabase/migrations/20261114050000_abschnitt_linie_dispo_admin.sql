-- Dienstreise (14.11.2026): Linien je Abschnitt rechnet jetzt dispo-admin (Aktion abschnitt_linie) statt einer
-- eigenen Edge Function. Neue Functions kennt die lokale Supabase erst nach einem vollen Neustart.
-- Danach bestehende Reisen ab gestern einmal nachrechnen.

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
    url := 'http://kong:8000/functions/v1/dispo-admin',
    body := jsonb_build_object('aktion', 'abschnitt_linie', 'abschnitt_ids', to_jsonb(p_ids)),
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'Authorization', 'Bearer ' || v_schluessel,
                                  'apikey', v_schluessel),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.dienstreise_linie_anstossen(uuid[]) from public, anon, authenticated;

select public.dienstreise_linie_anstossen(array(
  select a.id from public.dienstreise_abschnitt a
  join public.dienstreise d on d.id = a.dienstreise_id
  where d.datum >= current_date - 1 and a.art in ('bus', 'ubahn', 'tram') and a.linie is null
));
