-- Kartenstil Satellit (17.11.): Die Dispo-Apps holen den Esri-Schluessel fuer Basiskarten
-- (integration_settings.esri_basemap_key_web) ueber diese Funktion. Nur Dispo darf lesen, sonst
-- bleibt integration_settings gesperrt. Der Schluessel ist ohnehin "oeffentlich" (steckt im
-- Browser), ist bei Esri auf *.trisar.de beschraenkt und darf nur Basiskarten. Ohne Schluessel
-- kommt null, die Apps blenden dann den Knopf Satellit aus.
create or replace function public.karten_schluessel()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when public.ist_dispo()
    then (select value #>> '{}' from public.integration_settings where key = 'esri_basemap_key_web')
  end;
$$;

revoke all on function public.karten_schluessel() from public, anon;
grant execute on function public.karten_schluessel() to authenticated;
