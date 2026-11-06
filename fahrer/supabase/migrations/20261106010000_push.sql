-- Push-Mitteilungen fuer Fahrer- und Dispo-App (iOS ueber APNs, Android ueber FCM).
--
-- Ablauf: Ausloeser auf den Fachtabellen schreiben Mitteilungen in push_ausgang.
-- Der Sende-Dienst (admin/scripts/push-dienst.js) holt sie dort ab, schickt sie an die
-- Geraete aus push_geraete und ruft jede Minute push_erinnerungen() fuer die
-- zeitgesteuerten Erinnerungen auf. Wer etwas selbst ausloest (auth.uid()), bekommt
-- dazu keine Mitteilung. Abgeschaltete Arten stehen je Konto in push_einstellungen.

-- Geraete ---------------------------------------------------------------------

create table if not exists public.push_geraete (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plattform text not null check (plattform in ('ios', 'android')),
  app text not null check (app in ('fahrer', 'dispo')),
  aktualisiert timestamptz not null default now()
);
create index if not exists push_geraete_user_idx on public.push_geraete (user_id);
alter table public.push_geraete enable row level security;

drop policy if exists push_geraete_eigene on public.push_geraete;
create policy push_geraete_eigene on public.push_geraete
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Ein Token gehoert immer nur dem zuletzt angemeldeten Konto (Geraet wird weitergegeben).
create or replace function public.push_geraet_melden(p_token text, p_plattform text, p_app text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or coalesce(p_token, '') = '' then
    return;
  end if;
  insert into public.push_geraete (token, user_id, plattform, app, aktualisiert)
  values (p_token, auth.uid(), p_plattform, p_app, now())
  on conflict (token) do update
    set user_id = excluded.user_id, plattform = excluded.plattform, app = excluded.app, aktualisiert = now();
end;
$$;
grant execute on function public.push_geraet_melden(text, text, text) to authenticated;

-- Einstellungen ----------------------------------------------------------------

create table if not exists public.push_einstellungen (
  user_id uuid primary key references auth.users(id) on delete cascade,
  aus text[] not null default '{}',
  aktualisiert timestamptz not null default now()
);
alter table public.push_einstellungen enable row level security;

drop policy if exists push_einstellungen_eigene on public.push_einstellungen;
create policy push_einstellungen_eigene on public.push_einstellungen
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Ausgang ----------------------------------------------------------------------

create table if not exists public.push_ausgang (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  app text not null default 'fahrer',
  art text not null,
  titel text not null,
  text text not null,
  daten jsonb not null default '{}'::jsonb,
  erstellt timestamptz not null default now(),
  gesendet timestamptz,
  versuche int not null default 0,
  fehler text
);
create index if not exists push_ausgang_offen_idx on public.push_ausgang (erstellt) where gesendet is null;
-- Nur der Sende-Dienst (service_role) liest und schreibt hier.
alter table public.push_ausgang enable row level security;

-- Merkt sich, welche Erinnerung schon verschickt wurde.
create table if not exists public.push_erinnert (
  schluessel text primary key,
  erstellt timestamptz not null default now()
);
alter table public.push_erinnert enable row level security;

-- Hilfsfunktionen --------------------------------------------------------------

create or replace function public.push_melden(
  p_empfaenger uuid, p_app text, p_art text, p_titel text, p_text text, p_daten jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_empfaenger is null then return; end if;
  -- Eigene Aenderungen nicht melden.
  if auth.uid() is not null and auth.uid() = p_empfaenger then return; end if;
  if exists (select 1 from public.push_einstellungen e where e.user_id = p_empfaenger and p_art = any(e.aus)) then
    return;
  end if;
  insert into public.push_ausgang (user_id, app, art, titel, text, daten)
  values (p_empfaenger, p_app, p_art, p_titel, p_text, coalesce(p_daten, '{}'::jsonb));
end;
$$;

-- Alle Dispo-Konten (gleiche Rollen wie ist_dispo()).
create or replace function public.push_dispo_konten()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from public.profiles p
  where coalesce(p.is_dispo, false)
     or lower(coalesce(p.role, '')) in ('dispo', 'dispatcher', 'admin', 'koordinator', 'coordinator');
$$;

-- Fahrer einer Fahrt: zugeteilter Fahrer und Kolonnen-Fahrer (ohne Absagen).
create or replace function public.push_fahrer_der_fahrt(p_job uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select j.driver_id from public.jobs j where j.id = p_job and j.driver_id is not null
  union
  select c.driver_id from public.convoy_assignments c
  where c.job_id = p_job and c.driver_id is not null and coalesce(c.response_status, '') <> 'refused';
$$;

-- "Fr 06.11. 09:45 · Hotel Bayerischer Hof → BMW Welt"
create or replace function public.push_fahrt_text(j public.jobs)
returns text
language sql
stable
set search_path = public
as $$
  select concat_ws(' ',
    case extract(isodow from j.ride_date)::int
      when 1 then 'Mo' when 2 then 'Di' when 3 then 'Mi' when 4 then 'Do'
      when 5 then 'Fr' when 6 then 'Sa' when 7 then 'So' else null end,
    to_char(j.ride_date, 'DD.MM.'),
    to_char(j.etd, 'HH24:MI'),
    '·',
    coalesce(nullif(trim(split_part(j.pickup_name, ',', 1)), ''), nullif(trim(split_part(j.pickup_address, ',', 1)), ''), '?'),
    '→',
    coalesce(nullif(trim(split_part(j.dropoff_name, ',', 1)), ''), nullif(trim(split_part(j.dropoff_address, ',', 1)), ''), '?')
  );
$$;

create or replace function public.push_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(concat_ws(' ', p.first_name, p.last_name)), ''), 'Fahrer')
  from public.profiles p where p.id = p_user;
$$;

-- Zeitpunkt aus ISO-Text ohne Fehler bei Muell.
create or replace function public.push_zeit(p_text text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if coalesce(p_text, '') = '' then return null; end if;
  return p_text::timestamptz;
exception when others then
  return null;
end;
$$;

-- Fahrten ----------------------------------------------------------------------

create or replace function public.push_jobs_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fahrt text;
  daten jsonb;
  f uuid;
  d uuid;
  aenderungen text[] := '{}';
  alt_s jsonb;
  neu_s jsonb;
  alt_eta timestamptz;
  neu_eta timestamptz;
  flug text;
  status_neu text;
  status_alt text;
  storno boolean;
begin
  fahrt := public.push_fahrt_text(new);
  daten := jsonb_build_object('ziel', 'fahrt', 'job_id', new.id);

  if tg_op = 'INSERT' then
    if new.driver_id is not null then
      perform public.push_melden(new.driver_id, 'fahrer', 'fahrt_neu', 'Neue Fahrt', fahrt || '. Bitte annehmen.', daten);
    end if;
    return new;
  end if;

  storno := lower(coalesce(new.status, '')) in ('cancelled', 'canceled', 'storniert');

  -- Fahrer gewechselt
  if new.driver_id is distinct from old.driver_id then
    if new.driver_id is not null and not storno then
      perform public.push_melden(new.driver_id, 'fahrer', 'fahrt_neu', 'Neue Fahrt', fahrt || '. Bitte annehmen.', daten);
    end if;
    if old.driver_id is not null and lower(coalesce(new.status, '')) <> 'refused' then
      perform public.push_melden(old.driver_id, 'fahrer', 'fahrt_entzogen', 'Fahrt entzogen',
        fahrt || ' ist dir nicht mehr zugeteilt.', jsonb_build_object('ziel', 'liste'));
    end if;
  end if;

  -- Storniert
  if storno and lower(coalesce(old.status, '')) not in ('cancelled', 'canceled', 'storniert') then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'fahrt_storniert', 'Fahrt storniert', fahrt || ' wurde storniert.',
        jsonb_build_object('ziel', 'liste'));
    end loop;
    return new;
  end if;

  -- Fahrdaten geaendert. Eine reine ETD-Verschiebung durch den Flugabgleich meldet der Flug-Teil.
  if new.ride_date is distinct from old.ride_date then aenderungen := array_append(aenderungen, 'Datum'); end if;
  if new.etd is distinct from old.etd
     and not (new.ext_flight_payload is distinct from old.ext_flight_payload) then
    aenderungen := array_append(aenderungen, 'Zeit ' || coalesce(to_char(old.etd, 'HH24:MI'), '–') || ' → ' || coalesce(to_char(new.etd, 'HH24:MI'), '–'));
  end if;
  if new.pickup_name is distinct from old.pickup_name or new.pickup_address is distinct from old.pickup_address then
    aenderungen := array_append(aenderungen, 'Abholort');
  end if;
  if new.dropoff_name is distinct from old.dropoff_name or new.dropoff_address is distinct from old.dropoff_address then
    aenderungen := array_append(aenderungen, 'Ziel');
  end if;
  if new.flight_number is distinct from old.flight_number then aenderungen := array_append(aenderungen, 'Flugnummer'); end if;
  if new.train_number is distinct from old.train_number then aenderungen := array_append(aenderungen, 'Zugnummer'); end if;
  if cardinality(aenderungen) > 0 and new.driver_id is not distinct from old.driver_id then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'fahrt_geaendert', 'Fahrt geändert',
        fahrt || ': ' || array_to_string(aenderungen, ', ') || '.', daten);
    end loop;
  end if;

  -- Gaeste und Merkmale
  if (new.passengers is distinct from old.passengers or new.anonymous_guests is distinct from old.anonymous_guests
      or new.is_vip is distinct from old.is_vip or new.needs_child_seat is distinct from old.needs_child_seat
      or new.needs_accessibility is distinct from old.needs_accessibility or new.needs_luggage is distinct from old.needs_luggage)
     and new.driver_id is not distinct from old.driver_id then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'gaeste_geaendert', 'Gäste geändert',
        fahrt || ': Gäste oder Hinweise (VIP, Kindersitz, Rollstuhl, Gepäck) wurden angepasst.', daten);
    end loop;
  end if;

  -- Anderes Fahrzeug fuer die Fahrt
  if new.vehicle_id is distinct from old.vehicle_id and new.vehicle_id is not null then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'fahrt_fahrzeug', 'Anderes Fahrzeug',
        fahrt || ' jetzt mit ' || coalesce((select v.license_plate from public.vehicles v where v.id = new.vehicle_id), 'anderem Fahrzeug') || '.',
        daten);
    end loop;
  end if;

  -- Flug: Status und erwartete Ankunft
  if new.ext_flight_payload is distinct from old.ext_flight_payload then
    alt_s := coalesce(old.ext_flight_payload -> 'summary', '{}'::jsonb);
    neu_s := coalesce(new.ext_flight_payload -> 'summary', '{}'::jsonb);
    flug := coalesce(nullif(trim(new.flight_number), ''), 'Flug');
    status_alt := upper(coalesce(alt_s ->> 'flight_status_code', ''));
    status_neu := upper(coalesce(neu_s ->> 'flight_status_code', ''));
    if status_neu <> status_alt and status_neu = 'LD' then
      for f in select public.push_fahrer_der_fahrt(new.id) loop
        perform public.push_melden(f, 'fahrer', 'flug_gelandet', flug || ' gelandet', fahrt || '.', daten);
      end loop;
    elsif status_neu <> status_alt and status_neu = 'CD' then
      for f in select public.push_fahrer_der_fahrt(new.id) loop
        perform public.push_melden(f, 'fahrer', 'flug_annulliert', flug || ' annulliert', fahrt || '. Bitte bei der Dispo melden.', daten);
      end loop;
    elsif status_neu <> status_alt and status_neu in ('RT', 'DV') then
      for f in select public.push_fahrer_der_fahrt(new.id) loop
        perform public.push_melden(f, 'fahrer', 'flug_umgeleitet', flug || ' umgeleitet', fahrt || '. Bitte bei der Dispo melden.', daten);
      end loop;
    else
      alt_eta := coalesce(public.push_zeit(alt_s ->> 'estimated_arrival_local'), public.push_zeit(alt_s ->> 'scheduled_arrival_local'));
      neu_eta := coalesce(public.push_zeit(neu_s ->> 'estimated_arrival_local'), public.push_zeit(neu_s ->> 'scheduled_arrival_local'));
      if alt_eta is not null and neu_eta is not null and abs(extract(epoch from neu_eta - alt_eta)) >= 600 then
        for f in select public.push_fahrer_der_fahrt(new.id) loop
          perform public.push_melden(f, 'fahrer', 'flug_zeit',
            flug || case when neu_eta > alt_eta then ' später' else ' früher' end,
            flug || ' landet ' || abs(round(extract(epoch from neu_eta - alt_eta) / 60))::int || ' min '
              || case when neu_eta > alt_eta then 'später' else 'früher' end
              || coalesce(', neue ETD ' || to_char(new.etd, 'HH24:MI'), '') || '. ' || fahrt || '.',
            daten);
        end loop;
      end if;
    end if;
  end if;

  -- Zug: Prognose verschiebt sich um mindestens 10 Minuten
  if new.train_predicted_time is distinct from old.train_predicted_time
     and new.train_predicted_time is not null
     and abs(extract(epoch from new.train_predicted_time - coalesce(old.train_predicted_time, new.train_planned_time, new.train_predicted_time))) >= 600 then
    for f in select public.push_fahrer_der_fahrt(new.id) loop
      perform public.push_melden(f, 'fahrer', 'zug_zeit', coalesce(nullif(trim(new.train_number), ''), 'Zug') || ' verspätet',
        'Neue Ankunft ' || to_char(new.train_predicted_time, 'HH24:MI')
          || coalesce(' (Plan ' || to_char(new.train_planned_time, 'HH24:MI') || ')', '') || '. ' || fahrt || '.',
        daten);
    end loop;
  end if;

  -- Dispo: Antwort des Fahrers
  if new.driver_response_status is distinct from old.driver_response_status
     and lower(coalesce(new.driver_response_status, '')) in ('accepted', 'refused') then
    for d in select public.push_dispo_konten() loop
      if lower(new.driver_response_status) = 'refused' then
        perform public.push_melden(d, 'dispo', 'dispo_abgelehnt', 'Fahrt abgelehnt',
          public.push_name(coalesce(new.refused_by_driver_id, old.driver_id)) || ' hat ' || fahrt || ' abgelehnt'
            || coalesce(': ' || nullif(trim(new.refusal_reason), ''), '') || '.', daten);
      else
        perform public.push_melden(d, 'dispo', 'dispo_angenommen', 'Fahrt angenommen',
          public.push_name(new.driver_id) || ' hat ' || fahrt || ' angenommen.', daten);
      end if;
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists push_jobs on public.jobs;
create trigger push_jobs
  after insert or update on public.jobs
  for each row execute function public.push_jobs_ausloeser();

