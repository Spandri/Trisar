-- Fahrer loeschen schlug fehl: "Database error deleting user" (12.11.2026).
-- Beim Loeschen eines Kontos loeschen Kaskaden seine Dienste und Standbys. Deren Trigger melden dem
-- Fahrer "zurückgezogen" per push_melden, der Eintrag in push_ausgang verweist aber auf das gerade
-- geloeschte Konto und verletzt push_ausgang_user_id_fkey. Darum: an nicht (mehr) vorhandene Konten
-- nichts melden.

create or replace function public.push_melden(p_empfaenger uuid, p_app text, p_art text, p_titel text, p_text text, p_daten jsonb default '{}'::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_empfaenger is null then return; end if;
  -- Konto gibt es nicht (mehr), z. B. waehrend es geloescht wird.
  if not exists (select 1 from auth.users u where u.id = p_empfaenger) then return; end if;
  -- Eigene Aenderungen nicht melden.
  if auth.uid() is not null and auth.uid() = p_empfaenger then return; end if;
  if exists (select 1 from public.push_einstellungen e where e.user_id = p_empfaenger and p_art = any(e.aus)) then
    return;
  end if;
  insert into public.push_ausgang (user_id, app, art, titel, text, daten)
  values (p_empfaenger, p_app, p_art, p_titel, p_text, coalesce(p_daten, '{}'::jsonb));
end;
$function$;
