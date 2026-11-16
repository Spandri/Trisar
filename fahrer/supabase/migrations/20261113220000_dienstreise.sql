-- Dienstreise (13.11.2026).
--
-- Die Dispo schickt bestimmten Fahrern eine Dienstreise: Datum, Startzeit, Start, Ziel, Zug- oder
-- Flugnummer, Notiz. Jeder Fahrer nimmt an oder lehnt ab (wie Standby). In der Fahrer-App sieht die
-- Dienstreise aus wie eine Fahrt. Abfahrt, Gleis, Ankunft und Strecke holt die App live ueber
-- train-validate bzw. flight-validate. In "verbindung" steht der Stand beim Anlegen (Rueckfall).
--
--   dienstreise          eine Dienstreise
--   dienstreise_fahrer   je Fahrer: Anfrage (pending/accepted/refused), beendet

create table if not exists public.dienstreise (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  start_zeit time not null,
  start_ort_id uuid,
  start_name text not null,
  start_adresse text,
  start_lat double precision,
  start_lng double precision,
  ziel_ort_id uuid,
  ziel_name text not null,
  ziel_adresse text,
  ziel_lat double precision,
  ziel_lng double precision,
  zugnummer text,
  flugnummer text,
  notiz text,
  verbindung jsonb,
  verbindung_stand timestamptz,
  erstellt_von uuid default auth.uid(),
  erstellt timestamptz not null default now(),
  geaendert timestamptz not null default now()
);
create index if not exists dienstreise_datum on public.dienstreise (datum);

create table if not exists public.dienstreise_fahrer (
  dienstreise_id uuid not null references public.dienstreise(id) on delete cascade,
  driver_id uuid not null,
  status text not null default 'pending',
  beendet timestamptz,
  aktualisiert timestamptz not null default now(),
  primary key (dienstreise_id, driver_id)
);
create index if not exists dienstreise_fahrer_driver on public.dienstreise_fahrer (driver_id);

alter table public.dienstreise enable row level security;
alter table public.dienstreise_fahrer enable row level security;

drop policy if exists dienstreise_dispo on public.dienstreise;
create policy dienstreise_dispo on public.dienstreise for all to authenticated using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists dienstreise_fahrer_lesen on public.dienstreise;
create policy dienstreise_fahrer_lesen on public.dienstreise for select to authenticated
  using (exists (select 1 from public.dienstreise_fahrer f where f.dienstreise_id = dienstreise.id and f.driver_id = auth.uid()));

drop policy if exists dienstreise_fahrer_dispo on public.dienstreise_fahrer;
create policy dienstreise_fahrer_dispo on public.dienstreise_fahrer for all to authenticated using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists dienstreise_fahrer_eigen on public.dienstreise_fahrer;
create policy dienstreise_fahrer_eigen on public.dienstreise_fahrer for select to authenticated using (driver_id = auth.uid());

grant select, insert, update, delete on public.dienstreise, public.dienstreise_fahrer to authenticated;

do $$
begin
  begin execute 'alter publication supabase_realtime add table public.dienstreise'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.dienstreise_fahrer'; exception when others then null; end;
end $$;

-- Push bei Anfrage, Rueckzug und Antwort.
create or replace function public.dienstreise_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d record;
  beschreibung text;
  k uuid;