-- Kolonnen-Zuteilung -----------------------------------------------------------

create or replace function public.push_kolonne_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs;
  d uuid;
begin
  select * into j from public.jobs where id = coalesce(new.job_id, old.job_id);
  if j.id is null then return coalesce(new, old); end if;

  if tg_op = 'INSERT' then
    if new.driver_id is not null and new.driver_id is distinct from j.driver_id then
      perform public.push_melden(new.driver_id, 'fahrer', 'fahrt_neu', 'Neue Kolonnenfahrt',
        public.push_fahrt_text(j) || '. Bitte annehmen.', jsonb_build_object('ziel', 'fahrt', 'job_id', j.id));
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    if old.driver_id is not null and old.driver_id is distinct from j.driver_id
       and coalesce(old.response_status, '') <> 'refused' then
      perform public.push_melden(old.driver_id, 'fahrer', 'fahrt_entzogen', 'Fahrt entzogen',
        public.push_fahrt_text(j) || ' ist dir nicht mehr zugeteilt.', jsonb_build_object('ziel', 'liste'));
    end if;
    return old;
  end if;

  if new.response_status is distinct from old.response_status and new.response_status in ('accepted', 'refused') then
    for d in select public.push_dispo_konten() loop
      perform public.push_melden(d, 'dispo',
        case when new.response_status = 'refused' then 'dispo_abgelehnt' else 'dispo_angenommen' end,
        case when new.response_status = 'refused' then 'Kolonnenfahrt abgelehnt' else 'Kolonnenfahrt angenommen' end,
        public.push_name(new.driver_id) || ' hat ' || public.push_fahrt_text(j)
          || case when new.response_status = 'refused' then ' abgelehnt' || coalesce(': ' || nullif(trim(new.refusal_reason), ''), '') else ' angenommen' end || '.',
        jsonb_build_object('ziel', 'fahrt', 'job_id', j.id));
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists push_kolonne on public.convoy_assignments;
create trigger push_kolonne
  after insert or update or delete on public.convoy_assignments
  for each row execute function public.push_kolonne_ausloeser();

