-- 20.11.2026: Adresse einer Fahrt geaendert, alte Koordinaten weg.
--
-- Vorfall 19.11. 23:23 (Fahrt 43bd2168): Fahrer stand "beim Gast" am Wöllinger Wirtshaus, die Dispo
-- aenderte die Abholung auf Valleystrasse 32. Bis die neue Route da war, rechnete die Statusregel mit den
-- Koordinaten der alten Abholung (ext_route_payload.von), danach mit 2,1 km zur neuen. Der Fahrer war
-- damit "weggefahren" und die Fahrt sprang um 23:24 auf unterwegs, ohne dass ein Gast eingestiegen war.
-- Alle Apps navigierten dann direkt zum Ziel.
--
-- Jetzt beim Aendern der Abholadresse:
--   * Koordinaten der alten Abholung verwerfen (ext_route_payload.von, Anfahrt zum Gast).
--     Die neue Route kommt ueber trisar_route_anstossen (external-sync) wie bisher.
--   * Stand die Fahrt "beim Gast", zurueck auf assigned (ohne Fahrer pending). Die Statusregel setzt
--     beim Gast neu, sobald der Fahrer an der neuen Abholung ist.
-- Beim Aendern des Ziels entsprechend ext_route_payload.nach und die Anfahrt zum Ziel verwerfen.
-- Ausnahme: "Standort Fahrer" (start_fahrerstandort), dort schreibt trisar_jobs_start_fahrerstandort die
-- Abholung selbst aus dem GPS.

create or replace function public.trisar_jobs_adresse_neu()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_abholung_neu boolean;
  v_ziel_neu boolean;
  v_status_neu text;
begin
  v_abholung_neu := new.pickup_address is distinct from old.pickup_address
    and not coalesce(new.start_fahrerstandort, false);
  v_ziel_neu := new.dropoff_address is distinct from old.dropoff_address;
  if not v_abholung_neu and not v_ziel_neu then
    return new;
  end if;

  -- Alte Linie weg: Apps, die in den Sekunden bis zur neuen Route laden, rechnen sonst mit ihren Enden
  -- (CarPlay gab so die alte Abholung an Apple Karten). Ohne Linie rechnen sie selbst aus den Adressen.
  new.ext_route_polyline := null;

  if v_abholung_neu then
    if new.ext_route_payload is not null then
      new.ext_route_payload := new.ext_route_payload - 'von';
    end if;
    new.ext_driver_to_pickup_payload := null;
    new.ext_driver_to_pickup_distance_m := null;
    new.ext_driver_to_pickup_last_sync_at := null;

    -- Nur wenn die Dispo den Status nicht selbst im selben Speichern geaendert hat.
    if new.status is not distinct from old.status
       and public.trisar_norm_status(new.status) in ('at_pickup', 'pickup', 'beim_pickup', 'beim pickup') then
      v_status_neu := case when new.driver_id is not null then 'assigned' else 'pending' end;
      insert into public.job_status_history(job_id, from_status, to_status, source, meta)
      values (new.id, old.status, v_status_neu, 'adresse_neu',
              jsonb_build_object('driver_id', new.driver_id,
                                 'abholung_alt', old.pickup_address,
                                 'abholung_neu', new.pickup_address));
      -- jobs_status_protokoll soll denselben Wechsel nicht noch einmal als 'app' schreiben.
      perform set_config('trisar.status_protokolliert', new.id::text, true);
      new.status := v_status_neu;
    end if;
  end if;

  if v_ziel_neu then
    if new.ext_route_payload is not null then
      new.ext_route_payload := new.ext_route_payload - 'nach';
    end if;
    new.ext_driver_to_dropoff_payload := null;
    new.ext_driver_to_dropoff_distance_m := null;
    new.ext_driver_to_dropoff_last_sync_at := null;
  end if;

  -- Zaehler der Statusregel gehoeren zur alten Adresse.
  update public.job_status_runtime
  set pickup_exit_hits = case when v_abholung_neu then 0 else pickup_exit_hits end,
      dropoff_near_hits = case when v_ziel_neu then 0 else dropoff_near_hits end,
      last_pickup_distance_m = case when v_abholung_neu then null else last_pickup_distance_m end,
      last_dropoff_distance_m = case when v_ziel_neu then null else last_dropoff_distance_m end,
      updated_at = now()
  where job_id = new.id;

  return new;
end;
$function$;

-- Ohne Spaltenliste: auch Adressen, die ein anderer BEFORE-Trigger setzt, zaehlen.
-- Name mit "b": laeuft nach trg_jobs_a_start_fahrerstandort und vor trg_jobs_ort_zuordnen.
drop trigger if exists trg_jobs_b_adresse_neu on public.jobs;
create trigger trg_jobs_b_adresse_neu
  before update on public.jobs
  for each row execute function public.trisar_jobs_adresse_neu();
