ALTER TABLE public.jobs
  ADD COLUMN drivers JSONB DEFAULT '{}'::jsonb;

-- Migriere alte driver_id Werte in neue drivers Spalte
UPDATE public.jobs
  SET drivers = CASE 
    WHEN driver_id IS NOT NULL THEN jsonb_build_object('driver_1', driver_id::text)
    ELSE '{}'::jsonb
  END
  WHERE driver_id IS NOT NULL;