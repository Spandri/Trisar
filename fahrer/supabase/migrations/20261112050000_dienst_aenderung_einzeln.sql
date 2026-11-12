-- Dienstanfragen einzeln: Dienststart, Dienstende, Pausenstart und Pausenende (12.11.2026).
--
-- Wunsch: Aendert die Dispo an einem angenommenen Dienst nur einen Teil (z. B. nur das Dienstende
-- oder nur eine Pause), soll der Fahrer genau diesen Teil bestaetigen oder ablehnen.
--
-- Umsetzung (driver_service_requests gehoert supabase_admin, darum eine eigene Tabelle):
--   * dienst_aenderung(dienst_id, vorher): der zuletzt angenommene Stand {start, ende, pausen} eines
--     offenen Dienstes. Keine Zeile = ganz neuer Dienst. Die Apps zeigen in der Anfrage nur, was sich
--     gegenueber vorher geaendert hat.
--   * Ersetzt die Dispo einen angenommenen Dienst (trisar_dienst_ein_pro_tag_vorher), merkt sich die
--     neue Zeile den alten Stand. Ersetzt sie eine noch offene Aenderung, bleibt der Stand von davor.
--   * Aendert die Dispo nur die Pausen eines angenommenen Dienstes (dienst_pausen), wird der Dienst
--     wieder offen und merkt sich den alten Stand.
--   * Antwort des Fahrers ueber dienst_antworten(id, annehmen):
--       annehmen  -> angenommen, Aenderung vergessen.
--       ablehnen  -> bei einer Aenderung gilt wieder der alte Stand (Zeiten und Pausen), der Dienst
--                    bleibt angenommen, die Dispo bekommt "Änderung abgelehnt". Bei einem ganz neuen
--                    Dienst wie bisher abgelehnt.

create table if not exists public.dienst_aenderung (
  dienst_id uuid primary key,
  vorher jsonb not null,
  erstellt timestamptz not null default now()
);

alter table public.dienst_aenderung enable row level security;
drop policy if exists dienst_aenderung_dispo on public.dienst_aenderung;
create policy dienst_aenderung_dispo on public.dienst_aenderung for all to authenticated
  using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists dienst_aenderung_fahrer on public.dienst_aenderung;
create policy dienst_aenderung_fahrer on public.dienst_aenderung for select to authenticated
  using (exists (select 1 from public.driver_service_requests d where d.id = dienst_aenderung.dienst_id and d.driver_id = auth.uid()));
grant select on public.dienst_aenderung to authenticated;

-- Angenommener Stand eines Dienstes als jsonb.
create or replace function public.trisar_dienst_stand(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'start', to_char(d.service_start_time, 'HH24:MI'),
    'ende', to_char(d.service_end_time, 'HH24:MI'),
    'pausen', coalesce((select p.pausen from public.dienst_pausen p where p.dienst_id = d.id), '[]'::jsonb))
  from public.driver_service_requests d where d.id = p_id;
$$;
revoke all on function public.trisar_dienst_stand(uuid) from public, anon, authenticated;

-- Vor dem Einfuegen: fehlende Zeiten vom vorhandenen Dienst des Tages uebernehmen und den
-- angenommenen Stand fuer die neue Zeile merken.
create or replace function public.trisar_dienst_ein_pro_tag_vorher()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  alt record;
  stand jsonb;
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
    if lower(coalesce(new.status, 'pending')) = 'pending' and new.id is not null then
      if lower(coalesce(alt.status, '')) = 'accepted' then
        stand := public.trisar_dienst_stand(alt.id);
      else
        -- Noch offene Aenderung wird erneut geaendert: Vergleich bleibt der angenommene Stand.
        select a.vorher into stand from public.dienst_aenderung a where a.dienst_id = alt.id;
      end if;
      if stand is not null then
        insert into public.dienst_aenderung (dienst_id, vorher) values (new.id, stand)
        on conflict (dienst_id) do update set vorher = excluded.vorher, erstellt = now();
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Ersetzte Dienste: ihre gemerkte Aenderung mit aufraeumen.
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
    delete from public.dienst_aenderung where dienst_id = alt.id;
    delete from public.driver_service_requests where id = alt.id;
  end loop;
  perform set_config('trisar.dienst_ersetzt', '', true);
end;
$$;
revoke all on function public.trisar_dienst_zusammenfuehren(uuid, uuid, date) from public, anon, authenticated;

-- Pausen eines angenommenen Dienstes geaendert (ohne neue Zeile): Dienst wieder offen.
create or replace function public.trisar_dienst_pausen_geaendert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  alt jsonb;
  neu jsonb;
  v_id uuid;