-- Kolonnen-Chat ----------------------------------------------------------------

create or replace function public.push_nachricht_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  f uuid;
  d uuid;
  absender text;
  kolonne text;
  vorschau text;
begin
  if new.target_type <> 'group' or new.target_id is null then return new; end if;
  absender := coalesce(public.push_name(new.sender_id), 'Jemand');
  kolonne := coalesce((select nullif(trim(c.name), '') from public.convoys c where c.id = new.target_id), 'Kolonne');
  vorschau := left(regexp_replace(coalesce(new.content, ''), '\s+', ' ', 'g'), 140);

  for f in
    select distinct x.id from (
      select j.driver_id as id from public.jobs j where j.convoy_id = new.target_id
      union
      select c.driver_id from public.convoy_assignments c join public.jobs j on j.id = c.job_id
      where j.convoy_id = new.target_id and coalesce(c.response_status, '') <> 'refused'
    ) x
    where x.id is not null and x.id <> new.sender_id
  loop
    perform public.push_melden(f, 'fahrer', 'chat', kolonne, absender || ': ' || vorschau,
      jsonb_build_object('ziel', 'chat', 'kolonne_id', new.target_id));
  end loop;

  for d in select public.push_dispo_konten() loop
    if d <> new.sender_id then
      perform public.push_melden(d, 'dispo', 'chat', kolonne, absender || ': ' || vorschau,
        jsonb_build_object('ziel', 'chat', 'kolonne_id', new.target_id));
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists push_nachricht on public.messages;
create trigger push_nachricht
  after insert on public.messages
  for each row execute function public.push_nachricht_ausloeser();

