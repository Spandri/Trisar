-- Dienstreise endet von selbst, sobald der Fahrer eine Fahrt beginnt (15.11.2026, Pilot-Feedback).
--
-- 14.11.: Reise 421e9baa kam 12:06 in Offenburg an, die Anschlussfahrt lief ab 12:08 (in_progress), beendet
-- wurde die Reise erst 15:47. Bis dahin zeigte die Dispo-Karte den Fahrer als ICE 71 statt als Fahrzeug.
-- Jetzt: wechselt eine Fahrt des Fahrers auf at_pickup oder in_progress, gilt jede angenommene, nicht beendete
-- Dienstreise als beendet, deren letzter Abschnitt laut Plan schon abgefahren ist (ohne Abschnitte: Startzeit).
-- Eine Fahrt vor der Reise oder zwischen zwei Abschnitten beendet also nichts.

create or replace function public.dienstreise_ende_bei_fahrt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.driver_id is null or lower(coalesce(new.status, '')) not in ('at_pickup', 'in_progress') then
    return new;
  end if;
  if lower(coalesce(old.status, '')) in ('at_pickup', 'in_progress') then
    return new;
  end if;
  update public.dienstreise_fahrer f
     set beendet = now(), aktualisiert = now()
    from public.dienstreise r
   where f.dienstreise_id = r.id
     and f.driver_id = new.driver_id
     and lower(coalesce(f.status, '')) = 'accepted'
     and f.beendet is null
     and r.datum between (now() at time zone 'Europe/Berlin')::date - 1 and (now() at time zone 'Europe/Berlin')::date
     and now() >= coalesce(
           (select max(((coalesce(a.ab_datum, r.datum) + a.ab_zeit) at time zone 'Europe/Berlin'))
              from public.dienstreise_abschnitt a
             where a.dienstreise_id = r.id and a.ab_zeit is not null),
           ((r.datum + r.start_zeit) at time zone 'Europe/Berlin'));
  return new;
end;
$$;

revoke all on function public.dienstreise_ende_bei_fahrt() from public, anon, authenticated;

drop trigger if exists trg_jobs_dienstreise_ende on public.jobs;
create trigger trg_jobs_dienstreise_ende
  after update of status on public.jobs
  for each row execute function public.dienstreise_ende_bei_fahrt();
