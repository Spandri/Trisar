create table if not exists public.jobs_archive (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null,
  archived_at timestamptz not null default now(),
  archived_by text,
  snapshot jsonb not null default '{}'::jsonb
);

create index if not exists jobs_archive_job_id_idx on public.jobs_archive (job_id);
create index if not exists jobs_archive_archived_at_idx on public.jobs_archive (archived_at desc);

alter table public.jobs_archive enable row level security;

drop policy if exists "jobs_archive_read_authenticated" on public.jobs_archive;
create policy "jobs_archive_read_authenticated"
on public.jobs_archive
for select
to authenticated
using (true);

drop policy if exists "jobs_archive_insert_authenticated" on public.jobs_archive;
create policy "jobs_archive_insert_authenticated"
on public.jobs_archive
for insert
to authenticated
with check (true);
