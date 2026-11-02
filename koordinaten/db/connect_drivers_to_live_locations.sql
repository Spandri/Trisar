-- Verknuepft Fahrer-Profile mit driver_live_locations ueber driver_id.
-- 1) Backfill fuer bestehende Fahrer ohne Live-Location-Zeile
-- 2) Trigger fuer neue Fahrer in profiles
--
-- Hinweis:
-- lat/lng sind in driver_live_locations NOT NULL, daher wird ein Startpunkt gesetzt.
-- Werte koennen spaeter vom Fahrer-Client mit echten GPS-Daten ueberschrieben werden.

-- 1) Backfill
INSERT INTO public.driver_live_locations (
  driver_id,
  lat,
  lng,
  source,
  captured_at
)
SELECT
  p.id,
  48.137154,
  11.576124,
  'bootstrap',
  now()
FROM public.profiles p
LEFT JOIN public.driver_live_locations dll
  ON dll.driver_id = p.id
WHERE dll.driver_id IS NULL
  AND COALESCE(p.is_dispo, false) = false
  AND COALESCE(lower(p.role), 'fahrer') NOT IN ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator');

-- 2) Trigger-Funktion fuer neue Fahrer
CREATE OR REPLACE FUNCTION public.trisar_ensure_driver_live_location()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.is_dispo, false) = false
     AND COALESCE(lower(NEW.role), 'fahrer') NOT IN ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator') THEN
    INSERT INTO public.driver_live_locations (
      driver_id,
      lat,
      lng,
      source,
      captured_at
    )
    VALUES (
      NEW.id,
      48.137154,
      11.576124,
      'bootstrap',
      now()
    )
    ON CONFLICT (driver_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_ensure_driver_live_location ON public.profiles;
CREATE TRIGGER trg_profiles_ensure_driver_live_location
AFTER INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.trisar_ensure_driver_live_location();
