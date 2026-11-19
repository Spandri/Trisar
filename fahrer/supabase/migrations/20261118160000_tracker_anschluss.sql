-- Tracker-Anschluss USB-C oder OBD (18.11.2026).
--
-- USB-C (Platine, Strom nur mit Zuendung): Zuendung = Strom da (101:4, 105:4500), Strom weg = Tiefschlaf.
-- OBD (Strom liegt immer an): Zuendung ueber Bewegung oder Motor (101:10), 5 min Stillstand = aus,
-- dann schlafen. Ausser Dienst Tiefschlaf (102:2, GPS und Mobilfunk aus), im Dienst Online-Tiefschlaf
-- (102:3, Mobilfunk bleibt, Standort nach dem Losfahren schneller da).
--
-- Erkennung automatisch aus den Daten des Trackers (vehicle_telemetry_live):
--   Fahrgestellnummer oder Drehzahl aus dem Auto -> sicher OBD.
--   Spannung unter 3 V -> USB-C (Strom weg beim Abstellen).
--   Ueber 30 min ohne Fahrt und weiter ueber 11 V -> OBD (Buchse hat immer Strom).
-- Die Dispo kann von Hand umstellen (anschluss_quelle 'hand'), dann gilt die Erkennung nicht mehr.
-- Befehle laufen ueber die Warteschlange obd_tracker_befehl (Gateway schickt sie beim naechsten Verbinden).

alter table public.obd_tracker
  add column if not exists anschluss text check (anschluss is null or anschluss in ('usbc', 'obd')),
  add column if not exists anschluss_quelle text not null default 'auto' check (anschluss_quelle in ('auto', 'hand')),
  add column if not exists anschluss_status text check (anschluss_status is null or anschluss_status in ('wartet', 'gesendet', 'uebernommen', 'fehler')),
  add column if not exists anschluss_geaendert_am timestamptz,
  add column if not exists anschluss_quittung_am timestamptz,
  add column if not exists schlaf text check (schlaf is null or schlaf in ('tief', 'online')),
  add column if not exists letzte_fahrt_am timestamptz;

alter table public.obd_tracker_befehl drop constraint if exists obd_tracker_befehl_art_check;
alter table public.obd_tracker_befehl
  add constraint obd_tracker_befehl_art_check check (art in ('stufe', 'manuell', 'anschluss', 'schlaf'));

-- Befehl fuer Anschluss (und bei OBD die Schlafart).
create or replace function public.obd_anschluss_befehl(p_anschluss text, p_schlaf text)
returns text
language sql
immutable
as $$
  select case p_anschluss
    when 'usbc' then 'setparam 101:4;104:30000;105:4500;102:2;103:1'
    else 'setparam 101:10;19001:5;19002:300;103:5;102:' || case when p_schlaf = 'online' then '3' else '2' end
  end
$$;

