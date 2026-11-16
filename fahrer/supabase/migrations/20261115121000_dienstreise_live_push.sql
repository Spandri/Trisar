-- Dienstreise: Verspaetung und Gleisaenderung als Push an den Fahrer (15.11.2026, Pilot-Feedback).
--
-- Bisher holten nur die offenen Apps den Live-Stand der Zuege, der Server wusste nichts davon.
-- Jetzt fragt der Push-Dienst (koordinaten/scripts/push-dienst.js) alle 2 min fuer jeden laufenden
-- Zug-Abschnitt train-validate ab und gibt das Ergebnis an dienstreise_live_setzen(). Die Funktion merkt sich
-- den Stand in dienstreise_live und meldet allen Fahrern der Reise (angenommen, nicht beendet):
--   reise_verspaetung  ab 5 min Verspaetung, danach bei jeder weiteren Aenderung um 5 min (auch "wieder puenktlich")
--   reise_gleis        Abfahrts- oder Ankunftsgleis anders als geplant, je neuem Gleis einmal
-- Abschaltbar je Art ueber push_einstellungen.aus wie alle anderen Mitteilungen.

create table if not exists public.dienstreise_live (
  abschnitt_id uuid primary key references public.dienstreise_abschnitt(id) on delete cascade,
  dienstreise_id uuid not null references public.dienstreise(id) on delete cascade,
  abfahrt text,
  abfahrt_plan text,
  ankunft text,
  ankunft_plan text,
  gleis_ab text,
  gleis_ab_plan text,
  gleis_an text,
  gleis_an_plan text,
  stand timestamptz not null default now(),
  gemeldet_spaet integer not null default 0,
  gemeldet_gleis_ab text,
  gemeldet_gleis_an text
);

alter table public.dienstreise_live enable row level security;
drop policy if exists dienstreise_live_lesen on public.dienstreise_live;
create policy dienstreise_live_lesen on public.dienstreise_live for select to authenticated
  using (public.ist_dispo() or exists (
    select 1 from public.dienstreise_fahrer f
     where f.dienstreise_id = dienstreise_live.dienstreise_id and f.driver_id = auth.uid()));
grant select on public.dienstreise_live to authenticated;

-- Minuten zwischen zwei Uhrzeiten "HH:MM" (Ist minus Plan), ueber Mitternacht, null wenn eine fehlt.
create or replace function public.reise_minuten_spaet(p_plan text, p_ist text)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_plan, '') !~ '^\d{1,2}:\d{2}' or coalesce(p_ist, '') !~ '^\d{1,2}:\d{2}' then null
    else (((split_part(p_ist, ':', 1)::int * 60 + left(split_part(p_ist, ':', 2), 2)::int)
          - (split_part(p_plan, ':', 1)::int * 60 + left(split_part(p_plan, ':', 2), 2)::int)
          + 1440 + 720) % 1440) - 720
  end;
$$;

-- Zug- und S-Bahn-Abschnitte, die der Push-Dienst gerade beobachten soll: Reise angenommen und nicht beendet,
-- von 90 min vor der Abfahrt bis 30 min nach der Ankunft (live, sonst Plan).
create or replace function public.dienstreise_live_offen()
returns table (abschnitt_id uuid, dienstreise_id uuid, nummer text, datum date, ab_zeit text,
               von_name text, nach_name text)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, r.id, trim(a.nummer), coalesce(a.ab_datum, r.datum), to_char(a.ab_zeit, 'HH24:MI'),
         a.von_name, coalesce(a.nach_name, '')
    from public.dienstreise_abschnitt a
    join public.dienstreise r on r.id = a.dienstreise_id
    left join public.dienstreise_live l on l.abschnitt_id = a.id
   where a.art in ('zug', 'sbahn')
     and coalesce(trim(a.nummer), '') <> ''
     and a.ab_zeit is not null
     and r.datum between (now() at time zone 'Europe/Berlin')::date - 1 and (now() at time zone 'Europe/Berlin')::date + 1
     and exists (select 1 from public.dienstreise_fahrer f
                  where f.dienstreise_id = r.id and lower(coalesce(f.status, '')) = 'accepted' and f.beendet is null)
     and now() >= ((coalesce(a.ab_datum, r.datum) + a.ab_zeit) at time zone 'Europe/Berlin') - interval '90 minutes'
     and (a.an_zeit is null or now() <= (
           (coalesce(a.an_datum, a.ab_datum, r.datum)
             + coalesce(nullif(l.ankunft, '')::time, a.an_zeit)
             + case when coalesce(nullif(l.ankunft, '')::time, a.an_zeit) < a.ab_zeit then interval '1 day' else interval '0' end)
           at time zone 'Europe/Berlin') + interval '30 minutes');
