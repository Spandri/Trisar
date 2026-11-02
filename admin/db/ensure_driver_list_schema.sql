-- Mindest-Schema für Fahrer-Liste in der Koordinator-App

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'fahrer',
  ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_dispo BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS driver_number BIGINT;

CREATE SEQUENCE IF NOT EXISTS public.profiles_driver_number_seq;
ALTER SEQUENCE public.profiles_driver_number_seq OWNED BY public.profiles.driver_number;
ALTER TABLE public.profiles ALTER COLUMN driver_number SET DEFAULT nextval('public.profiles_driver_number_seq');

UPDATE public.profiles
SET driver_number = nextval('public.profiles_driver_number_seq')
WHERE driver_number IS NULL;

SELECT setval(
  'public.profiles_driver_number_seq',
  COALESCE((SELECT MAX(driver_number) FROM public.profiles), 0) + 1,
  false
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_driver_number_unique
ON public.profiles(driver_number)
WHERE driver_number IS NOT NULL;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS license_plate TEXT;