-- Notizen ----------------------------------------------------------------------

create or replace function public.push_notiz_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j public.jobs;
  f uuid;
begin
  select * into j from public.jobs where id = new.job_id;
  if j.id is null then return new; end if;
  for f in select public.push_fahrer_der_fahrt(j.id) loop
    perform public.push_melden(f, 'fahrer', 'notiz', 'Neue Notiz',
      left(regexp_replace(coalesce(new.note_text, ''), '\s+', ' ', 'g'), 160) || ' · ' || public.push_fahrt_text(j),
      jsonb_build_object('ziel', 'fahrt', 'job_id', j.id));
  end loop;
  return new;
end;
$$;

drop trigger if exists push_notiz on public.job_notes;
create trigger push_notiz
  after insert on public.job_notes
  for each row execute function public.push_notiz_ausloeser();

-- Dienstplan -------------------------------------------------------------------

create or replace function public.push_dienst_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  tag text;
  d uuid;
begin
  if tg_op = 'DELETE' then
    if lower(coalesce(old.status, '')) = 'pending' then
      perform public.push_melden(old.driver_id, 'fahrer', 'dienst_zurueck', 'Dienstanfrage zurückgezogen',
        'Der Dienst am ' || to_char(old.service_date, 'DD.MM.') || ' wurde zurückgezogen.', jsonb_build_object('ziel', 'liste'));
    end if;
    return old;
  end if;

  tag := to_char(new.service_date, 'DD.MM.') || ' ' || coalesce(to_char(new.service_start_time, 'HH24:MI'), '?')
    || '–' || coalesce(to_char(new.service_end_time, 'HH24:MI'), '?');

  if tg_op = 'INSERT' then
    perform public.push_melden(new.driver_id, 'fahrer', 'dienst_neu', 'Neue Dienstanfrage',
      'Dienst ' || tag || ', bitte bestätigen.', jsonb_build_object('ziel', 'liste'));
    return new;
  end if;

  if new.service_date is distinct from old.service_date or new.service_start_time is distinct from old.service_start_time
     or new.service_end_time is distinct from old.service_end_time then
    perform public.push_melden(new.driver_id, 'fahrer', 'dienst_geaendert', 'Dienst geändert',
      'Dein Dienst ist jetzt ' || tag || '.', jsonb_build_object('ziel', 'liste'));
  end if;

  if new.status is distinct from old.status and lower(coalesce(new.status, '')) in ('accepted', 'refused') then
    for d in select public.push_dispo_konten() loop
      perform public.push_melden(d, 'dispo',
        case when lower(new.status) = 'refused' then 'dispo_dienst_abgelehnt' else 'dispo_dienst_angenommen' end,
        case when lower(new.status) = 'refused' then 'Dienst abgelehnt' else 'Dienst bestätigt' end,
        public.push_name(new.driver_id) || case when lower(new.status) = 'refused' then ' hat den Dienst ' else ' hat den Dienst ' end
          || tag || case when lower(new.status) = 'refused' then ' abgelehnt.' else ' bestätigt.' end,
        jsonb_build_object('ziel', 'fahrer', 'user_id', new.driver_id));
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists push_dienst on public.driver_service_requests;
create trigger push_dienst
  after insert or update or delete on public.driver_service_requests
  for each row execute function public.push_dienst_ausloeser();

