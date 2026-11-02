-- Spalten, die die seit August in der Demo gebauten Funktionen erwarten.
-- Nur Ergaenzungen (add column if not exists), keine bestehenden Daten werden geaendert.

-- Fahrt wurde ueber den KI-Assistenten gebucht (Admin: Fahrt anlegen/bearbeiten).
alter table if exists public.jobs
  add column if not exists ai_booked boolean not null default false;

-- Wer die Fahrt vergeben hat. 'trisar-engine' markiert Vergaben des Planers,
-- damit ein neuer Planlauf seine frueheren Vergaben wieder oeffnen kann.
alter table if exists public.jobs
  add column if not exists assigned_by text;

create index if not exists jobs_ride_date_assigned_by_idx
  on public.jobs (ride_date, assigned_by);

-- Notizen zur Fahrt mit Autor (Fahrer-App: Notiz senden und anzeigen).
alter table if exists public.job_notes
  add column if not exists author_name text;

-- Schadensmeldung mit Fotos aus der Fahrer-App.
alter table if exists public.vehicle_damages
  add column if not exists image_url text,
  add column if not exists image_urls text[] not null default '{}',
  add column if not exists reported_by_driver boolean not null default false;
