-- Stunden: Dispo kann aendern, dann muss der Fahrer zustimmen.
--
-- Wunsch 12.11.: "Dispo schickt Dienstende, Fahrer bekommt die Stunden, bestaetigt oder bearbeitet,
-- dann bekommt die Dispo eine Anfrage. Bearbeitet die Dispo, muss der Fahrer wieder bestaetigen."
--
-- Staende:
--   eingereicht      Fahrer hat bestaetigt oder bearbeitet, Dispo ist dran (bestaetigen oder bearbeiten)
--   dispo_geaendert  Dispo hat bearbeitet, Fahrer ist dran (bestaetigen oder bearbeiten)
--   bestaetigt       beide einig, fertig
--   zurueckgewiesen  alt, bleibt erlaubt fuer vorhandene Zeilen
--
-- Fahrer bestaetigt eine Dispo-Aenderung ueber stunden_fahrer_zustimmen() (RLS laesst ihn nur
-- 'eingereicht' schreiben). Bearbeitet er, schreibt er wie bisher 'eingereicht'.

alter table public.stundenzettel drop constraint if exists stundenzettel_status_check;
alter table public.stundenzettel add constraint stundenzettel_status_check
  check (status in ('eingereicht', 'dispo_geaendert', 'bestaetigt', 'zurueckgewiesen'));

-- Fahrer stimmt der Aenderung der Dispo zu: nur aus 'dispo_geaendert', nur eigene Zeile.
create or replace function public.stunden_fahrer_zustimmen(p_zettel uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.stundenzettel
     set status = 'bestaetigt', aktualisiert = now()
   where id = p_zettel and driver_id = auth.uid() and status = 'dispo_geaendert';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Diese Stunden warten nicht auf deine Zustimmung.';
  end if;
end;
$$;
revoke all on function public.stunden_fahrer_zustimmen(uuid) from public, anon;
grant execute on function public.stunden_fahrer_zustimmen(uuid) to authenticated;

-- Mitteilungen: Fahrer reicht ein -> Dispo. Dispo aendert -> Fahrer. Bestaetigt -> jeweils die andere Seite.
create or replace function public.push_stunden_ausloeser()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  k uuid;
  tag text := to_char(new.datum, 'DD.MM.');
  zeit text := to_char(make_interval(mins => new.arbeits_min), 'HH24:MI') || ' h';
  name text := coalesce(public.push_name(new.driver_id), 'Fahrer');
  geaendert boolean := tg_op = 'INSERT' or old.status is distinct from new.status
    or old.beginn <> new.beginn or old.ende <> new.ende or old.pause_min <> new.pause_min;
begin
  if not geaendert then
    return new;
  end if;
  if new.status = 'eingereicht' then
    for k in select public.push_dispo_konten() loop
      perform public.push_melden(k, 'dispo', 'dispo_stunden', 'Stunden bestätigen',
        name || ', ' || tag || ': ' || zeit || case when new.angepasst then ' (bearbeitet)' else '' end,
        jsonb_build_object('ziel', 'fahrer', 'driver_id', new.driver_id));
    end loop;
  elsif new.status = 'dispo_geaendert' then
    perform public.push_melden(new.driver_id, 'fahrer', 'fahrer_stunden', 'Dispo hat deine Stunden geändert',
      tag || ': ' || to_char(new.beginn at time zone 'Europe/Berlin', 'HH24:MI') || '–'
        || to_char(new.ende at time zone 'Europe/Berlin', 'HH24:MI') || ', ' || zeit || '. Bitte bestätigen.',
      jsonb_build_object('ziel', 'liste'));
  elsif tg_op = 'UPDATE' and new.status = 'bestaetigt' and old.status = 'dispo_geaendert' then
    for k in select public.push_dispo_konten() loop
      perform public.push_melden(k, 'dispo', 'dispo_stunden', 'Stunden bestätigt',
        name || ' hat die geänderten Stunden vom ' || tag || ' bestätigt (' || zeit || ').',
        jsonb_build_object('ziel', 'fahrer', 'driver_id', new.driver_id));
    end loop;
  elsif tg_op = 'UPDATE' and new.status in ('bestaetigt', 'zurueckgewiesen') and old.status is distinct from new.status then
    perform public.push_melden(new.driver_id, 'fahrer', 'fahrer_stunden',
      case when new.status = 'bestaetigt' then 'Stunden bestätigt' else 'Stunden zurückgegeben' end,
      tag || coalesce(': ' || nullif(trim(new.dispo_notiz), ''), ''),
      jsonb_build_object('ziel', 'verlauf'));
  end if;
  return new;
end;
$$;