-- Fahrzeug des Fahrers -----------------------------------------------------------

create or replace function public.push_profil_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.vehicle_id is distinct from old.vehicle_id and new.vehicle_id is not null then
    perform public.push_melden(new.id, 'fahrer', 'fahrzeug_neu', 'Neues Fahrzeug',
      'Dir ist jetzt ' || coalesce((select v.license_plate from public.vehicles v where v.id = new.vehicle_id), 'ein neues Fahrzeug')
        || ' zugewiesen.', jsonb_build_object('ziel', 'fahrzeug'));
  end if;
  return new;
end;
$$;

drop trigger if exists push_profil on public.profiles;
create trigger push_profil
  after update of vehicle_id on public.profiles
  for each row execute function public.push_profil_ausloeser();

-- Schaeden (Dispo) -------------------------------------------------------------

create or replace function public.push_schaden_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d uuid;
begin
  for d in select public.push_dispo_konten() loop
    perform public.push_melden(d, 'dispo', 'dispo_schaden', 'Schaden gemeldet',
      coalesce((select v.license_plate from public.vehicles v where v.id = new.vehicle_id), 'Fahrzeug')
        || coalesce(': ' || nullif(trim(new.part_name), ''), '')
        || coalesce(' – ' || left(nullif(trim(new.description), ''), 120), ''),
      jsonb_build_object('ziel', 'fahrzeug', 'vehicle_id', new.vehicle_id));
  end loop;
  return new;
