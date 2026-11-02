-- RAG baseline for KI assistant (idempotent).
-- Run this in Supabase SQL editor before first rag:ingest.

create extension if not exists vector;

create table if not exists public.ai_documents (
  id uuid primary key default gen_random_uuid(),
  source_table text not null,
  source_id text not null,
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  embedding vector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_table, source_id)
);

create index if not exists idx_ai_documents_source
  on public.ai_documents(source_table, source_id);

create or replace function public.trg_ai_documents_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_ai_documents_updated_at on public.ai_documents;
create trigger trg_ai_documents_updated_at
before update on public.ai_documents
for each row execute function public.trg_ai_documents_set_updated_at();

alter table public.ai_documents enable row level security;

drop policy if exists p_ai_documents_select_public on public.ai_documents;
create policy p_ai_documents_select_public
  on public.ai_documents
  for select
  to anon, authenticated
  using (true);

drop policy if exists p_ai_documents_write_service on public.ai_documents;
create policy p_ai_documents_write_service
  on public.ai_documents
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.match_ai_documents(
  query_embedding double precision[],
  match_count integer default 8
)
returns table (
  id uuid,
  source_table text,
  source_id text,
  content text,
  meta jsonb,
  similarity double precision
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q vector;
begin
  if query_embedding is null or array_length(query_embedding, 1) is null then
    return;
  end if;

  q := query_embedding::vector;

  return query
  select
    d.id,
    d.source_table,
    d.source_id,
    d.content,
    d.meta,
    (1 - (d.embedding <=> q))::double precision as similarity
  from public.ai_documents d
  where d.embedding is not null
  order by d.embedding <=> q
  limit greatest(1, least(coalesce(match_count, 8), 50));
end;
$$;

grant execute on function public.match_ai_documents(double precision[], integer) to anon, authenticated, service_role;
