-- Dienstreise mit Umstiegen und Ticket (14.11.2026).
--
--   dienstreise_abschnitt   je Abschnitt (Bus, U-Bahn, Zug, Flug ...): Nummer, von/nach, Zeiten, Gleise.
--                           Erster Abschnitt = Start der Dienstreise (start_* / zugnummer bleiben fuer
--                           aeltere App-Versionen gefuellt).
--   dienstreise.ticket_*    Ticket als PDF im Speicher dienstreise-tickets (privat). Lesen duerfen die
--                           Dispo und die eingetragenen Fahrer der Dienstreise.
--   dienstreise.reisender, auftragsnummer   aus dem Ticket gelesen (Ticket-Upload in der Dispo).

alter table public.dienstreise add column if not exists ticket_pfad text;
alter table public.dienstreise add column if not exists ticket_name text;
alter table public.dienstreise add column if not exists auftragsnummer text;
alter table public.dienstreise add column if not exists reisender text;

create table if not exists public.dienstreise_abschnitt (
  id uuid primary key default gen_random_uuid(),
  dienstreise_id uuid not null references public.dienstreise(id) on delete cascade,
  reihenfolge integer not null default 0,
  art text not null default 'zug',
  nummer text,
  von_name text not null,
  von_lat double precision,
  von_lng double precision,
  ab_datum date,
  ab_zeit time,
  gleis_ab text,
  nach_name text,
  nach_lat double precision,
  nach_lng double precision,
  an_datum date,
  an_zeit time,
  gleis_an text,
  hinweis text
);
create index if not exists dienstreise_abschnitt_reise on public.dienstreise_abschnitt (dienstreise_id, reihenfolge);

alter table public.dienstreise_abschnitt enable row level security;
drop policy if exists dienstreise_abschnitt_dispo on public.dienstreise_abschnitt;
create policy dienstreise_abschnitt_dispo on public.dienstreise_abschnitt for all to authenticated
  using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists dienstreise_abschnitt_fahrer on public.dienstreise_abschnitt;
create policy dienstreise_abschnitt_fahrer on public.dienstreise_abschnitt for select to authenticated
  using (exists (select 1 from public.dienstreise_fahrer f where f.dienstreise_id = dienstreise_abschnitt.dienstreise_id and f.driver_id = auth.uid()));
grant select, insert, update, delete on public.dienstreise_abschnitt to authenticated;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.dienstreise_abschnitt'; exception when others then null; end;
end $$;

-- Ticket-Ablage (privat, hoechstens 10 MB, nur PDF und Bilder).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dienstreise-tickets', 'dienstreise-tickets', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.apple.pkpass'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists dienstreise_tickets_dispo on storage.objects;
create policy dienstreise_tickets_dispo on storage.objects for all to authenticated
  using (bucket_id = 'dienstreise-tickets' and public.ist_dispo())
  with check (bucket_id = 'dienstreise-tickets' and public.ist_dispo());

-- Fahrer: nur Dateien im Ordner einer Dienstreise, auf der er eingetragen ist ("<dienstreise_id>/...").
drop policy if exists dienstreise_tickets_fahrer on storage.objects;
create policy dienstreise_tickets_fahrer on storage.objects for select to authenticated
  using (
    bucket_id = 'dienstreise-tickets'
    and exists (
      select 1 from public.dienstreise_fahrer f
       where f.driver_id = auth.uid()
         and f.dienstreise_id::text = split_part(storage.objects.name, '/', 1)
    )
  );
