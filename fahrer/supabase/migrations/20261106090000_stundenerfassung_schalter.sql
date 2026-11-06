-- Schalter je Fahrer: Stundenerfassung an oder aus (Dispo stellt es beim Fahrer ein).
-- Ohne Eintrag ist sie an. Ist sie aus, liefert stunden_verlauf() der Fahrer-App nichts,
-- damit verschwinden Stundenkarten und Erfassung in allen Fahrer-Apps. Die Dispo sieht weiter alles.

create table if not exists public.fahrer_einstellungen (
  driver_id uuid primary key references public.profiles(id) on delete cascade,
  stundenerfassung boolean not null default true,
  aktualisiert timestamptz not null default now()
);
alter table public.fahrer_einstellungen enable row level security;
drop policy if exists fahrer_einstellungen_dispo on public.fahrer_einstellungen;
create policy fahrer_einstellungen_dispo on public.fahrer_einstellungen for all using (public.ist_dispo()) with check (public.ist_dispo());
drop policy if exists fahrer_einstellungen_fahrer on public.fahrer_einstellungen;
create policy fahrer_einstellungen_fahrer on public.fahrer_einstellungen for select using (driver_id = auth.uid());
grant select, insert, update, delete on public.fahrer_einstellungen to authenticated;

create or replace function public.stundenerfassung_an(p_driver uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select e.stundenerfassung from public.fahrer_einstellungen e where e.driver_id = p_driver), true);
$$;
grant execute on function public.stundenerfassung_an(uuid) to authenticated;

-- Verlauf (wie 20261106060000), neu mit dem Schalter: vergangene Dienste eines Fahrers mit Fahrten und Stundenzettel.
create or replace function public.stunden_verlauf(p_driver uuid default null, p_tage integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  fahrer uuid := coalesce(p_driver, auth.uid());
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
      and service_date <= current_date
      and service_date >= current_date - p_tage
    order by service_date desc, service_start_time desc
  loop
    select * into z from public.stundenzettel where dienst_id = d.id;
    ergebnis := ergebnis || jsonb_build_object(
      'dienst', jsonb_build_object('id', d.id, 'datum', d.service_date,
        'beginn', to_char(d.service_start_time, 'HH24:MI'), 'ende', to_char(d.service_end_time, 'HH24:MI'),
        'pausen', coalesce((select dp.pausen from public.dienst_pausen dp where dp.dienst_id = d.id), '[]'::jsonb)),
      'vorschlag', public.stunden_vorschlag_server(d.id),
      'zettel', case when z.id is null then null else to_jsonb(z) end,
      -- Erfassen erst, wenn der Dienst vorbei ist.
      'vorbei', coalesce(public.stunden_zeitpunkt(d.service_date, d.service_end_time) +
                  case when d.service_end_time <= d.service_start_time then interval '1 day' else interval '0' end, now()) <= now()
    );
  end loop;
  return ergebnis;
end;
$$;
