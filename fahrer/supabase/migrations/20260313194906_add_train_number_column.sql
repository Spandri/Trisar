alter table if exists public.jobs
  add column if not exists train_number text;
