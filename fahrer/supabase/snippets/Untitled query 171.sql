BEGIN;

WITH last_batch AS (
  SELECT batch_id
  FROM public.driver_activity_state_backup_demo
  ORDER BY backed_up_at DESC
  LIMIT 1
),
restore_rows AS (
  SELECT b.driver_id, b.old_state
  FROM public.driver_activity_state_backup_demo b
  JOIN last_batch lb ON lb.batch_id = b.batch_id
)
UPDATE public.profiles p
SET driver_activity_state = r.old_state
FROM restore_rows r
WHERE p.id = r.driver_id;

COMMIT;