begin
  select * into d from public.dienstreise where id = coalesce(new.dienstreise_id, old.dienstreise_id);
  if not found then
    return coalesce(new, old);
  end if;
  beschreibung := d.start_name || ' → ' || d.ziel_name || ' ' || to_char(d.datum, 'DD.MM.') || ' ' || to_char(d.start_zeit, 'HH24:MI')
    || coalesce(' · ' || nullif(coalesce(d.zugnummer, d.flugnummer), ''), '');
  if tg_op = 'INSERT' then
    perform public.push_melden(new.driver_id, 'fahrer', 'dienstreise_neu', 'Dienstreise', 'Dienstreise ' || beschreibung || ', bitte bestätigen.', jsonb_build_object('ziel', 'liste'));
  elsif tg_op = 'DELETE' then
    perform public.push_melden(old.driver_id, 'fahrer', 'dienstreise_zurueck', 'Dienstreise zurückgezogen', 'Dienstreise ' || beschreibung || ' wurde zurückgezogen.', jsonb_build_object('ziel', 'liste'));
    return old;
  elsif new.status is distinct from old.status and new.status in ('accepted', 'refused') then
    for k in select public.push_dispo_konten() loop
      perform public.push_melden(k, 'dispo', case when new.status = 'refused' then 'dispo_dienstreise_abgelehnt' else 'dispo_dienstreise_angenommen' end,
        case when new.status = 'refused' then 'Dienstreise abgelehnt' else 'Dienstreise bestätigt' end,
        public.push_name(new.driver_id) || ' hat die Dienstreise ' || beschreibung
          || case when new.status = 'refused' then ' abgelehnt.' else ' bestätigt.' end,
        jsonb_build_object('ziel', 'fahrer', 'user_id', new.driver_id));
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dienstreise_push on public.dienstreise_fahrer;
create trigger trg_dienstreise_push
  after insert or update of status or delete on public.dienstreise_fahrer
  for each row execute function public.dienstreise_push();

-- Dienstreise geaendert (Zeit, Start, Ziel, Verbindung): angenommene Fahrer bestaetigen neu.
create or replace function public.dienstreise_geaendert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.datum is not distinct from old.datum and new.start_zeit is not distinct from old.start_zeit
     and new.start_name is not distinct from old.start_name and new.ziel_name is not distinct from old.ziel_name
     and new.zugnummer is not distinct from old.zugnummer and new.flugnummer is not distinct from old.flugnummer then
    return new;
  end if;
  new.geaendert := now();
  update public.dienstreise_fahrer set status = 'pending', aktualisiert = now()
   where dienstreise_id = new.id and status = 'accepted';
  perform public.push_melden(f.driver_id, 'fahrer', 'dienstreise_geaendert', 'Dienstreise geändert',
    'Dienstreise ' || new.start_name || ' → ' || new.ziel_name || ' jetzt ' || to_char(new.datum, 'DD.MM.') || ' ' || to_char(new.start_zeit, 'HH24:MI') || ', bitte bestätigen.',
    jsonb_build_object('ziel', 'liste'))
  from public.dienstreise_fahrer f where f.dienstreise_id = new.id and f.status = 'pending';
  return new;
end;
$$;

drop trigger if exists trg_dienstreise_geaendert on public.dienstreise;
create trigger trg_dienstreise_geaendert
  before update on public.dienstreise
  for each row execute function public.dienstreise_geaendert();

-- Antwort des Fahrers.
create or replace function public.dienstreise_antworten(p_dienstreise uuid, p_annehmen boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dienstreise_fahrer
     set status = case when p_annehmen then 'accepted' else 'refused' end, aktualisiert = now()
   where dienstreise_id = p_dienstreise and driver_id = auth.uid();
  if not found then
    raise exception 'kein Zugriff';
  end if;
  return case when p_annehmen then 'accepted' else 'refused' end;
end;
$$;
revoke all on function public.dienstreise_antworten(uuid, boolean) from public, anon;
grant execute on function public.dienstreise_antworten(uuid, boolean) to authenticated;

-- Fahrer beendet die Dienstreise (Knopf "Dienstreise beenden").
create or replace function public.dienstreise_beenden(p_dienstreise uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dienstreise_fahrer set beendet = now(), aktualisiert = now()
   where dienstreise_id = p_dienstreise and driver_id = auth.uid() and status = 'accepted';
  if not found then
    raise exception 'kein Zugriff';
  end if;
end;
$$;
revoke all on function public.dienstreise_beenden(uuid) from public, anon;
grant execute on function public.dienstreise_beenden(uuid) to authenticated;

