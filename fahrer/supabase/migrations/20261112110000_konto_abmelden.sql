-- Fahrer sofort abmelden, wenn die Dispo sein Passwort aendert oder sein Konto loescht (12.11.2026).
--
--   * konto_abmelden(user_id, grund, zeit): Signal je Konto. Die Apps hoeren per Realtime auf die
--     eigene Zeile und melden sich ab (Login-Bildschirm). Kein Fremdschluessel, damit das Signal
--     beim Loeschen des Kontos nicht mit verschwindet.
--   * konto_abmelden_jetzt(user, grund): beendet alle Sitzungen des Kontos (auth.sessions, die
--     Refresh-Tokens fallen per Kaskade mit) und setzt das Signal. Nur fuer die Funktion dispo-admin.

create table if not exists public.konto_abmelden (
  user_id uuid primary key,
  grund text not null,
  zeit timestamptz not null default now()
);

alter table public.konto_abmelden enable row level security;
drop policy if exists konto_abmelden_selbst on public.konto_abmelden;
create policy konto_abmelden_selbst on public.konto_abmelden for select to authenticated
  using (user_id = auth.uid());
grant select on public.konto_abmelden to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'konto_abmelden') then
    alter publication supabase_realtime add table public.konto_abmelden;
  end if;
end $$;

create or replace function public.konto_abmelden_jetzt(p_user uuid, p_grund text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then return; end if;
  delete from auth.sessions where user_id = p_user;
  insert into public.konto_abmelden (user_id, grund, zeit) values (p_user, p_grund, now())
  on conflict (user_id) do update set grund = excluded.grund, zeit = excluded.zeit;
end;
$$;

revoke all on function public.konto_abmelden_jetzt(uuid, text) from public, anon, authenticated;
grant execute on function public.konto_abmelden_jetzt(uuid, text) to service_role;
