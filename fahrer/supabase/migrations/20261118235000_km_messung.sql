-- Testmessung gefahrene Kilometer (18.11.2026), laeuft bis der User Stopp sagt.
--
-- Fuer die Tracker in km_messung_geraete (aktiv) schreibt das Teltonika-Gateway jedes Paket in km_messung,
-- unabhaengig von Fahrt, Dienst oder Fahrerzuordnung:
--   obd_km          – Kilometerstand vom Auto (IO 389, nur am OBD)
--   gps_zaehler_km  – GPS-Kilometerzaehler des Trackers (IO 16, muss per setparam 50160:1 an sein)
--   gps_trip_km     – Tageszaehler des Trackers (IO 199, setparam 50150:1)
--   strecke_m       – eigene Schaetzung: Abstand zum vorigen Punkt (Haversine), nur in Fahrt
-- Auswertung: Sicht km_vergleich (je Tracker und Tag).
-- Stoppen: update km_messung_geraete set aktiv = false;  Aufraeumen spaeter: drop table km_messung, km_messung_geraete.

create table if not exists public.km_messung_geraete (
  imei text primary key,
  aktiv boolean not null default true,
  notiz text,
  seit timestamptz not null default now()
);

create table if not exists public.km_messung (
  id bigint generated always as identity primary key,
  imei text not null,
  erfasst timestamptz not null,
  lat double precision,
  lng double precision,
  satelliten integer,
  tempo_kmh numeric,
  zuendung boolean,
  obd_km numeric,
  gps_zaehler_km numeric,
  gps_trip_km numeric,
  strecke_m numeric,
  eingegangen timestamptz not null default now(),
  unique (imei, erfasst)
);
create index if not exists km_messung_imei_erfasst on public.km_messung (imei, erfasst);

alter table public.km_messung_geraete enable row level security;
alter table public.km_messung enable row level security;
drop policy if exists "dispo_lesen" on public.km_messung_geraete;
create policy "dispo_lesen" on public.km_messung_geraete for select to authenticated using (public.ist_dispo());
drop policy if exists "dispo_lesen" on public.km_messung;
create policy "dispo_lesen" on public.km_messung for select to authenticated using (public.ist_dispo());

-- Eigene Schaetzung: Strecke zum vorigen Punkt desselben Trackers. Gezaehlt nur mit GPS-Fix, in Fahrt
-- (Tempo ab 3 km/h laut Tracker, sonst springt der Standort im Stand hin und her) und ohne Spruenge
-- (mehr als 250 km/h zwischen zwei Punkten).
create or replace function public.km_messung_strecke()
returns trigger
language plpgsql security definer set search_path = public as $function$
declare
  vor record;
  d numeric;
  dt numeric;
begin
  new.strecke_m := 0;
  if new.lat is null or new.lng is null or coalesce(new.satelliten, 0) = 0 or (new.lat = 0 and new.lng = 0) then
    return new;
  end if;
  select lat, lng, erfasst into vor
    from public.km_messung
   where imei = new.imei and erfasst < new.erfasst and coalesce(satelliten, 0) > 0
   order by erfasst desc
   limit 1;
  if vor.erfasst is null then
    return new;
  end if;
  d := 2 * 6371000 * asin(sqrt(
         power(sin(radians(new.lat - vor.lat) / 2), 2)
         + cos(radians(vor.lat)) * cos(radians(new.lat)) * power(sin(radians(new.lng - vor.lng) / 2), 2)));
  dt := extract(epoch from new.erfasst - vor.erfasst);
  if dt > 0 and d / dt * 3.6 <= 250 and coalesce(new.tempo_kmh, 0) >= 3 then
    new.strecke_m := round(d, 1);
  end if;
  return new;
end
$function$;

drop trigger if exists trg_km_messung_strecke on public.km_messung;
create trigger trg_km_messung_strecke
  before insert on public.km_messung
  for each row execute function public.km_messung_strecke();

-- Je Tracker und Tag: was das Auto (OBD), der GPS-Zaehler des Trackers und die eigene Schaetzung sagen.
create or replace view public.km_vergleich with (security_invoker = true) as
select imei,
       (erfasst at time zone 'Europe/Berlin')::date as tag,
       count(*) as punkte,
       round(max(obd_km) - min(obd_km), 1) as obd_km,
       round(max(gps_zaehler_km) - min(gps_zaehler_km), 2) as gps_zaehler_km,
       round(sum(strecke_m) / 1000, 2) as eigene_km,
       min(erfasst) as von,
       max(erfasst) as bis
  from public.km_messung
 group by imei, (erfasst at time zone 'Europe/Berlin')::date;

insert into public.km_messung_geraete (imei, notiz) values
  ('860848088205357', 'Tracker 2, OBD, BMW X7 M-X7247'),
  ('860848088432159', 'Tracker 3, USB-C')
on conflict (imei) do update set aktiv = true;
