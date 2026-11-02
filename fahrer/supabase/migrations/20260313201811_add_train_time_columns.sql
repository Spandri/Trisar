alter table if exists public.jobs
  add column if not exists train_planned_time time without time zone,
  add column if not exists train_predicted_time time without time zone;
