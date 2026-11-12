-- Stundenlohn je Fahrer und laufende Einsatzkosten fuer die Startseite der Dispo (12.11.).
--
-- profiles.stundenlohn: Euro pro Stunde (Kosten des Fahrers fuer die Firma). Nur die Dispo darf ihn
-- setzen oder aendern, der Fahrer selbst nicht (er darf sein Profil sonst teils selbst aendern).
--
-- einsatzkosten(): Summe ueber alle angenommenen Dienste, die schon begonnen haben, Minuten x Lohn.
--   Minuten: gibt es einen Stundenzettel, gilt dessen arbeits_min (aendert sich mit Bearbeiten und
--   Bestaetigen mit). Sonst zaehlt es ab Dienstbeginn mit: Vorschlag (Beginn bis jetzt bzw. Ende)
--   abzueglich Pausen ab 3 Stunden, wie die Stundenerfassung der Fahrer-App.

alter table public.profiles add column if not exists stundenlohn numeric(8, 2)
  check (stundenlohn is null or stundenlohn >= 0);

create or replace function public.stundenlohn_schutz()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Server (service_role, ohne Konto) und Dispo duerfen, sonst bleibt der alte Wert.
  if new.stundenlohn is distinct from old.stundenlohn and auth.uid() is not null and not public.ist_dispo() then
    new.stundenlohn := old.stundenlohn;
  end if;
  return new;
end;
$$;

drop trigger if exists stundenlohn_schutz on public.profiles;
create trigger stundenlohn_schutz before update on public.profiles
  for each row execute function public.stundenlohn_schutz();

-- Gearbeitete Minuten eines Dienstes bis jetzt (Zettel, sonst laufend ab Beginn).
create or replace function public.dienst_minuten_bisher(p_dienst_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  z record;
  v jsonb;
  beginn timestamptz;
  ende timestamptz;
  bis timestamptz;
  p jsonb;
  p_von timestamptz;
  p_bis timestamptz;
  pause_sek double precision := 0;
begin
  select * into z from public.stundenzettel where dienst_id = p_dienst_id;
  if found and z.ende > z.beginn then
    return coalesce(z.arbeits_min, 0);
  end if;
  v := public.stunden_vorschlag_server(p_dienst_id);
  if v is null then return 0; end if;
  beginn := (v->>'beginn')::timestamptz;
  ende := (v->>'ende')::timestamptz;
  if beginn is null or beginn > now() then return 0; end if;
  bis := least(now(), coalesce(ende, now()));
  for p in select * from jsonb_array_elements(coalesce(v->'pausen', '[]'::jsonb)) loop
    p_von := (p->>'von')::timestamptz;
    p_bis := (p->>'bis')::timestamptz;
    -- Pausen unter 3 Stunden sind Arbeitszeit.
    if p_von is null or p_bis is null or p_bis - p_von < interval '3 hours' then continue; end if;
    pause_sek := pause_sek + greatest(0, extract(epoch from (least(p_bis, bis) - p_von)));
  end loop;
  return greatest(0, floor((extract(epoch from (bis - beginn)) - pause_sek) / 60))::int;
end;
$$;
revoke all on function public.dienst_minuten_bisher(uuid) from public, anon, authenticated;

-- Einsatzkosten seit Einsatzbeginn (alle angenommenen Dienste), nur fuer die Dispo.
create or replace function public.einsatzkosten()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d record;
  minuten integer;
  kosten numeric := 0;
  stunden numeric := 0;
  ohne_lohn integer := 0;
begin
  if not public.ist_dispo() then
    raise exception 'kein Zugriff';
  end if;
  for d in
    select r.id, p.stundenlohn
    from public.driver_service_requests r
    join public.profiles p on p.id = r.driver_id
    where lower(coalesce(r.status, '')) in ('accepted', 'assigned', 'approved')
      and public.stunden_zeitpunkt(r.service_date, r.service_start_time) <= now()
  loop
    minuten := public.dienst_minuten_bisher(d.id);
    stunden := stunden + minuten / 60.0;
    if d.stundenlohn is null then
      if minuten > 0 then ohne_lohn := ohne_lohn + 1; end if;
    else
      kosten := kosten + minuten / 60.0 * d.stundenlohn;
    end if;
  end loop;
  return jsonb_build_object('kosten', round(kosten, 2), 'stunden', round(stunden, 2), 'dienste_ohne_lohn', ohne_lohn);
end;
$$;
revoke all on function public.einsatzkosten() from public, anon;
grant execute on function public.einsatzkosten() to authenticated;
