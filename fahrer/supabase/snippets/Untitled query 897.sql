-- Cleanup fuer seed_demo_100_drivers_and_vehicles.sql
-- Entfernt NUR die Demo-Fahrer/Fahrzeuge aus diesem Seed.
--
-- Match-Kriterien:
-- 1) auth.users.raw_user_meta_data->>'source' = 'demo_100'
-- 2) oder E-Mail endet auf @trisar-demo.local
--
-- Ausfuehrung: Supabase SQL Editor (als Projekt-Owner / postgres)

begin;

create temporary table _demo_user_ids (
  user_id uuid primary key
) on commit drop;

insert into _demo_user_ids (user_id)
select u.id
from auth.users u
where
  coalesce(u.raw_user_meta_data->>'source', '') = 'demo_100'
  or lower(coalesce(u.email, '')) like '%@trisar-demo.local';

create temporary table _demo_vehicle_ids (
  vehicle_id uuid primary key
) on commit drop;

insert into _demo_vehicle_ids (vehicle_id)
select distinct p.vehicle_id
from public.profiles p
join _demo_user_ids d on d.user_id = p.id
where p.vehicle_id is not null;

-- Referenzen auf Demo-Fahrer in jobs neutralisieren
update public.jobs
set
  driver_id = null,
  refused_by_driver_id = null
where
  driver_id in (select user_id from _demo_user_ids)
  or refused_by_driver_id in (select user_id from _demo_user_ids);

-- Referenzen auf Demo-Fahrzeuge in jobs neutralisieren
update public.jobs
set vehicle_id = null
where vehicle_id in (select vehicle_id from _demo_vehicle_ids);

-- Konvoi-Zuordnungen Demo-Fahrer entfernen
delete from public.convoy_assignments
where driver_id in (select user_id from _demo_user_ids);

-- Chat/Read/Usage/Location Daten der Demo-Fahrer entfernen (falls Tabellen vorhanden)
delete from public.chat_reads
where user_id in (select user_id from _demo_user_ids);

delete from public.messages
where sender_id in (select user_id from _demo_user_ids);

delete from public.driver_live_locations
where driver_id in (select user_id from _demo_user_ids);

delete from public.driver_location_history
where driver_id in (select user_id from _demo_user_ids);

delete from public.api_usage_events
where requested_by in (select user_id from _demo_user_ids);

delete from public.job_refresh_requests
where requested_by in (select user_id from _demo_user_ids);

delete from public.ai_token_usage
where user_id in (select user_id from _demo_user_ids);

-- Profile zuerst loeschen (FK auf auth.users)
delete from public.profiles
where id in (select user_id from _demo_user_ids);

-- Dann Auth-User
delete from auth.users
where id in (select user_id from _demo_user_ids);

-- Zum Schluss die Demo-Fahrzeuge
delete from public.vehicles
where id in (select vehicle_id from _demo_vehicle_ids);

-- Optional: Sequenz fuer Kennzeichen wieder entfernen
drop sequence if exists public.demo_plate_seq;

-- Check vor commit
select
  (select count(*) from _demo_user_ids) as matched_demo_users,
  (select count(*) from _demo_vehicle_ids) as matched_demo_vehicles,
  (select count(*) from public.profiles p join _demo_user_ids d on d.user_id = p.id) as remaining_profiles,
  (select count(*) from auth.users u join _demo_user_ids d on d.user_id = u.id) as remaining_auth_users,
  (select count(*) from public.vehicles v join _demo_vehicle_ids d on d.vehicle_id = v.id) as remaining_vehicles;

commit;
