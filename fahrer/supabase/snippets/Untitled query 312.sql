-- Ersetze passengers Text-Feld mit passengers JSONB
-- Speichere Gäste als JSON: {"guest_1": "Name", "guest_2": "Name", ...}

-- Lösche alte passengers Spalte
ALTER TABLE public.jobs DROP COLUMN IF EXISTS passengers;

-- Füge neue passengers JSONB Spalte hinzu
ALTER TABLE public.jobs
  ADD COLUMN passengers JSONB DEFAULT '{}'::jsonb;