end;
$$;

drop trigger if exists push_schaden on public.vehicle_damages;
create trigger push_schaden
  after insert on public.vehicle_damages
  for each row execute function public.push_schaden_ausloeser();

-- Erinnerungen (ruft der Sende-Dienst jede Minute auf) --------------------------

create or replace function public.push_erinnerungen()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  j public.jobs;
  beginn timestamptz;
  f uuid;
  anzahl int := 0;
  jetzt timestamptz := now();
begin
  -- Fahrten mit Startzeitpunkt in Berliner Zeit
  for j in
    select * from public.jobs x
    where x.ride_date between (jetzt at time zone 'Europe/Berlin')::date - 1 and (jetzt at time zone 'Europe/Berlin')::date + 1
      and x.etd is not null
      and lower(coalesce(x.status, '')) not in ('cancelled', 'canceled', 'storniert', 'refused', 'done', 'completed', 'arrived')
  loop
    beginn := (j.ride_date + j.etd) at time zone 'Europe/Berlin';
    -- Noch nicht angenommen, 2 Stunden vorher
    if beginn - jetzt between interval '0 minutes' and interval '120 minutes'
       and j.driver_id is not null
       and lower(coalesce(j.driver_response_status, 'pending')) <> 'accepted'
       and not exists (select 1 from public.push_erinnert e where e.schluessel = 'offen:' || j.id) then
      insert into public.push_erinnert (schluessel) values ('offen:' || j.id);
      perform public.push_melden(j.driver_id, 'fahrer', 'erinnerung_offen', 'Fahrt noch nicht angenommen',
        public.push_fahrt_text(j) || '. Bitte annehmen oder ablehnen.', jsonb_build_object('ziel', 'fahrt', 'job_id', j.id));
      anzahl := anzahl + 1;
    end if;
    -- 30 Minuten vor Beginn
    if beginn - jetzt between interval '0 minutes' and interval '30 minutes'
       and not exists (select 1 from public.push_erinnert e where e.schluessel = 'beginn:' || j.id) then
      insert into public.push_erinnert (schluessel) values ('beginn:' || j.id);
      for f in select public.push_fahrer_der_fahrt(j.id) loop
        perform public.push_melden(f, 'fahrer', 'erinnerung_beginn', 'Fahrt beginnt bald',
          'In ' || greatest(1, round(extract(epoch from beginn - jetzt) / 60))::int || ' min: ' || public.push_fahrt_text(j) || '.',
          jsonb_build_object('ziel', 'fahrt', 'job_id', j.id));
      end loop;
      anzahl := anzahl + 1;
    end if;
  end loop;

  -- Dienstbeginn in 60 Minuten
  for r in
    select s.*, (s.service_date + s.service_start_time) at time zone 'Europe/Berlin' as beginn
    from public.driver_service_requests s
    where lower(coalesce(s.status, '')) = 'accepted'
      and s.service_start_time is not null
      and s.service_date between (jetzt at time zone 'Europe/Berlin')::date - 1 and (jetzt at time zone 'Europe/Berlin')::date + 1
  loop
    if r.beginn - jetzt between interval '0 minutes' and interval '60 minutes'
       and not exists (select 1 from public.push_erinnert e where e.schluessel = 'dienst:' || r.id) then
      insert into public.push_erinnert (schluessel) values ('dienst:' || r.id);
      perform public.push_melden(r.driver_id, 'fahrer', 'erinnerung_dienst', 'Dienst beginnt bald',
        'Dienstbeginn ' || to_char(r.service_start_time, 'HH24:MI') || ' (in '
          || greatest(1, round(extract(epoch from r.beginn - jetzt) / 60))::int || ' min).',
        jsonb_build_object('ziel', 'liste'));
      anzahl := anzahl + 1;
    end if;
  end loop;

  -- Alte Merker und alte Mitteilungen aufraeumen
  delete from public.push_erinnert where erstellt < jetzt - interval '3 days';
  delete from public.push_ausgang where erstellt < jetzt - interval '14 days';
  return anzahl;
end;
$$;

revoke all on function public.push_erinnerungen() from public, anon, authenticated;
revoke all on function public.push_melden(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
