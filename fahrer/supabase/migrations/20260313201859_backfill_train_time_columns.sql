with src as (
  select
    id,
    nullif(split_part((ext_flight_payload->'summary'->>'scheduled_arrival_local'), 'T', 2), '')::time as planned_time,
    nullif(split_part((ext_flight_payload->'summary'->>'estimated_arrival_local'), 'T', 2), '')::time as predicted_time
  from public.jobs
  where train_number is not null
)
update public.jobs j
set
  train_planned_time = coalesce(src.planned_time, j.train_planned_time),
  train_predicted_time = coalesce(src.predicted_time, j.train_predicted_time),
  original_etd = coalesce(src.planned_time, j.original_etd),
  etd = coalesce(src.predicted_time, j.etd)
from src
where j.id = src.id;
