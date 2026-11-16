-- Geheimnisse, die nur Edge Functions (service_role) lesen (14.11.2026). Erster Eintrag: Zertifikat der
-- Pass Type ID pass.de.trisar.ticket (Apple Wallet, Dienstreise-Ticket) und sein Passwort.
-- Befuellt mit werkzeuge/wallet-einrichten.sh, nie aus den Apps.
create table if not exists public.trisar_geheimnis (
  name text primary key,
  wert text not null,
  aktualisiert timestamptz not null default now()
);
alter table public.trisar_geheimnis enable row level security;
-- Keine Policies: angemeldete Nutzer und anon sehen nichts, nur service_role (umgeht RLS).
revoke all on public.trisar_geheimnis from anon, authenticated;
