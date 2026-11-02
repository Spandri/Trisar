-- Fügt eine dedizierte Spalte für anonyme Gäste zur jobs-Tabelle hinzu.
-- Diese Spalte speichert die Anzahl der namentlich unbekannten Fahrgäste.
-- Idempotent: IF NOT EXISTS verhindert Fehler bei wiederholter Ausführung.

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS anonymous_guests INTEGER DEFAULT 0;
