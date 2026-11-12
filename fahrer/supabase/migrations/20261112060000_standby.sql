-- Standby am Event-Ort (12.11.2026).
--
-- Die Dispo schickt bestimmten Fahrern "Standby an Ort X von ... bis ...". Am Event steigen nach und nach
-- unbekannte Gaeste ein, das Ziel kennt vorher niemand. Die Dispo soll sehen, wer vor Ort ist, wer mit
-- Gast unterwegs ist und wer auf dem Rueckweg ist.
--
--   standby          ein Standby: Ort (eigener Ort oder Adresse mit Koordinaten), Radius, Datum, von, bis
--   standby_fahrer   je Fahrer: Anfrage (pending/accepted/refused), Zustand, gemerkte Aenderung
--   standby_ereignis Verlauf je Fahrer: verlassen, gast_drin, abgesetzt, zurueck (Knopf oder automatisch)
--
-- Zustaende je Fahrer: geplant -> vor_ort -> mit_gast -> rueckweg -> vor_ort ...
-- Automatisch aus dem Live-Standort (driver_live_locations):
--   * innerhalb radius_rein_m             -> vor_ort
--   * vor_ort und ausserhalb radius_raus_m -> mit_gast (Gast eingestiegen)
--   * mit_gast: weitester Punkt wird gemerkt. Kommt der Fahrer 500 m naeher zurueck, war dort das
--     Absetzen -> rueckweg. Ein Halt mit Motor aus ist nicht noetig.
-- Knoepfe des Fahrers (standby_melden) setzen den Zustand sofort: gast_drin, abgesetzt, zurueck.
--
-- Aenderung von Zeiten an einem angenommenen Standby: der Fahrer bestaetigt nur die Aenderung. Lehnt er
-- ab, gelten fuer ihn die alten Zeiten (von_eigen/bis_eigen).

create table if not exists public.standby (
  id uuid primary key default gen_random_uuid(),
  datum date not null,
  von time not null,
  bis time not null,
  ort_id uuid,
  ort_name text not null,
  adresse text,
  lat double precision not null,
  lng double precision not null,
  radius_rein_m integer not null default 150,
  radius_raus_m integer not null default 300,
  notiz text,
  erstellt_von uuid default auth.uid(),
  erstellt timestamptz not null default now(),
  geaendert timestamptz not null default now()
);

create table if not exists public.standby_fahrer (
  standby_id uuid not null references public.standby(id) on delete cascade,
  driver_id uuid not null,
  status text not null default 'pending',
  vorher jsonb,
  von_eigen time,
  bis_eigen time,
  zustand text not null default 'geplant',
  zustand_seit timestamptz,
  max_abstand_m double precision,
  max_lat double precision,
  max_lng double precision,
  aktualisiert timestamptz not null default now(),
  primary key (standby_id, driver_id)
);
create index if not exists standby_fahrer_driver on public.standby_fahrer (driver_id);

create table if not exists public.standby_ereignis (
  id bigserial primary key,
  standby_id uuid not null references public.standby(id) on delete cascade,
  driver_id uuid not null,
  art text not null,
  zeit timestamptz not null default now(),
  lat double precision,
  lng double precision,
  quelle text not null default 'auto'
);
create index if not exists standby_ereignis_standby on public.standby_ereignis (standby_id, driver_id, zeit);

alter table public.standby enable row level security;
alter table public.standby_fahrer enable row level security;
alter table public.standby_ereignis enable row level security;

drop policy if exists standby_dispo on public.standby;
create policy standby_dispo on public.standby for all to authenticated using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists standby_fahrer_lesen on public.standby;
create policy standby_fahrer_lesen on public.standby for select to authenticated
  using (exists (select 1 from public.standby_fahrer f where f.standby_id = standby.id and f.driver_id = auth.uid()));

drop policy if exists standby_fahrer_dispo on public.standby_fahrer;
create policy standby_fahrer_dispo on public.standby_fahrer for all to authenticated using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists standby_fahrer_eigen on public.standby_fahrer;
create policy standby_fahrer_eigen on public.standby_fahrer for select to authenticated using (driver_id = auth.uid());

drop policy if exists standby_ereignis_dispo on public.standby_ereignis;
create policy standby_ereignis_dispo on public.standby_ereignis for all to authenticated using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists standby_ereignis_eigen on public.standby_ereignis;
create policy standby_ereignis_eigen on public.standby_ereignis for select to authenticated using (driver_id = auth.uid());

grant select, insert, update, delete on public.standby, public.standby_fahrer, public.standby_ereignis to authenticated;
grant usage, select on sequence public.standby_ereignis_id_seq to authenticated;

