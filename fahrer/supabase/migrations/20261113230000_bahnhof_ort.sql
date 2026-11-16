-- Bahnhofs-Speicher fuer train-validate (13.11.2026), nachgezogen zur Dienstreise.
-- Koordinaten der Bahnhoefe (train-validate, Strecke auf der Karte): jeder Bahnhof nur einmal bei der
-- Bahn abfragen (Grenze 60 Aufrufe je Minute). Nur die Funktion schreibt (service_role), keine Policies.
create table if not exists public.bahnhof_ort (
  schluessel text primary key,
  name text not null,
  eva text,
  lat double precision,
  lng double precision,
  aktualisiert timestamptz not null default now()
);
alter table public.bahnhof_ort enable row level security;
