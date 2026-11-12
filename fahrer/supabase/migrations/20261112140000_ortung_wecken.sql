-- Ortung startet zum Dienstbeginn auch, wenn die App schlaeft (12.11.2026).
--
-- Problem: Ausserhalb der Arbeitszeit ist das GPS aus. Liegt das Handy dann gesperrt, legt iOS die
-- App schlafen und nichts weckt sie zum Dienststart (Android im Ruhemodus aehnlich).
-- Loesung: Der Push-Dienst ruft jede Minute ortung_wecken(). Wechselt ein Fahrer (App-Ortung)
-- in die Arbeitszeit, bekommt er die Mitteilung "Arbeitszeit beginnt" (art ortung_start). Sie weckt
-- die App im Hintergrund (iOS content-available, Android FCM mit hoher Prioritaet), die App prueft
-- ortung_status und startet das GPS. Auch beim Antippen startet sie.
-- ortung_zustand merkt den letzten Stand je Fahrer, damit nur der Wechsel meldet.

create table if not exists public.ortung_zustand (
  driver_id uuid primary key,
  an boolean not null,
  geaendert timestamptz not null default now()
);
alter table public.ortung_zustand enable row level security;

create or replace function public.ortung_wecken()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  jetzt_an boolean;
  vorher boolean;
  anzahl integer := 0;
begin
  for r in
    select distinct g.user_id as id
      from public.push_geraete g join public.profiles p on p.id = g.user_id
     where g.app = 'fahrer' and coalesce(p.tracking_mode, 'app') <> 'obd'
  loop
    jetzt_an := public.ortung_erlaubt(r.id);
    select z.an into vorher from public.ortung_zustand z where z.driver_id = r.id;
    if vorher is distinct from jetzt_an then
      insert into public.ortung_zustand (driver_id, an, geaendert) values (r.id, jetzt_an, now())
      on conflict (driver_id) do update set an = excluded.an, geaendert = excluded.geaendert;
      if jetzt_an then
        perform public.push_melden(r.id, 'fahrer', 'ortung_start', 'Arbeitszeit beginnt',
          'TRISAR sendet deinen Standort jetzt an die Disposition.', jsonb_build_object('ziel', 'liste'));
        anzahl := anzahl + 1;
      end if;
    end if;
  end loop;
  return anzahl;
end;
$$;
revoke all on function public.ortung_wecken() from public, anon, authenticated;
grant execute on function public.ortung_wecken() to service_role;
