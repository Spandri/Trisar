-- Protokoll des KI-Assistenten: jede Frage mit erkannter Absicht, Antwort und Dauer.
-- Zweck: echte Fehler finden und daraus den Testsatz (werkzeuge/ki-test) erweitern.
-- Schreibt nur der Server (dispo-admin, ki_frage) mit dem Service-Schluessel, lesen darf nur die Dispo.
-- Eintraege aelter als 30 Tage loescht ki_frage selbst (Fragen enthalten Namen von Gaesten und Fahrern).

create table if not exists public.ki_protokoll (
  id uuid primary key default gen_random_uuid(),
  erstellt timestamptz not null default now(),
  dispo_id uuid references public.profiles(id) on delete set null,
  frage text not null,
  -- dienst_vorschlag, fahrt_buchen, fahrt_aendern, rueckfrage, antwort, nicht_erreichbar, fehler
  art text not null,
  antwort text,
  aktion jsonb,
  dauer_ms integer,
  modell text,
  fehler text
);
create index if not exists ki_protokoll_erstellt_idx on public.ki_protokoll(erstellt desc);

alter table public.ki_protokoll enable row level security;
drop policy if exists ki_protokoll_dispo_lesen on public.ki_protokoll;
create policy ki_protokoll_dispo_lesen on public.ki_protokoll for select using (public.ist_dispo());