-- Realtime fuer Dispo-Uebersicht und Fahrer-App.
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.standby'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.standby_fahrer'; exception when others then null; end;
end $$;

-- Zeitpunkt HH:MM am Tag in Europe/Berlin.
create or replace function public.standby_zeitpunkt(p_tag date, p_zeit time)
returns timestamptz
language sql
immutable
as $$ select (p_tag + p_zeit) at time zone 'Europe/Berlin' $$;

-- Abstand in Metern (Haversine).
create or replace function public.standby_abstand_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)))
$$;

-- Push bei Anfrage, Aenderung, Rueckzug und Antwort.
create or replace function public.standby_push_fahrer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  text_ort text;
  k uuid;
begin
  select * into s from public.standby where id = coalesce(new.standby_id, old.standby_id);
  if not found then
    return coalesce(new, old);
  end if;
  text_ort := s.ort_name || ' ' || to_char(s.datum, 'DD.MM.') || ' ' || to_char(s.von, 'HH24:MI') || '–' || to_char(s.bis, 'HH24:MI');
  if tg_op = 'INSERT' then
    perform public.push_melden(new.driver_id, 'fahrer', 'standby_neu', 'Standby-Anfrage', 'Standby ' || text_ort || ', bitte bestätigen.', jsonb_build_object('ziel', 'liste'));
  elsif tg_op = 'DELETE' then
    perform public.push_melden(old.driver_id, 'fahrer', 'standby_zurueck', 'Standby zurückgezogen', 'Standby ' || text_ort || ' wurde zurückgezogen.', jsonb_build_object('ziel', 'liste'));
    return old;
  elsif new.status = 'accepted' and old.vorher is not null and (new.von_eigen is not null or new.bis_eigen is not null) then
    -- Aenderung abgelehnt: fuer diesen Fahrer gelten die alten Zeiten.
    for k in select public.push_dispo_konten() loop
      perform public.push_melden(k, 'dispo', 'dispo_standby_abgelehnt', 'Änderung abgelehnt',
        public.push_name(new.driver_id) || ' hat die Änderung am Standby ' || s.ort_name || ' abgelehnt. Für ihn gilt weiter '
          || to_char(new.von_eigen, 'HH24:MI') || '–' || to_char(new.bis_eigen, 'HH24:MI') || '.',
        jsonb_build_object('ziel', 'fahrer', 'user_id', new.driver_id));
    end loop;
  elsif new.status is distinct from old.status and new.status in ('accepted', 'refused') then
    for k in select public.push_dispo_konten() loop
      perform public.push_melden(k, 'dispo', case when new.status = 'refused' then 'dispo_standby_abgelehnt' else 'dispo_standby_angenommen' end,
        case when new.status = 'refused' then 'Standby abgelehnt' else 'Standby bestätigt' end,
        public.push_name(new.driver_id) || case when new.status = 'refused' then ' hat Standby ' else ' hat Standby ' end || text_ort
          || case when new.status = 'refused' then ' abgelehnt.' else ' bestätigt.' end,
        jsonb_build_object('ziel', 'fahrer', 'user_id', new.driver_id));
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_standby_push on public.standby_fahrer;
create trigger trg_standby_push
  after insert or update of status, von_eigen, bis_eigen or delete on public.standby_fahrer
  for each row execute function public.standby_push_fahrer();

-- Zeiten eines Standby geaendert: angenommene Fahrer bestaetigen nur die Aenderung.
create or replace function public.standby_zeiten_geaendert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.von is not distinct from old.von and new.bis is not distinct from old.bis
     and new.datum is not distinct from old.datum and new.lat is not distinct from old.lat and new.lng is not distinct from old.lng then
    return new;
  end if;
  new.geaendert := now();
  update public.standby_fahrer f
     set vorher = coalesce(f.vorher, jsonb_build_object('von', to_char(coalesce(f.von_eigen, old.von), 'HH24:MI'),
                                                        'bis', to_char(coalesce(f.bis_eigen, old.bis), 'HH24:MI'),
                                                        'ort_name', old.ort_name, 'datum', old.datum)),
         status = 'pending', von_eigen = null, bis_eigen = null, aktualisiert = now()
   where f.standby_id = new.id and f.status = 'accepted';
  update public.standby_fahrer f set von_eigen = null, bis_eigen = null where f.standby_id = new.id and f.status = 'pending';
  perform public.push_melden(f.driver_id, 'fahrer', 'standby_geaendert', 'Standby geändert',
    'Standby ' || new.ort_name || ' jetzt ' || to_char(new.von, 'HH24:MI') || '–' || to_char(new.bis, 'HH24:MI') || ', bitte bestätigen.',
    jsonb_build_object('ziel', 'liste'))
  from public.standby_fahrer f where f.standby_id = new.id and f.status = 'pending';
  return new;
