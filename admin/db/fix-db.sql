-- ============================================================
-- QUICK FIX für koordinaten-app-lokal Datenbank
-- ============================================================
-- Dieses Script erstellt alle nötigen Tabellen und Test-Daten
-- Ausführen mit: psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f fix-db.sql

-- 1. Jobs-Tabelle erstellen
CREATE TABLE IF NOT EXISTS public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID,
  vehicle_id UUID,
  convoy_id UUID,
  trip_type TEXT DEFAULT 'normal',
  pickup_name TEXT,
  pickup_address TEXT NOT NULL,
  dropoff_name TEXT,
  dropoff_address TEXT NOT NULL,
  ride_date DATE DEFAULT CURRENT_DATE,
  etd TIME,
  original_etd TIME,
  flight_number TEXT,
  flight_origin TEXT,
  passengers TEXT[] NOT NULL DEFAULT '{}',
  waiting_time_mins INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  is_vip BOOLEAN DEFAULT false,
  needs_child_seat BOOLEAN DEFAULT false,
  needs_accessibility BOOLEAN DEFAULT false,
  needs_luggage BOOLEAN DEFAULT false,
  refusal_reason TEXT,
  refused_by_driver_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Profiles-Tabelle anpassen (falls noch nicht geschehen)
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS driver_number BIGINT,
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'fahrer',
  ADD COLUMN IF NOT EXISTS vehicle_id UUID,
  ADD COLUMN IF NOT EXISTS is_dispo BOOLEAN DEFAULT false;