-- Ist der Fahrer des Trackers gerade im Dienst (gleiche Regel wie die App-Ortung)?
create or replace function public.tracker_im_dienst(p_imei text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(bool_or(public.ortung_erlaubt(m.driver_id)), false)
    from public.imei_driver_map m
   where m.imei = p_imei and m.is_active
$$;

-- Anschluss setzen und Befehl einreihen (alte offene Anschluss-/Schlaf-Befehle werden ersetzt).
create or replace function public.tracker_anschluss_setzen(p_imei text, p_anschluss text, p_quelle text default 'auto')
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_schlaf text;
begin
  if p_anschluss not in ('usbc', 'obd') then
    raise exception 'anschluss muss usbc oder obd sein';
  end if;
  v_schlaf := case when p_anschluss = 'obd' then (case when public.tracker_im_dienst(p_imei) then 'online' else 'tief' end) end;
  update public.obd_tracker_befehl
     set status = 'ersetzt'
   where imei = p_imei and art in ('anschluss', 'schlaf') and status in ('offen', 'gesendet');
  insert into public.obd_tracker_befehl (imei, befehl, art)
  values (p_imei, public.obd_anschluss_befehl(p_anschluss, v_schlaf), 'anschluss');
  update public.obd_tracker
     set anschluss = p_anschluss,
         anschluss_quelle = coalesce(p_quelle, 'auto'),
         anschluss_status = 'wartet',
         anschluss_geaendert_am = now(),
         anschluss_quittung_am = null,
         schlaf = v_schlaf
   where imei = p_imei;
end;
$$;

revoke all on function public.tracker_anschluss_setzen(text, text, text) from public, anon;

-- Dispo stellt von Hand um (Tippen im Karten Filter).
create or replace function public.tracker_anschluss_waehlen(p_imei text, p_anschluss text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.ist_dispo() then
    raise exception 'nur Disposition';
  end if;
  perform public.tracker_anschluss_setzen(p_imei, p_anschluss, 'hand');
end;
$$;

revoke all on function public.tracker_anschluss_waehlen(text, text) from public, anon;
grant execute on function public.tracker_anschluss_waehlen(text, text) to authenticated;

-- Erkennung bei jedem Datensatz des Trackers.
create or replace function public.tracker_anschluss_erkennen()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  t public.obd_tracker%rowtype;
  v_spannung numeric := new.ext_voltage_v;
  v_kmh numeric := nullif(new.raw_io ->> '24', '')::numeric;
  v_erkannt text;
begin
  select * into t from public.obd_tracker where imei = new.imei;
  if not found then
    return new;
  end if;
  if coalesce(v_kmh, 0) > 5 or coalesce(new.obd_speed_kph, 0) > 5 then
    update public.obd_tracker set letzte_fahrt_am = coalesce(new.captured_at, now()) where imei = new.imei;
    t.letzte_fahrt_am := coalesce(new.captured_at, now());
  end if;
  if t.anschluss_quelle = 'hand' then
    return new;
  end if;

  if nullif(btrim(coalesce(new.vin, '')), '') is not null or coalesce(new.rpm, 0) > 0 then
    v_erkannt := 'obd';
  elsif v_spannung is not null and v_spannung < 3 then
    v_erkannt := 'usbc';
  elsif v_spannung is not null and v_spannung > 11 and coalesce(v_kmh, 0) <= 5
        and t.letzte_fahrt_am is not null
        and coalesce(new.captured_at, now()) - t.letzte_fahrt_am > interval '30 minutes' then
    v_erkannt := 'obd';
  end if;

  if v_erkannt is not null and v_erkannt is distinct from t.anschluss then
    perform public.tracker_anschluss_setzen(new.imei, v_erkannt, 'auto');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_tracker_anschluss_erkennen on public.vehicle_telemetry_live;
create trigger trg_tracker_anschluss_erkennen
  after insert or update on public.vehicle_telemetry_live
  for each row execute function public.tracker_anschluss_erkennen();

-- Jede Minute (push-dienst): bei OBD-Trackern Schlafart an den Dienst anpassen.
create or replace function public.tracker_schlaf_abgleichen()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_soll text;
  anzahl integer := 0;
begin
  for r in select imei, schlaf from public.obd_tracker where anschluss = 'obd' loop
    v_soll := case when public.tracker_im_dienst(r.imei) then 'online' else 'tief' end;
    if v_soll is distinct from r.schlaf then
      update public.obd_tracker_befehl
         set status = 'ersetzt'
       where imei = r.imei and art = 'schlaf' and status in ('offen', 'gesendet');
      insert into public.obd_tracker_befehl (imei, befehl, art)
      values (r.imei, 'setparam 102:' || case when v_soll = 'online' then '3' else '2' end, 'schlaf');
      update public.obd_tracker set schlaf = v_soll where imei = r.imei;
      anzahl := anzahl + 1;
    end if;
  end loop;
  return anzahl;
end;
$$;

revoke all on function public.tracker_schlaf_abgleichen() from public, anon, authenticated;
grant execute on function public.tracker_schlaf_abgleichen() to service_role;

-- Quittung: wie bei der Stufe auch fuer den Anschluss.
create or replace function public.obd_tracker_befehl_quittung()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status not in ('gesendet', 'quittiert', 'fehler') then
    return new;
  end if;
  if new.art = 'stufe' then
    update public.obd_tracker
       set stufe_status = case new.status
                            when 'gesendet' then 'gesendet'
                            when 'quittiert' then 'uebernommen'
                            else 'fehler'
                          end,
           stufe_quittung_am = case when new.status = 'gesendet' then stufe_quittung_am else coalesce(new.quittiert_am, now()) end,
           stufe_antwort = case when new.status = 'gesendet' then stufe_antwort else new.antwort end
     where imei = new.imei and stufe = new.stufe;
  elsif new.art = 'anschluss' then
    update public.obd_tracker
       set anschluss_status = case new.status
                                when 'gesendet' then 'gesendet'
                                when 'quittiert' then 'uebernommen'
                                else 'fehler'
                              end,
           anschluss_quittung_am = case when new.status = 'gesendet' then anschluss_quittung_am else coalesce(new.quittiert_am, now()) end
     where imei = new.imei;
  end if;
  return new;
end;
$$;
