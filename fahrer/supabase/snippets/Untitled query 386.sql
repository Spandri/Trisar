alter table public.job_notes enable row level security;
alter table public.job_guests enable row level security;

drop policy if exists p_job_notes_insert_all on public.job_notes;
create policy p_job_notes_insert_all on public.job_notes for insert to anon, authenticated with check (true);
drop policy if exists p_job_notes_select_all on public.job_notes;
create policy p_job_notes_select_all on public.job_notes for select to anon, authenticated using (true);

drop policy if exists p_job_guests_insert_all on public.job_guests;
create policy p_job_guests_insert_all on public.job_guests for insert to anon, authenticated with check (true);
drop policy if exists p_job_guests_select_all on public.job_guests;
create policy p_job_guests_select_all on public.job_guests for select to anon, authenticated using (true);