begin
  -- Beim Zusammenfuehren (neue Zeile ersetzt alte) oder beim Zuruecksetzen nach Ablehnen nichts tun.
  if coalesce(current_setting('trisar.dienst_ersetzt', true), '') = '1'
     or coalesce(current_setting('trisar.dienst_antwort', true), '') = '1' then
    return null;
  end if;
  v_id := case when tg_op = 'DELETE' then old.dienst_id else new.dienst_id end;
  alt := case when tg_op = 'INSERT' then '[]'::jsonb else coalesce(old.pausen, '[]'::jsonb) end;
  neu := case when tg_op = 'DELETE' then '[]'::jsonb else coalesce(new.pausen, '[]'::jsonb) end;
  if alt = neu then
    return null;
  end if;
  select * into d from public.driver_service_requests r where r.id = v_id;
  if not found or lower(coalesce(d.status, '')) <> 'accepted' then
    return null;
  end if;
  insert into public.dienst_aenderung (dienst_id, vorher)
  values (d.id, jsonb_build_object('start', to_char(d.service_start_time, 'HH24:MI'),
                                   'ende', to_char(d.service_end_time, 'HH24:MI'), 'pausen', alt))
  on conflict (dienst_id) do update set vorher = excluded.vorher, erstellt = now();
  -- Status ohne Push "Dienst geändert" (die Zeiten bleiben gleich), eigene Meldung dazu.
  update public.driver_service_requests set status = 'pending' where id = d.id;
  perform public.push_melden(d.driver_id, 'fahrer', 'dienst_geaendert', 'Pause geändert',
    'Deine Pause am ' || to_char(d.service_date, 'DD.MM.') || ' wurde geändert, bitte bestätigen.',
    jsonb_build_object('ziel', 'liste'));
  return null;
end;
$$;

drop trigger if exists trg_dienst_pausen_geaendert on public.dienst_pausen;
create trigger trg_dienst_pausen_geaendert
  after insert or update or delete on public.dienst_pausen
  for each row execute function public.trisar_dienst_pausen_geaendert();

-- Antwort des Fahrers auf eine Dienstanfrage.
create or replace function public.dienst_antworten(p_id uuid, p_annehmen boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  d record;
  v jsonb;
  tag text;
  k uuid;
begin
  select * into d from public.driver_service_requests where id = p_id;
  if not found then
    raise exception 'Dienst nicht gefunden';
  end if;
  if d.driver_id is distinct from auth.uid() then
    raise exception 'kein Zugriff';
  end if;
  select a.vorher into v from public.dienst_aenderung a where a.dienst_id = p_id;

  if p_annehmen then
    update public.driver_service_requests set status = 'accepted' where id = p_id;
    delete from public.dienst_aenderung where dienst_id = p_id;
    return 'accepted';
  end if;

  if v is null then
    update public.driver_service_requests set status = 'refused' where id = p_id;
    return 'refused';
  end if;

  -- Aenderung abgelehnt: alter Stand gilt wieder, Dienst bleibt angenommen. Ohne die ueblichen Pushes.
  perform set_config('trisar.dienst_antwort', '1', true);
  update public.driver_service_requests
     set service_start_time = nullif(v->>'start', '')::time,
         service_end_time = nullif(v->>'ende', '')::time,
         status = 'accepted'
   where id = p_id;
  if jsonb_array_length(coalesce(v->'pausen', '[]'::jsonb)) > 0 then
    insert into public.dienst_pausen (dienst_id, pausen, aktualisiert)
    values (p_id, v->'pausen', now())
    on conflict (dienst_id) do update set pausen = excluded.pausen, aktualisiert = excluded.aktualisiert;
  else
    delete from public.dienst_pausen where dienst_id = p_id;
  end if;
  delete from public.dienst_aenderung where dienst_id = p_id;
  perform set_config('trisar.dienst_antwort', '', true);

  tag := to_char(d.service_date, 'DD.MM.') || ' ' || coalesce(nullif(v->>'start', ''), '?') || '–' || coalesce(nullif(v->>'ende', ''), '?');
  for k in select public.push_dispo_konten() loop
    perform public.push_melden(k, 'dispo', 'dispo_dienst_abgelehnt', 'Änderung abgelehnt',
      public.push_name(d.driver_id) || ' hat die Änderung am Dienst ' || to_char(d.service_date, 'DD.MM.')
        || ' abgelehnt. Es gilt wieder ' || tag || '.',
      jsonb_build_object('ziel', 'fahrer', 'user_id', d.driver_id));
  end loop;
  return 'zurueckgesetzt';
end;
$$;

revoke all on function public.dienst_antworten(uuid, boolean) from public, anon;
grant execute on function public.dienst_antworten(uuid, boolean) to authenticated;

-- Push: beim Zuruecksetzen nach Ablehnen keine "Dienst geändert"/"Dienst bestätigt"-Meldung,
-- neue Zeile mit gemerkter Aenderung heisst "Dienst geändert" statt "Neue Dienstanfrage".
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

  if coalesce(current_setting('trisar.dienst_antwort', true), '') = '1' then
    return new;
  end if;

  tag := to_char(new.service_date, 'DD.MM.') || ' ' || coalesce(to_char(new.service_start_time, 'HH24:MI'), '?')
    || '–' || coalesce(to_char(new.service_end_time, 'HH24:MI'), '?');

  if tg_op = 'INSERT' then
    perform public.push_melden(new.driver_id, 'fahrer', 'dienst_neu',
      case when exists (select 1 from public.dienst_aenderung a where a.dienst_id = new.id)
           then 'Dienst geändert' else 'Neue Dienstanfrage' end,
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
        public.push_name(new.driver_id) || ' hat den Dienst '
          || tag || case when lower(new.status) = 'refused' then ' abgelehnt.' else ' bestätigt.' end,
        jsonb_build_object('ziel', 'fahrer', 'user_id', new.driver_id));
    end loop;
  end if;
  return new;
end;
$function$;
