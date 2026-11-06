-- Excel-/CSV-Import: jeder Import ist ein Stapel, damit er sich rueckgaengig machen laesst,
-- und eine einmal geprüfte Spaltenzuordnung wird je Tabellenaufbau gemerkt (Vorlage).
-- Beide Tabellen liest und schreibt nur die Funktion dispo-admin (service_role).

create table if not exists public.imports (
  id uuid primary key default gen_random_uuid(),
  modus text not null check (modus in ('rides', 'guests')),
  dateiname text,
  anzahl integer not null default 0,
  erstellt_von uuid references public.profiles(id) on delete set null,
  erstellt timestamptz not null default now(),
  rueckgaengig timestamptz
);

create table if not exists public.import_vorlagen (
  modus text not null check (modus in ('rides', 'guests')),
  -- Normalisierte Ueberschriften der Tabelle, sortiert und verbunden.
  signatur text not null,
  -- { "<Ueberschrift normalisiert>": "<Feld>" }, damit die Spaltenreihenfolge egal ist.
  zuordnung jsonb not null,
  name text,
  genutzt integer not null default 1,
  aktualisiert timestamptz not null default now(),
  primary key (modus, signatur)
);

alter table public.imports enable row level security;
alter table public.import_vorlagen enable row level security;

alter table public.jobs add column if not exists import_id uuid references public.imports(id) on delete set null;
alter table public.guests add column if not exists import_id uuid references public.imports(id) on delete set null;
create index if not exists jobs_import_id_idx on public.jobs(import_id) where import_id is not null;
create index if not exists guests_import_id_idx on public.guests(import_id) where import_id is not null;
