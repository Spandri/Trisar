drop function if exists public.email_exists_for_password_reset(text);

create function public.email_exists_for_password_reset(p_email text)
returns boolean
language sql
stable
security definer
set search_path = auth, public
as $$
  select exists (
    select 1
    from auth.users u
    where lower(coalesce(u.email, '')) = lower(trim(coalesce(p_email, '')))
  );
$$;

revoke all on function public.email_exists_for_password_reset(text) from public;
grant execute on function public.email_exists_for_password_reset(text) to anon, authenticated, service_role;
