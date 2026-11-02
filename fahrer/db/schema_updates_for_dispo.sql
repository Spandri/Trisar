-- Erweiterungen für Dispo/Fahrer Funktionen

-- 1) Fahrzeuge erweitern
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS color TEXT,
  ADD COLUMN IF NOT EXISTS seat_count INT;

-- 2) Fahrer <-> Auto Match (ein aktuelles Auto pro Fahrer)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES vehicles(id) ON DELETE SET NULL;

-- 3) Falls avatar_url noch nicht existiert (bei dir vermutlich schon vorhanden)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 4) Kolonnen-Zuweisung: welcher Fahrer hat welche Gäste in einer Job-Kolonne
CREATE TABLE IF NOT EXISTS convoy_assignments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  driver_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  guest_ids UUID[] DEFAULT '{}',
  guest_names TEXT[] DEFAULT '{}',
  response_status TEXT DEFAULT 'pending',
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (job_id, driver_id)
);

ALTER TABLE convoy_assignments
  ADD COLUMN IF NOT EXISTS guest_names TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS response_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refusal_reason TEXT;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS ride_date DATE DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS refusal_reason TEXT,
  ADD COLUMN IF NOT EXISTS refused_by_driver_id UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS driver_response_status TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS driver_responded_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_convoy_assignments_job_id ON convoy_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_convoy_assignments_driver_id ON convoy_assignments(driver_id);

-- 5) Chat-Lesebestätigung pro Nutzer und Chat
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  chat_type TEXT NOT NULL CHECK (chat_type IN ('group', 'direct')),
  chat_id UUID NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, chat_type, chat_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_reads_chat ON chat_reads(chat_type, chat_id);

-- 5) Optional: Status-Standardisierung (wenn gewünscht)
-- UPDATE jobs SET status = 'cancelled' WHERE status = 'canceled';
-- ALTER TABLE jobs ADD CONSTRAINT jobs_status_check
-- CHECK (status IN ('pending', 'assigned', 'in_progress', 'done', 'cancelled'));