$$;

-- Live-Stand eines Abschnitts speichern und bei Verspaetung oder Gleisaenderung melden.
-- p: { abschnitt_id, abfahrt, abfahrt_plan, ankunft, ankunft_plan, gleis_ab, gleis_ab_plan, gleis_an, gleis_an_plan }
-- Gibt die Zahl der angelegten Mitteilungen zurueck.
create or replace function public.dienstreise_live_setzen(p jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.dienstreise_abschnitt;
  r public.dienstreise;
  alt public.dienstreise_live;
  neu public.dienstreise_live;
  jetzt_berlin timestamp := now() at time zone 'Europe/Berlin';
  tag date;
  abgefahren boolean;
  angekommen boolean;
  spaet_ab integer;
  spaet_an integer;
  spaet integer;
  plan_ab text;
  plan_an text;
  nummer text;
  titel text;
  text_ text;
  daten jsonb;
  f uuid;
  anzahl integer := 0;
  w text;
begin
  select * into a from public.dienstreise_abschnitt where id = (p->>'abschnitt_id')::uuid;
  if not found then return 0; end if;
  select * into r from public.dienstreise where id = a.dienstreise_id;
  select * into alt from public.dienstreise_live where abschnitt_id = a.id;

  insert into public.dienstreise_live as l (abschnitt_id, dienstreise_id, abfahrt, abfahrt_plan, ankunft, ankunft_plan,
                                            gleis_ab, gleis_ab_plan, gleis_an, gleis_an_plan, stand)
  values (a.id, a.dienstreise_id, nullif(p->>'abfahrt', ''), nullif(p->>'abfahrt_plan', ''), nullif(p->>'ankunft', ''),
          nullif(p->>'ankunft_plan', ''), nullif(p->>'gleis_ab', ''), nullif(p->>'gleis_ab_plan', ''),
          nullif(p->>'gleis_an', ''), nullif(p->>'gleis_an_plan', ''), now())
  on conflict (abschnitt_id) do update set
    abfahrt = excluded.abfahrt, abfahrt_plan = excluded.abfahrt_plan, ankunft = excluded.ankunft,
    ankunft_plan = excluded.ankunft_plan, gleis_ab = excluded.gleis_ab, gleis_ab_plan = excluded.gleis_ab_plan,
    gleis_an = excluded.gleis_an, gleis_an_plan = excluded.gleis_an_plan, stand = now()
  returning * into neu;

  tag := coalesce(a.ab_datum, r.datum);
  nummer := trim(a.nummer);
  plan_ab := coalesce(neu.abfahrt_plan, to_char(a.ab_zeit, 'HH24:MI'));
  plan_an := coalesce(neu.ankunft_plan, to_char(a.an_zeit, 'HH24:MI'));
  abgefahren := jetzt_berlin >= tag + coalesce(nullif(neu.abfahrt, '')::time, a.ab_zeit);
  angekommen := a.an_zeit is not null and jetzt_berlin >= coalesce(a.an_datum, tag) + coalesce(nullif(neu.ankunft, '')::time, a.an_zeit)
                + case when coalesce(nullif(neu.ankunft, '')::time, a.an_zeit) < a.ab_zeit then interval '1 day' else interval '0' end;
  if angekommen then return 0; end if;
  daten := jsonb_build_object('dienstreise_id', r.id, 'abschnitt_id', a.id);

  -- Verspaetung: vor der Abfahrt die Abfahrt, danach die Ankunft. Frueher als Plan zaehlt als puenktlich.
  spaet_ab := greatest(coalesce(public.reise_minuten_spaet(plan_ab, neu.abfahrt), 0), 0);
  spaet_an := greatest(coalesce(public.reise_minuten_spaet(plan_an, neu.ankunft), 0), 0);
  spaet := case when abgefahren then spaet_an else greatest(spaet_ab, spaet_an) end;
  if abs(spaet - coalesce(alt.gemeldet_spaet, 0)) >= 5 then
    if spaet >= 5 then
      titel := nummer || ' +' || spaet || ' min';
    else
      titel := nummer || ' wieder pünktlich';
    end if;
    if abgefahren then
      text_ := 'Ankunft ' || coalesce(nullif(a.nach_name, ''), 'Ziel') || ' ' || coalesce(neu.ankunft, plan_an)
               || case when spaet >= 5 then ' statt ' || plan_an else '' end || '.';
    else
      text_ := 'Abfahrt ' || a.von_name || ' ' || coalesce(neu.abfahrt, plan_ab)
               || case when spaet_ab >= 5 then ' statt ' || plan_ab else '' end
               || case when neu.ankunft is not null and spaet_an >= 5 then ', Ankunft ' || neu.ankunft else '' end || '.';
    end if;
    for f in select x.driver_id from public.dienstreise_fahrer x
              where x.dienstreise_id = r.id and lower(coalesce(x.status, '')) = 'accepted' and x.beendet is null loop
      perform public.push_melden(f, 'fahrer', 'reise_verspaetung', titel, text_, daten);
      anzahl := anzahl + 1;
    end loop;
    update public.dienstreise_live set gemeldet_spaet = spaet where abschnitt_id = a.id;
  end if;

  -- Gleis bei Abfahrt (nur vor der Abfahrt): anders als im Ticket bzw. im Fahrplan, je neuem Gleis einmal.
  w := coalesce(nullif(a.gleis_ab, ''), neu.gleis_ab_plan);
  if not abgefahren and neu.gleis_ab is not null and w is not null and neu.gleis_ab <> w
     and neu.gleis_ab is distinct from alt.gemeldet_gleis_ab then
    for f in select x.driver_id from public.dienstreise_fahrer x
              where x.dienstreise_id = r.id and lower(coalesce(x.status, '')) = 'accepted' and x.beendet is null loop
      perform public.push_melden(f, 'fahrer', 'reise_gleis', nummer || ': Gleisänderung',
        'Abfahrt ' || a.von_name || ' ' || coalesce(neu.abfahrt, plan_ab) || ' jetzt Gleis ' || neu.gleis_ab
        || ' statt ' || w || '.', daten);
      anzahl := anzahl + 1;
    end loop;
    update public.dienstreise_live set gemeldet_gleis_ab = neu.gleis_ab where abschnitt_id = a.id;
  end if;

  -- Gleis bei Ankunft (bis zur Ankunft).
  w := coalesce(nullif(a.gleis_an, ''), neu.gleis_an_plan);
  if neu.gleis_an is not null and w is not null and neu.gleis_an <> w
     and neu.gleis_an is distinct from alt.gemeldet_gleis_an then
    for f in select x.driver_id from public.dienstreise_fahrer x
              where x.dienstreise_id = r.id and lower(coalesce(x.status, '')) = 'accepted' and x.beendet is null loop
      perform public.push_melden(f, 'fahrer', 'reise_gleis', nummer || ': Gleisänderung',
        'Ankunft ' || coalesce(nullif(a.nach_name, ''), 'Ziel') || ' jetzt Gleis ' || neu.gleis_an
        || ' statt ' || w || '.', daten);
      anzahl := anzahl + 1;
    end loop;
    update public.dienstreise_live set gemeldet_gleis_an = neu.gleis_an where abschnitt_id = a.id;
  end if;

  return anzahl;
end;
$$;

revoke all on function public.dienstreise_live_offen() from public, anon, authenticated;
revoke all on function public.dienstreise_live_setzen(jsonb) from public, anon, authenticated;
grant execute on function public.dienstreise_live_offen() to service_role;
grant execute on function public.dienstreise_live_setzen(jsonb) to service_role;
