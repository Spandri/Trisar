-- Push-Mitteilungen mit Treffpunkt (13.11.2026).
--
-- 1. push_dienst_ausloeser nennt den Treffpunkt: "Dienst 14.11. 07:00–16:00, Treffpunkt Bayrischer Hof,
--    bitte bestätigen." Dafuer speichern Web, iOS und Android den Treffpunkt VOR dem Dienst (die App
--    vergibt die Dienst-ID selbst), sonst kennt der Ausloeser beim Anlegen den Ort noch nicht.
-- 2. Neuer Ausloeser auf dienst_treffpunkt: aendert die Dispo nur Treffpunkt oder Notiz an einem
--    vorhandenen Dienst (kein neuer Dienst, nichts zu bestaetigen), bekommt der Fahrer eine Mitteilung.
--    Gerade erst angelegte Dienste (unter 30 s) und das Umhaengen beim Ersetzen bleiben still.

CREATE OR REPLACE FUNCTION public.push_dienst_ausloeser()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tag text;
  ort text;
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

  if coalesce(current_setting('trisar.dienst_antwort', true), '') = '1' then
    return new;
  end if;

  tag := to_char(new.service_date, 'DD.MM.') || ' ' || coalesce(to_char(new.service_start_time, 'HH24:MI'), '?')
    || '–' || coalesce(to_char(new.service_end_time, 'HH24:MI'), '?');
  -- Treffpunkt (13.11.): die Apps speichern ihn vor dem Dienst (gleiche ID), daher hier schon bekannt.
  select nullif(trim(t.name), '') into ort from public.dienst_treffpunkt t where t.dienst_id = new.id;

  if tg_op = 'INSERT' then
    perform public.push_melden(new.driver_id, 'fahrer', 'dienst_neu',
      case when exists (select 1 from public.dienst_aenderung a where a.dienst_id = new.id)
           then 'Dienst geändert' else 'Neue Dienstanfrage' end,
      'Dienst ' || tag || coalesce(', Treffpunkt ' || ort, '') || ', bitte bestätigen.', jsonb_build_object('ziel', 'liste'));
    return new;
  end if;

  if new.service_date is distinct from old.service_date or new.service_start_time is distinct from old.service_start_time
     or new.service_end_time is distinct from old.service_end_time then
    perform public.push_melden(new.driver_id, 'fahrer', 'dienst_geaendert', 'Dienst geändert',
      'Dein Dienst ist jetzt ' || tag || coalesce(', Treffpunkt ' || ort, '') || '.', jsonb_build_object('ziel', 'liste'));
  end if;

  if new.status is distinct from old.status and lower(coalesce(new.status, '')) in ('accepted', 'refused') then
    for d in select public.push_dispo_konten() loop
      perform public.push_melden(d, 'dispo',
        case when lower(new.status) = 'refused' then 'dispo_dienst_abgelehnt' else 'dispo_dienst_angenommen' end,
        case when lower(new.status) = 'refused' then 'Dienst abgelehnt' else 'Dienst bestätigt' end,
        public.push_name(new.driver_id) || ' hat den Dienst '
          || tag || case when lower(new.status) = 'refused' then ' abgelehnt.' else ' bestätigt.' end,
        jsonb_build_object('ziel', 'fahrer', 'user_id', new.driver_id));
    end loop;
  end if;
  return new;
end;
$function$;

create or replace function public.push_treffpunkt_ausloeser()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  titel text;
  text_ text;
begin
  if tg_op = 'DELETE' then
    return old;
  end if;
  -- Umhaengen beim Ersetzen eines Dienstes (trisar_dienst_zusammenfuehren): still.
  if coalesce(current_setting('trisar.dienst_ersetzt', true), '') = '1' then
    return new;
  end if;
  select * into d from public.driver_service_requests where id = new.dienst_id;
  -- Dienst gibt es noch nicht (Treffpunkt vor dem Dienst gespeichert) oder gerade erst angelegt:
  -- die Mitteilung zum Dienst nennt den Ort schon.
  if not found or d.created_at > now() - interval '30 seconds'
     or lower(coalesce(d.status, '')) not in ('pending', 'accepted') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.adresse is not distinct from old.adresse
     and new.notiz is not distinct from old.notiz then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.adresse is not distinct from old.adresse then
    titel := 'Neue Notiz zum Dienst';
    text_ := 'Dienst ' || to_char(d.service_date, 'DD.MM.') || ': ' || left(coalesce(new.notiz, ''), 120);
  else
    titel := 'Treffpunkt für deinen Dienst';
    text_ := 'Dienst ' || to_char(d.service_date, 'DD.MM.') || coalesce(' ab ' || to_char(d.service_start_time, 'HH24:MI'), '')
      || ': Treffpunkt ' || coalesce(nullif(trim(new.name), ''), new.adresse, '?') || '.';
  end if;
  perform public.push_melden(d.driver_id, 'fahrer', 'dienst_treffpunkt', titel, text_, jsonb_build_object('ziel', 'liste'));
  return new;
end;
$$;

drop trigger if exists push_treffpunkt on public.dienst_treffpunkt;
create trigger push_treffpunkt
  after insert or update on public.dienst_treffpunkt
  for each row execute function public.push_treffpunkt_ausloeser();