-- 3. Weitere benötigte Tabellen
CREATE TABLE IF NOT EXISTS public.guests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.convoys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.job_guests (
  job_id UUID NOT NULL,
  guest_id UUID NOT NULL,
  is_main_contact BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (job_id, guest_id)
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_model TEXT,
  license_plate TEXT,
  status TEXT DEFAULT 'available',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. RLS für lokale Entwicklung deaktivieren
ALTER TABLE public.jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.guests DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.convoys DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_guests DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles DISABLE ROW LEVEL SECURITY;

-- 5. Test-Fahrer einfügen (falls noch nicht vorhanden)
INSERT INTO public.profiles (id, first_name, last_name, email, driver_number, role, is_dispo)
VALUES 
  (gen_random_uuid(), 'Max', 'Mustermann', 'max.mustermann@test.de', 1, 'fahrer', false),
  (gen_random_uuid(), 'Anna', 'Schmidt', 'anna.schmidt@test.de', 2, 'fahrer', false),
  (gen_random_uuid(), 'Peter', 'Müller', 'peter.mueller@test.de', 3, 'fahrer', false)
ON CONFLICT DO NOTHING;

-- 6. Test-Gäste einfügen
INSERT INTO public.guests (id, first_name, last_name, email)
VALUES 
  (gen_random_uuid(), 'Hans', 'Meier', 'hans.meier@example.com'),
  (gen_random_uuid(), 'Maria', 'Weber', 'maria.weber@example.com'),
  (gen_random_uuid(), 'Thomas', 'Fischer', 'thomas.fischer@example.com')
ON CONFLICT DO NOTHING;

-- 7. Test-Fahrzeuge einfügen
INSERT INTO public.vehicles (id, brand_model, license_plate, status)
VALUES 
  (gen_random_uuid(), 'Mercedes E-Klasse', 'M-AB 1234', 'available'),
  (gen_random_uuid(), 'BMW 5er', 'M-CD 5678', 'available'),
  (gen_random_uuid(), 'Audi A6', 'M-EF 9012', 'available')
ON CONFLICT DO NOTHING;

-- 8. Test-Fahrten für HEUTE einfügen
INSERT INTO public.jobs (
  pickup_name, 
  pickup_address, 
  dropoff_name, 
  dropoff_address, 
  ride_date, 
  etd, 
  status, 
  passengers,
  driver_id
)
SELECT
  'Flughafen München (MUC)',
  'Nordallee 25, 85356 München-Flughafen',
  'Hauptbahnhof München',
  'Bahnhofplatz 2, 80335 München',
  CURRENT_DATE,
  '14:30',
  'pending',
  ARRAY['Max Meier', 'Lisa Meier'],
  p.id
FROM public.profiles p
WHERE p.driver_number = 1
LIMIT 1
ON CONFLICT DO NOTHING;

INSERT INTO public.jobs (
  pickup_name, 
  pickup_address, 
  dropoff_name, 
  dropoff_address, 
  ride_date, 
  etd, 
  status, 
  passengers
)
VALUES 
  (
    'Hotel Marriott',
    'Berliner Str. 93, 80805 München',
    'Flughafen München (MUC)',
    'Nordallee 25, 85356 München-Flughafen',
    CURRENT_DATE,
    '09:00',
    'pending',
    ARRAY['Anna Schmidt']
  ),
  (
    'Hauptbahnhof München',
    'Bahnhofplatz 2, 80335 München',
    'Olympiapark',
    'Spiridon-Louis-Ring 21, 80809 München',
    CURRENT_DATE,
    '18:00',
    'pending',
    ARRAY['John Doe', 'Jane Doe']
  )
ON CONFLICT DO NOTHING;

-- 9. Test-Fahrten für MORGEN einfügen
INSERT INTO public.jobs (
  pickup_name, 
  pickup_address, 
  dropoff_name, 
  dropoff_address, 
  ride_date, 
  etd, 
  status, 
  passengers
)
VALUES 
  (
    'Flughafen München (MUC)',
    'Nordallee 25, 85356 München-Flughafen',
    'Hotel Bayerischer Hof',
    'Promenadeplatz 2-6, 80333 München',
    CURRENT_DATE + INTERVAL '1 day',
    '10:30',
    'pending',
    ARRAY['Robert Wilson']
  ),
  (
    'Hauptbahnhof München',
    'Bahnhofplatz 2, 80335 München',
    'Messe München',
    'Messegelände, 81823 München',
    CURRENT_DATE + INTERVAL '1 day',
    '15:00',
    'pending',
    ARRAY['Klaus Bauer', 'Petra Bauer', 'Tim Bauer']
  )
ON CONFLICT DO NOTHING;

-- 10. Test-Fahrt ohne Fahrer (sollte rot markiert sein)
INSERT INTO public.jobs (
  pickup_name, 
  pickup_address, 
  dropoff_name, 
  dropoff_address, 
  ride_date, 
  etd, 
  status, 
  passengers,
  driver_id
)
VALUES 
  (
    'Allianz Arena',
    'Werner-Heisenberg-Allee 25, 80939 München',
    'Hauptbahnhof München',
    'Bahnhofplatz 2, 80335 München',
    CURRENT_DATE,
    '22:00',
    'pending',
    ARRAY['Michael König'],
    NULL  -- Kein Fahrer zugewiesen
  )
ON CONFLICT DO NOTHING;

-- 11. Indizes erstellen für bessere Performance
CREATE INDEX IF NOT EXISTS idx_jobs_ride_date ON public.jobs(ride_date);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON public.jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_driver_id ON public.jobs(driver_id);
CREATE INDEX IF NOT EXISTS idx_profiles_driver_number ON public.profiles(driver_number);

-- ============================================================
-- Script erfolgreich abgeschlossen!
-- ============================================================

-- Überprüfung:
SELECT 
  'Jobs' as tabelle, 
  COUNT(*) as anzahl 
FROM public.jobs
UNION ALL
SELECT 
  'Profiles', 
  COUNT(*) 
FROM public.profiles
UNION ALL
SELECT 
  'Guests', 
  COUNT(*) 
FROM public.guests
UNION ALL
SELECT 
  'Vehicles', 
  COUNT(*) 
FROM public.vehicles;

-- Zeige die erstellten Jobs an:
SELECT 
  id,
  pickup_name,
  dropoff_name,
  ride_date,
  etd,
  status,
  array_length(passengers, 1) as passenger_count
FROM public.jobs
ORDER BY ride_date, etd;
