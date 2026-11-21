-- Fahrtenbuch: Standard-Zeitraum vom ersten Eintrag bis heute (21.11.2026)
--
-- Bisher begann der Zeitraum ohne Angabe am Monatsersten. Jetzt beginnt er beim ersten Eintrag des
-- Wagens (ohne Eintraege: heute) und endet heute. Die Apps fragen ohne "von" an und uebernehmen
-- das Datum aus der Antwort (Feld von, dazu erster_tag).

create or replace function public.fahrtenbuch_daten(p_vehicle uuid, p_von date default null, p_bis date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.vehicles%rowtype;
  v_vin text;
  v_heute date := (now() at time zone 'Europe/Berlin')::date;
  v_von date;
  v_erster date;
  v_bis date := coalesce(p_bis, (now() at time zone 'Europe/Berlin')::date);
  erg jsonb;
begin
  select * into v from public.vehicles where id = p_vehicle;
  if not found then return null; end if;
  v_vin := nullif(upper(trim(v.vin)), '');

  -- Ohne Angabe beginnt der Zeitraum beim ersten Eintrag des Wagens.
  select min((coalesce(g.ende, g.beginn) at time zone 'Europe/Berlin')::date) into v_erster
    from public.fahrtenbuch_gueltig g
   where case when v_vin is not null then g.vin = v_vin
              else g.vehicle_id = p_vehicle and g.vin is null end;
  v_von := coalesce(p_von, v_erster, v_heute);

  with zeilen as (
    select g.*, (coalesce(g.ende, g.beginn) at time zone 'Europe/Berlin')::date as tag
      from public.fahrtenbuch_gueltig g
     where case when v_vin is not null then g.vin = v_vin
                else g.vehicle_id = p_vehicle and g.vin is null end
  )
  select jsonb_build_object(
    'vehicle_id', v.id,
    'vin', v_vin,
    'kennzeichen', v.license_plate,
    'fahrzeug', v.brand_model,
    'km_stand', v.km_stand,
    'km_stand_am', v.km_stand_am,
    'von', v_von,
    'erster_tag', v_erster,
    'bis', v_bis,
    'km_heute', (select coalesce(sum(z.km), 0) from zeilen z where z.tag = v_heute),
    'km_monat', (select coalesce(sum(z.km), 0) from zeilen z
                  where z.tag >= date_trunc('month', v_heute)::date and z.tag <= v_heute),
    'km_gesamt', (select coalesce(sum(z.km), 0) from zeilen z where z.tag between v_von and v_bis),
    'km_gast', (select coalesce(sum(z.km), 0) from zeilen z where z.tag between v_von and v_bis and z.art = 'gast'),
    'km_leer', (select coalesce(sum(z.km), 0) from zeilen z where z.tag between v_von and v_bis and z.art = 'leer'),
    'anzahl', (select count(*) from zeilen),
    'zeilen', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', z.id, 'tag', z.tag, 'art', z.art, 'job_id', z.job_id,
               'beginn', z.beginn, 'ende', z.ende,
               'km_start', z.km_start, 'km_ende', z.km_ende,
               'km', z.km, 'km_quelle', z.km_quelle,
               'genau', z.km_quelle in ('tacho', 'gps_zaehler'),
               'von', z.von, 'nach', z.nach, 'zweck', z.zweck,
               'fahrer', z.fahrer, 'kennzeichen', z.kennzeichen
             ) order by coalesce(z.ende, z.beginn) desc, z.id desc)
        from zeilen z where z.tag between v_von and v_bis), '[]'::jsonb)
  ) into erg;
  return erg;
end;
$$;

notify pgrst, 'reload schema';
