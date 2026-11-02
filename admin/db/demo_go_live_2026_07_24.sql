-- =============================================================
-- Demo "Go-Live" fuer den Einsatz am Fr 2026-07-24
-- Kurz vor der Demo (~13:45 Uhr) ausfuehren:
--   docker exec -i supabase_db_fahrer-app-lokal psql -U postgres -d postgres \
--     < admin-app-lokal/db/demo_go_live_2026_07_24.sql
--
-- Setzt fuer Freitag 24.07.:
--   - zugewiesene Fahrten vor 13:15 Uhr  -> done (Vormittag erledigt)
--   - zugewiesene Fahrten 13:15-14:00    -> in_progress (gerade unterwegs)
--   - alles ab 14:00 bleibt 'assigned'
-- Rueckgaengig machen: seed_demo_einsatz_2026_07_24.sql erneut einspielen.
-- =============================================================

begin;

update public.jobs
set status = 'done', updated_at = now()
where ride_date = date '2026-07-24'
  and driver_id is not null
  and status in ('assigned', 'in_progress')
  and etd < time '13:15';

update public.jobs
set status = 'in_progress', updated_at = now()
where ride_date = date '2026-07-24'
  and driver_id is not null
  and status = 'assigned'
  and etd >= time '13:15'
  and etd <= time '14:00';

select status, count(*), min(etd) as ab, max(etd) as bis
from public.jobs
where ride_date = date '2026-07-24'
group by status
order by status;

commit;
