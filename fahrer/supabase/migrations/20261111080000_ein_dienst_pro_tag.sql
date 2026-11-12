-- Ein Dienst pro Fahrer und Tag.
--
-- Wunsch 11.11.: "Es kann nur einen Dienststart und ein Dienstende fuer den Tag geben."
-- Bisher legte jedes "Dienste planen" (Web, iOS, Android) eine weitere Zeile in
-- driver_service_requests an. Bei Stefano standen am 11.11. zwei angenommene Dienste
-- (09:00-20:00 und ein einzelnes Dienstende 04:15 aus einem KI-Test).
--
-- Regel (Trigger vor dem Einfuegen, gilt fuer alle Apps und den KI-Assistenten):
--   * Gibt es fuer Fahrer und Tag schon einen Dienst (offen oder angenommen), ersetzt die neue
--     Anfrage ihn. Was die neue Anfrage leer laesst (nur Start oder nur Ende), wird vom alten
--     uebernommen. Pausen (dienst_pausen) und Stundenzettel wandern zur neuen Zeile.
--   * Der alte Dienst wird geloescht, ohne "Dienstanfrage zurueckgezogen" an den Fahrer
--     (er bekommt die neue Anfrage mit den vollstaendigen Zeiten und bestaetigt sie).
--   * Abgelehnte Dienste bleiben als Verlauf stehen.
-- Aufraeumen: vorhandene Doppelte werden genauso zusammengefuehrt (der neueste bleibt).

-- Push beim Loeschen nicht ausloesen, wenn der Dienst nur ersetzt wird.
create or replace function public.push_dienst_ausloeser()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  tag text;
  d uuid;
begin
  if tg_op = 'DELETE' then
    if lower(coalesce(old.status, '')) = 'pending'
       and coalesce(current_setting('trisar.dienst_ersetzt', true), '') <> '1' then
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
$function$;

-- Alte Dienste von Fahrer und Tag in die neue Zeile uebernehmen und loeschen.
create or replace function public.trisar_dienst_zusammenfuehren(p_neu_id uuid, p_fahrer uuid, p_tag date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  alt record;
begin
  perform set_config('trisar.dienst_ersetzt', '1', true);
  for alt in
    select * from public.driver_service_requests
     where driver_id = p_fahrer and service_date = p_tag and id <> p_neu_id
       and lower(coalesce(status, '')) <> 'refused'
  loop
    -- Pausen: die neue Zeile behaelt ihre eigenen, sonst die des alten Dienstes.
    if exists (select 1 from public.dienst_pausen where dienst_id = alt.id) then
      if exists (select 1 from public.dienst_pausen where dienst_id = p_neu_id) then
        delete from public.dienst_pausen where dienst_id = alt.id;
      else
        update public.dienst_pausen set dienst_id = p_neu_id where dienst_id = alt.id;
      end if;
    end if;
    -- Stundenzettel: zum neuen Dienst, wenn der noch keinen hat.
    if not exists (select 1 from public.stundenzettel where dienst_id = p_neu_id) then
      update public.stundenzettel set dienst_id = p_neu_id where dienst_id = alt.id;
    end if;
    delete from public.driver_service_requests where id = alt.id;
  end loop;
  perform set_config('trisar.dienst_ersetzt', '', true);
end;
$$;

revoke all on function public.trisar_dienst_zusammenfuehren(uuid, uuid, date) from public, anon, authenticated;

-- Vor dem Einfuegen: fehlende Zeiten vom vorhandenen Dienst des Tages uebernehmen.
create or replace function public.trisar_dienst_ein_pro_tag_vorher()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  alt record;
begin
  if lower(coalesce(new.status, 'pending')) = 'refused' then
    return new;
  end if;
  select * into alt from public.driver_service_requests
   where driver_id = new.driver_id and service_date = new.service_date
     and lower(coalesce(status, '')) <> 'refused'
   order by created_at desc
   limit 1;
  if found then
    new.service_start_time := coalesce(new.service_start_time, alt.service_start_time);
    new.service_end_time := coalesce(new.service_end_time, alt.service_end_time);
  end if;
  return new;
end;
$$;

-- Nach dem Einfuegen: alte Dienste des Tages zusammenfuehren und loeschen.
create or replace function public.trisar_dienst_ein_pro_tag_nachher()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if lower(coalesce(new.status, 'pending')) <> 'refused' then
    perform public.trisar_dienst_zusammenfuehren(new.id, new.driver_id, new.service_date);
  end if;
  return null;
end;
$$;

drop trigger if exists trg_dienst_ein_pro_tag_vorher on public.driver_service_requests;
create trigger trg_dienst_ein_pro_tag_vorher
  before insert on public.driver_service_requests
  for each row execute function public.trisar_dienst_ein_pro_tag_vorher();

drop trigger if exists trg_dienst_ein_pro_tag_nachher on public.driver_service_requests;
create trigger trg_dienst_ein_pro_tag_nachher
  after insert on public.driver_service_requests
  for each row execute function public.trisar_dienst_ein_pro_tag_nachher();

-- Aufraeumen: je Fahrer und Tag bleibt der neueste Dienst, fehlende Zeiten kommen von den aelteren.
do $$
declare
  g record;
  neu public.driver_service_requests%rowtype;
begin
  for g in
    select driver_id, service_date
      from public.driver_service_requests
     where lower(coalesce(status, '')) <> 'refused'
     group by driver_id, service_date
    having count(*) > 1
  loop
    select * into neu from public.driver_service_requests
     where driver_id = g.driver_id and service_date = g.service_date and lower(coalesce(status, '')) <> 'refused'
     order by created_at desc limit 1;
    update public.driver_service_requests n
       set service_start_time = coalesce(n.service_start_time,
             (select a.service_start_time from public.driver_service_requests a
               where a.driver_id = g.driver_id and a.service_date = g.service_date and a.id <> n.id
                 and lower(coalesce(a.status, '')) <> 'refused' and a.service_start_time is not null
               order by a.created_at desc limit 1)),
           service_end_time = coalesce(n.service_end_time,
             (select a.service_end_time from public.driver_service_requests a
               where a.driver_id = g.driver_id and a.service_date = g.service_date and a.id <> n.id
                 and lower(coalesce(a.status, '')) <> 'refused' and a.service_end_time is not null
               order by a.created_at desc limit 1))
     where n.id = neu.id
       and (n.service_start_time is null or n.service_end_time is null);
    perform public.trisar_dienst_zusammenfuehren(neu.id, g.driver_id, g.service_date);
  end loop;
end;
$$;
