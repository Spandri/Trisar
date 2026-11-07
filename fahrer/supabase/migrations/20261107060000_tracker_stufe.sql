-- Punkte bei Fahrt je OBD-Tracker (sparsam / mittel / fein) und Befehls-Warteschlange in der DB.
--
-- Die Dispo setzt obd_tracker.stufe (Karten Filter). Ein Trigger legt dafuer einen
-- setparam-Befehl in obd_tracker_befehl an und ersetzt einen noch offenen alten.
-- Das Gateway (MacBook 2018) arbeitet offene Befehle ab, sobald der Tracker verbunden ist,
-- und quittiert sie (gesendet / quittiert / fehler). Ein zweiter Trigger spiegelt die
-- Quittung nach obd_tracker.stufe_status, das zeigt die Dispo an.
-- Die Warteschlange ersetzt die bisherige im Speicher des Gateways (ging beim Neustart verloren).
--
-- Werte wie werkzeuge/tracker-befehl.sh, je fuer Heimnetz, Roaming, unbekanntes Netz
-- (Basis 10050/10150/10250): Periode (Basis), Winkel (Basis+2), Strecke (Basis+1).
--   sparsam  60 s / 30 Grad / aus
--   mittel   30 s / 15 Grad / 200 m   (Standard, 1NCE-Budget)
--   fein     10 s / 10 Grad / 100 m

alter table public.obd_tracker
  add column if not exists stufe text not null default 'mittel',
  add column if not exists stufe_status text,
  add column if not exists stufe_geaendert_am timestamptz,
  add column if not exists stufe_quittung_am timestamptz,
  add column if not exists stufe_antwort text;

alter table public.obd_tracker drop constraint if exists obd_tracker_stufe_check;
alter table public.obd_tracker add constraint obd_tracker_stufe_check
  check (stufe in ('sparsam', 'mittel', 'fein'));
alter table public.obd_tracker drop constraint if exists obd_tracker_stufe_status_check;
alter table public.obd_tracker add constraint obd_tracker_stufe_status_check
  check (stufe_status is null or stufe_status in ('wartet', 'gesendet', 'uebernommen', 'fehler'));

-- Bekannter Stand laut Gateway-Log vom 07.11. (Nr. 1 unbekannt, bleibt ohne Status).
-- Steht vor den Triggern, damit dafuer kein Befehl eingereiht wird.
update public.obd_tracker
   set stufe = 'fein', stufe_status = 'uebernommen', stufe_quittung_am = '2026-11-07T03:15:03Z'
 where imei = '860848088205357' and stufe_status is null;
update public.obd_tracker
   set stufe = 'mittel', stufe_status = 'uebernommen', stufe_quittung_am = '2026-11-07T03:13:47Z'
 where imei = '860848088432159' and stufe_status is null;

create table if not exists public.obd_tracker_befehl (
  id bigint generated always as identity primary key,
  imei text not null check (imei ~ '^\d{14,17}$'),
  befehl text not null check (length(befehl) between 1 and 500),
  art text not null default 'manuell' check (art in ('stufe', 'manuell')),
  stufe text check (stufe is null or stufe in ('sparsam', 'mittel', 'fein')),
  status text not null default 'offen' check (status in ('offen', 'gesendet', 'quittiert', 'fehler', 'ersetzt')),
  versuche integer not null default 0,
  angelegt timestamptz not null default now(),
  angelegt_von uuid default auth.uid(),
  gesendet_am timestamptz,
  quittiert_am timestamptz,
  antwort text
);

create index if not exists obd_tracker_befehl_offen
  on public.obd_tracker_befehl (imei, id)
  where status in ('offen', 'gesendet');

-- Dispo darf lesen. Anlegen nur ueber den Trigger (stufe) oder das Gateway (service_role).
alter table public.obd_tracker_befehl enable row level security;
drop policy if exists dispo_lesen on public.obd_tracker_befehl;
create policy dispo_lesen on public.obd_tracker_befehl
  for select to authenticated using (public.ist_dispo());

create or replace function public.obd_stufe_befehl(p_stufe text)
returns text
language sql
immutable
as $$
  select 'setparam ' || string_agg(
           basis || ':' || w.periode || ';' || (basis + 2) || ':' || w.winkel || ';' || (basis + 1) || ':' || w.strecke,
           ';' order by basis)
  from (values
          ('sparsam', 60, 30, 0),
          ('mittel', 30, 15, 200),
          ('fein', 10, 10, 100)
       ) as w(stufe, periode, winkel, strecke)
  cross join unnest(array[10050, 10150, 10250]) as basis
  where w.stufe = p_stufe
$$;

-- Stufe gesetzt (auch dieselbe nochmal, z.B. nach Fehler): alten offenen Stufen-Befehl
-- ersetzen, neuen anlegen, Status "wartet". Die Quittung aendert stufe nicht, loest also nichts aus.
create or replace function public.obd_tracker_stufe_einreihen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.obd_tracker_befehl
     set status = 'ersetzt'
   where imei = new.imei and art = 'stufe' and status in ('offen', 'gesendet');

  insert into public.obd_tracker_befehl (imei, befehl, art, stufe)
  values (new.imei, public.obd_stufe_befehl(new.stufe), 'stufe', new.stufe);

  new.stufe_status := 'wartet';
  new.stufe_geaendert_am := now();
  new.stufe_quittung_am := null;
  new.stufe_antwort := null;
  return new;
end;
$$;

drop trigger if exists obd_tracker_stufe_einreihen on public.obd_tracker;
create trigger obd_tracker_stufe_einreihen
  before update of stufe on public.obd_tracker
  for each row
  execute function public.obd_tracker_stufe_einreihen();

-- Quittung des Gateways in obd_tracker spiegeln (nur fuer die aktuell gewuenschte Stufe).
create or replace function public.obd_tracker_befehl_quittung()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.art <> 'stufe' or new.status not in ('gesendet', 'quittiert', 'fehler') then
    return new;
  end if;
  update public.obd_tracker
     set stufe_status = case new.status
                          when 'gesendet' then 'gesendet'
                          when 'quittiert' then 'uebernommen'
                          else 'fehler'
                        end,
         stufe_quittung_am = case when new.status = 'gesendet' then stufe_quittung_am else coalesce(new.quittiert_am, now()) end,
         stufe_antwort = case when new.status = 'gesendet' then stufe_antwort else new.antwort end
   where imei = new.imei and stufe = new.stufe;
  return new;
end;
$$;

drop trigger if exists obd_tracker_befehl_quittung on public.obd_tracker_befehl;
create trigger obd_tracker_befehl_quittung
  after update of status on public.obd_tracker_befehl
  for each row
  when (old.status is distinct from new.status)
  execute function public.obd_tracker_befehl_quittung();