end;
$$;

drop trigger if exists trg_standby_zeiten on public.standby;
create trigger trg_standby_zeiten
  before update on public.standby
  for each row execute function public.standby_zeiten_geaendert();

-- Antwort des Fahrers.
create or replace function public.standby_antworten(p_standby uuid, p_annehmen boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  select * into f from public.standby_fahrer where standby_id = p_standby and driver_id = auth.uid();
  if not found then
    raise exception 'kein Zugriff';
  end if;
  if p_annehmen then
    update public.standby_fahrer set status = 'accepted', vorher = null, aktualisiert = now()
     where standby_id = p_standby and driver_id = auth.uid();
    return 'accepted';
  end if;
  if f.vorher is null then
    update public.standby_fahrer set status = 'refused', aktualisiert = now()
     where standby_id = p_standby and driver_id = auth.uid();
    return 'refused';
  end if;
  -- Aenderung abgelehnt: fuer diesen Fahrer gelten die alten Zeiten.
  update public.standby_fahrer
     set status = 'accepted', von_eigen = nullif(f.vorher->>'von', '')::time, bis_eigen = nullif(f.vorher->>'bis', '')::time,
         vorher = null, aktualisiert = now()
   where standby_id = p_standby and driver_id = auth.uid();
  return 'zurueckgesetzt';
end;
$$;
revoke all on function public.standby_antworten(uuid, boolean) from public, anon;
grant execute on function public.standby_antworten(uuid, boolean) to authenticated;

-- Knopf des Fahrers: gast_drin, abgesetzt, zurueck ("Bei Standby").
create or replace function public.standby_melden(p_standby uuid, p_art text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
  p record;
  neu text;
begin
  if p_art not in ('gast_drin', 'abgesetzt', 'zurueck') then
    raise exception 'unbekannt';
  end if;
  select * into f from public.standby_fahrer where standby_id = p_standby and driver_id = auth.uid() and status = 'accepted';
  if not found then
    raise exception 'kein Zugriff';
  end if;
  select lat, lng into p from public.driver_live_locations where driver_id = auth.uid();
  neu := case p_art when 'gast_drin' then 'mit_gast' when 'abgesetzt' then 'rueckweg' else 'vor_ort' end;
  update public.standby_fahrer
     set zustand = neu, zustand_seit = now(), aktualisiert = now(),
         max_abstand_m = case when neu = 'mit_gast' then 0 else max_abstand_m end,
         max_lat = case when neu = 'mit_gast' then null else max_lat end,
         max_lng = case when neu = 'mit_gast' then null else max_lng end
   where standby_id = p_standby and driver_id = auth.uid();
  insert into public.standby_ereignis (standby_id, driver_id, art, lat, lng, quelle)
  values (p_standby, auth.uid(), p_art, p.lat, p.lng, 'knopf');
  return neu;
end;
$$;
revoke all on function public.standby_melden(uuid, text) from public, anon;
grant execute on function public.standby_melden(uuid, text) to authenticated;

-- Automatische Erkennung aus dem Live-Standort.
create or replace function public.standby_standort()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  d double precision;
begin
  if new.lat is null or new.lng is null then
    return null;
  end if;
  for r in
    select f.*, s.lat as s_lat, s.lng as s_lng, s.radius_rein_m, s.radius_raus_m
      from public.standby_fahrer f
      join public.standby s on s.id = f.standby_id
     where f.driver_id = new.driver_id and f.status = 'accepted'
       and now() between public.standby_zeitpunkt(s.datum, coalesce(f.von_eigen, s.von)) - interval '30 minutes'
                     and public.standby_zeitpunkt(s.datum, coalesce(f.bis_eigen, s.bis))
                         + case when coalesce(f.bis_eigen, s.bis) <= coalesce(f.von_eigen, s.von) then interval '1 day' else interval '0' end
                         + interval '30 minutes'
  loop
    d := public.standby_abstand_m(r.s_lat, r.s_lng, new.lat, new.lng);
    if d <= r.radius_rein_m and r.zustand <> 'vor_ort' then
      update public.standby_fahrer set zustand = 'vor_ort', zustand_seit = now(), aktualisiert = now()
       where standby_id = r.standby_id and driver_id = r.driver_id;
      if r.zustand <> 'geplant' then
        insert into public.standby_ereignis (standby_id, driver_id, art, lat, lng) values (r.standby_id, r.driver_id, 'zurueck', new.lat, new.lng);
      end if;
    elsif r.zustand = 'vor_ort' and d > r.radius_raus_m then
      update public.standby_fahrer set zustand = 'mit_gast', zustand_seit = now(), max_abstand_m = d, max_lat = new.lat, max_lng = new.lng, aktualisiert = now()
       where standby_id = r.standby_id and driver_id = r.driver_id;
      insert into public.standby_ereignis (standby_id, driver_id, art, lat, lng) values (r.standby_id, r.driver_id, 'gast_drin', new.lat, new.lng);
    elsif r.zustand = 'mit_gast' then
      if d > coalesce(r.max_abstand_m, 0) then
        update public.standby_fahrer set max_abstand_m = d, max_lat = new.lat, max_lng = new.lng, aktualisiert = now()
         where standby_id = r.standby_id and driver_id = r.driver_id;
      elsif coalesce(r.max_abstand_m, 0) - d > 500 then
        -- Umkehr Richtung Event: am weitesten Punkt wurde abgesetzt.
        update public.standby_fahrer set zustand = 'rueckweg', zustand_seit = now(), aktualisiert = now()
         where standby_id = r.standby_id and driver_id = r.driver_id;
        insert into public.standby_ereignis (standby_id, driver_id, art, lat, lng) values (r.standby_id, r.driver_id, 'abgesetzt', r.max_lat, r.max_lng);
      end if;
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_standby_standort on public.driver_live_locations;
create trigger trg_standby_standort
  after insert or update of lat, lng, captured_at on public.driver_live_locations
  for each row execute function public.standby_standort();

-- Stundenerfassung: Standby des Tages als Vermerk (Fahrer-App, Dispo, Export).
CREATE OR REPLACE FUNCTION public.stunden_verlauf(p_driver uuid DEFAULT NULL::uuid, p_tage integer DEFAULT 60)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  fahrer uuid := coalesce(p_driver, auth.uid());
  heute date := (now() at time zone 'Europe/Berlin')::date;
  ergebnis jsonb := '[]'::jsonb;
  d record;
  z record;
begin
  if fahrer <> auth.uid() and not public.ist_dispo() then
    raise exception 'kein Zugriff';
  end if;
  -- Stundenerfassung fuer diesen Fahrer aus: der Fahrer-App (fragt ohne p_driver) nichts zeigen.
  -- Die Dispo fragt immer mit p_driver und sieht weiter alles.
  if p_driver is null and not public.stundenerfassung_an(fahrer) then
    return '[]'::jsonb;
  end if;
  for d in
    select * from public.driver_service_requests
    where driver_id = fahrer
      and lower(coalesce(status, '')) in ('accepted', 'assigned', 'approved')
      and service_date <= heute
      and service_date >= heute - p_tage
    order by service_date desc, service_start_time desc
  loop
    select * into z from public.stundenzettel where dienst_id = d.id;
    ergebnis := ergebnis || jsonb_build_object(
      'dienst', jsonb_build_object('id', d.id, 'datum', d.service_date,
        'beginn', to_char(d.service_start_time, 'HH24:MI'), 'ende', to_char(d.service_end_time, 'HH24:MI'),
        'pausen', coalesce((select dp.pausen from public.dienst_pausen dp where dp.dienst_id = d.id), '[]'::jsonb)),
      'vorschlag', public.stunden_vorschlag_server(d.id),
      'zettel', case when z.id is null then null else to_jsonb(z) end,
      -- Standby am Event-Ort an diesem Tag (Vermerk "BMW Welt 18:00–23:00").
      'standby', coalesce((select jsonb_agg(jsonb_build_object('ort', s.ort_name,
          'von', to_char(coalesce(sf.von_eigen, s.von), 'HH24:MI'), 'bis', to_char(coalesce(sf.bis_eigen, s.bis), 'HH24:MI'))
          order by s.von)
        from public.standby_fahrer sf join public.standby s on s.id = sf.standby_id
        where sf.driver_id = fahrer and sf.status = 'accepted' and s.datum = d.service_date), '[]'::jsonb),
      -- Erfassen erst, wenn der Dienst vorbei ist.
      'vorbei', coalesce(public.stunden_zeitpunkt(d.service_date, d.service_end_time) +
                  case when d.service_end_time <= d.service_start_time then interval '1 day' else interval '0' end, now()) <= now()
    );
  end loop;
  return ergebnis;
end;
$function$;
